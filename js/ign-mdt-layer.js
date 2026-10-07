/*
 * ign-mdt-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * Spain — official "Mapa LiDAR" WMS of the IDEE / Instituto Geográfico
 * Nacional (IGN-CNIG): a shaded LiDAR digital surface model (MDS) with the
 * PNOA-LiDAR vegetation and building heights (green / red ramps) and the
 * Sistema Cartográfico Nacional hydrography raster (blue) on top, one GetMap
 * request per Leaflet tile, fetched live as the user pans and zooms. Nothing
 * is downloaded or pre-generated.
 *
 * Why this file exists
 *   The Spain row used to stream the IDEE WMTS relief cache
 *   (servicios.idee.es/wmts/mdt, matrix set GoogleMapsCompatible, layer
 *   "Relieve") and, before that, the INSPIRE WMS
 *   (servicios.idee.es/wms-inspire/mdt, layer EL.ElevationGridCoverage with a
 *   style name the service does not publish). Both are retired: the row now
 *   uses the service IGN publishes for its "Mapa LiDAR" product, which is the
 *   one that carries the LiDAR heights the LIDAR panel is about. The module
 *   keeps its file and `window.IgnMdt` names so the rest of the app (and the
 *   other country test suites) keep working unchanged.
 *
 * Verified live on 2026-10-07 (details and the complete checklist in
 * SPAIN_LIDAR_IGN_WMS.md):
 *   • endpoint   https://wms-mapa-lidar.idee.es/lidar   (MapServer, HTTPS+HSTS)
 *   • layers     exactly one: EL.GridCoverage, Title "Mapa LiDAR", queryable;
 *                style "default"; identifier (SCNE) "mapa_lidar"
 *   • WMS 1.1.1 as well as 1.3.0; MapServer tiling parameters TILED /
 *                CONTINUOUSWORLD are understood
 *   • CRS        EPSG:3857 is advertised (also EPSG:4326, 4258, 25828-31,
 *                32628-31, CRS:84, 3035, 4083) ⇒ tiles are requested in Web
 *                Mercator and land exactly on the basemap, no reprojection
 *   • formats    image/png (used here, transparent), image/jpeg, …
 *   • extent     EX_GeographicBoundingBox −19 27 → 5 44 = peninsula, Balearics
 *                and Canaries; EPSG:3857 BoundingBox
 *                −2 115 070 3 123 470 → 556 597 5 465 440
 *   • a real GetMap tile answered HTTP 200, content-type image/png, 256×256,
 *                145 617 bytes, access-control-allow-origin: * and
 *                cache-control: max-age=31536000 (so no token and no proxy are
 *                needed, and a CDN in front of it would be redundant)
 *   • GetFeatureInfo is supported as well: INFO_FORMAT=text/xml answered
 *                "Altura vegetación: 4.1 m" for the sample tile (the internal
 *                sub-layers are named gfi-vegetacion-h30, gfi-edificacion-…,
 *                lidar-teselado). The previous layer had no identify UI, so the
 *                click hook stays unwired on purpose — featureInfoUrl() below
 *                builds the request for whoever wires it next.
 *
 * Exposes `window.IgnMdt`:
 *   .CONFIG / .MODES
 *   .wmsUrl()                                  → service endpoint (or proxy)
 *   .tileUrl(mode, bbox, size)                 pure GetMap URL builder
 *   .featureInfoUrl(mode, bbox, size, px, py)  pure GetFeatureInfo URL builder
 *   .createLayer(options)                      → L.TileLayer subclass instance
 *
 * No build step, no dependencies beyond Leaflet 1.x, no API keys, no tokens.
 */
(function (root) {
    'use strict';

    var L = root.L;
    if (!L) {
        console.error('[IgnMdt] Leaflet is not loaded — ign-mdt-layer.js must load after leaflet.js');
        return;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  CONFIG — everything tunable lives here and nowhere else.
     * ═══════════════════════════════════════════════════════════════════════ */
    var CONFIG = {
        // Public IDEE/IGN WMS endpoint of the "Mapa LiDAR" service — no key,
        // no token. HTTPS (the site is HTTPS, so an http:// service would be
        // blocked as mixed content).
        WMS_URL: 'https://wms-mapa-lidar.idee.es/lidar',

        // Optional caching proxy / CDN in front of the government server; see
        // the Nginx and Cloudflare Worker snippets in SPAIN_LIDAR_IGN_WMS.md.
        //   window.SPAIN_LIDAR_PROXY_URL = 'https://lidar-cache.example.com/lidar';
        PROXY_URL: root.SPAIN_LIDAR_PROXY_URL || '',

        DEFAULT_MODE: 'mapa_lidar',

        // The service publishes exactly one layer. GetCapabilities spells it
        // EL.GridCoverage; the style it declares is "default", which is also
        // what an empty STYLES= selects, so the default is left empty.
        MODES: {
            mapa_lidar: {
                label: 'Mapa LiDAR · MDS (vegetation, buildings, water)',
                layer: 'EL.GridCoverage',
                styles: ''
            }
        },

        // WMS 1.1.1: the projection parameter is SRS=, not CRS= (CRS= is only
        // defined from 1.3.0 on, and the axis order differs there).
        VERSION: '1.1.1',
        SRS: 'EPSG:3857',
        FORMAT: 'image/png',
        TRANSPARENT: true,

        // MapServer tiling hints: tell the renderer that this BBOX is one tile
        // of a larger grid, so labels/symbols are not laid out per request and
        // no wrap-around padding is added at the service edges.
        TILED: true,
        CONTINUOUSWORLD: true,

        // Format for the optional GetFeatureInfo (identify) request. text/xml
        // is what the capabilities advertise; the service answers with a small
        // height table ("Altura vegetación: 4.1 m").
        INFO_FORMAT: 'text/xml',

        OPACITY: 0.7,
        MIN_ZOOM: 5,            // below this the whole of Spain fits in a few tiles
        MAX_NATIVE_ZOOM: 20,    // dynamic WMS: rendered per request, not a cache
        MAX_ZOOM: 20,           // the app-wide LiDAR cap; the product itself is
                                // informative up to ≈1:20 000 (roughly z14-15)
        TILE_SIZE: 256,         // well under the service's MaxWidth/MaxHeight (4096)
        KEEP_BUFFER: 1,         // public government server: barely preload
        CROSS_ORIGIN: false,    // plain <img> tiles need no CORS

        // Coverage from the capabilities' EX_GeographicBoundingBox
        // (−19 27 → 5 44): peninsula + Balearics + Canaries. Leaflet then never
        // asks for a tile outside it.
        BOUNDS: [[27, -19], [44, 5]],

        // Required credit: the service declares AccessConstraints
        // "CC BY 4.0 http://www.scne.es/#Mapa-LiDAR" and an SCNE authority.
        ATTRIBUTION: 'Mapa LiDAR © <a href="https://www.idee.es/" target="_blank" rel="noopener">IDEE</a>' +
            ' · <a href="https://www.ign.es/" target="_blank" rel="noopener">Instituto Geográfico Nacional</a>' +
            ' / CNIG — Sistema Cartográfico Nacional (CC BY 4.0)'
    };
    /* ════════════════════════ end of configuration ═══════════════════════ */

    // Transparent 1×1 PNG: Leaflet shows it instead of a broken image when a
    // tile 404s or the service is momentarily down.
    var BLANK_TILE = 'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function mode(key) {
        return CONFIG.MODES[key] || CONFIG.MODES[CONFIG.DEFAULT_MODE];
    }

    function wmsUrl() {
        return (CONFIG.PROXY_URL || CONFIG.WMS_URL).replace(/\?+$/, '');
    }

    function round(n, digits) {
        var f = Math.pow(10, digits === undefined ? 4 : digits);
        return Math.round(n * f) / f;
    }

    /**
     * One WMS KVP request. The BBOX is always supplied by Leaflet for the tile
     * being drawn, never hardcoded.
     *
     * @param {String} key     mode key ('mapa_lidar')
     * @param {Array}  bbox    [minx, miny, maxx, maxy] in EPSG:3857 metres
     * @param {Number} size    tile size in pixels (square, default 256)
     * @param {String} request 'GetMap' | 'GetFeatureInfo'
     * @param {Object} pixel   {x, y} pixel to query (GetFeatureInfo only)
     */
    function kvp(key, bbox, size, request, pixel) {
        var px = size || CONFIG.TILE_SIZE;
        var m = mode(key);
        var params = [
            'SERVICE=WMS',
            'REQUEST=' + request,
            'LAYERS=' + encodeURIComponent(m.layer),
            'STYLES=' + encodeURIComponent(m.styles),      // empty by design
            'FORMAT=' + encodeURIComponent(CONFIG.FORMAT),
            'TRANSPARENT=' + (CONFIG.TRANSPARENT ? 'true' : 'false'),
            'VERSION=' + CONFIG.VERSION,
            'CONTINUOUSWORLD=' + (CONFIG.CONTINUOUSWORLD ? 'true' : 'false'),
            'TILED=' + (CONFIG.TILED ? 'true' : 'false'),
            'INFO_FORMAT=' + encodeURIComponent(CONFIG.INFO_FORMAT),
            'WIDTH=' + px,
            'HEIGHT=' + px,
            'SRS=' + encodeURIComponent(CONFIG.SRS)
        ];
        if (request === 'GetFeatureInfo') {
            var point = pixel || { x: Math.floor(px / 2), y: Math.floor(px / 2) };
            params.push('QUERY_LAYERS=' + encodeURIComponent(m.layer));
            params.push('X=' + point.x);
            params.push('Y=' + point.y);
        }
        params.push('BBOX=' + bbox.map(function (v) { return round(v, 4); }).join(','));
        return wmsUrl() + '?' + params.join('&');
    }

    /** GetMap URL for one tile extent (pure helper, used by the tests). */
    function tileUrl(key, bbox, size) {
        return kvp(key, bbox, size, 'GetMap');
    }

    /** GetFeatureInfo URL for one pixel of a tile (identify helper). */
    function featureInfoUrl(key, bbox, size, x, y) {
        return kvp(key, bbox, size, 'GetFeatureInfo', { x: x, y: y });
    }

    /* ── the tile layer ──────────────────────────────────────────────────── */

    var IgnMdtLayer = L.TileLayer.extend({
        options: {
            mode: CONFIG.DEFAULT_MODE,
            tileSize: CONFIG.TILE_SIZE,
            minZoom: CONFIG.MIN_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            maxNativeZoom: CONFIG.MAX_NATIVE_ZOOM,
            keepBuffer: CONFIG.KEEP_BUFFER,
            opacity: CONFIG.OPACITY,
            attribution: CONFIG.ATTRIBUTION,
            // A failed tile is "no data / service hiccup", not an error page:
            // Leaflet swaps in a transparent pixel.
            errorTileUrl: BLANK_TILE,
            updateWhenZooming: false,
            updateWhenIdle: true,
            noWrap: true,
            crossOrigin: CONFIG.CROSS_ORIGIN
        },

        initialize: function (options) {
            L.setOptions(this, options || {});
            if (!this.options.bounds) {
                this.options.bounds = L.latLngBounds(CONFIG.BOUNDS);
            }
            this._warned = false;
            // L.TileLayer's own initialize takes (url, options); the URL is
            // computed per tile, so pass an empty template.
            L.TileLayer.prototype.initialize.call(this, '', this.options);
        },

        onAdd: function (map) {
            L.TileLayer.prototype.onAdd.call(this, map);
            this.on('tileerror', this._onTileError, this);
        },

        onRemove: function (map) {
            this.off('tileerror', this._onTileError, this);
            L.TileLayer.prototype.onRemove.call(this, map);
        },

        // One warning per layer, never one per tile.
        _onTileError: function () {
            if (this._warned) return;
            this._warned = true;
            console.warn('[IgnMdt] a "' + mode(this.options.mode).layer +
                '" tile could not be loaded (service error or outside coverage); ' +
                'further failures are silent');
        },

        /**
         * One GetMap per tile. The tile extent comes from Leaflet itself — the
         * layer never hardcodes a BBOX — and is projected to EPSG:3857, the SRS
         * the capabilities advertise and the grid the basemap uses.
         */
        getTileUrl: function (coords) {
            var bounds = this._tileCoordsToBounds(coords);
            var size = this.getTileSize();
            var crs = (this._map && this._map.options.crs) || L.CRS.EPSG3857;
            var sw = crs.project(bounds.getSouthWest());
            var ne = crs.project(bounds.getNorthEast());
            return tileUrl(this.options.mode, [sw.x, sw.y, ne.x, ne.y], size.x);
        },

        /**
         * Identify helper: the GetFeatureInfo request for a map point. The
         * service is queryable and answers with the vegetation/building height
         * at that pixel; no UI hook is wired because the previous layer had none.
         */
        getFeatureInfoUrl: function (latlng, options) {
            var opts = options || {};
            var size = opts.size || CONFIG.TILE_SIZE;
            var zoom = (opts.zoom !== undefined) ? opts.zoom
                : (this._map ? this._map.getZoom() : CONFIG.MAX_ZOOM);
            var crs = (this._map && this._map.options.crs) || L.CRS.EPSG3857;
            // Projected units per screen pixel (EPSG:3857: metres, constant
            // across the map because only ground resolution varies with lat).
            var resolution = opts.resolution || (156543.03392804097 / Math.pow(2, zoom));
            var half = (size / 2) * resolution;
            var p = crs.project(latlng);
            var bbox = [p.x - half, p.y - half, p.x + half, p.y + half];
            return featureInfoUrl(this.options.mode, bbox, size,
                Math.floor(size / 2), Math.floor(size / 2));
        },

        /** Switch products without rebuilding the layer (one product today). */
        setMode: function (key) {
            if (!CONFIG.MODES[key] || key === this.options.mode) return this;
            this.options.mode = key;
            this._warned = false;
            if (this._map) this.redraw();
            return this;
        },

        getMode: function () { return this.options.mode; }
    });

    function createLayer(options) {
        return new IgnMdtLayer(options || {});
    }

    root.IgnMdt = {
        CONFIG: CONFIG,
        MODES: CONFIG.MODES,
        BLANK_TILE: BLANK_TILE,
        Layer: IgnMdtLayer,
        wmsUrl: wmsUrl,
        tileUrl: tileUrl,
        featureInfoUrl: featureInfoUrl,
        createLayer: createLayer,
        modeKeys: function () { return Object.keys(CONFIG.MODES); }
    };
})(typeof window !== 'undefined' ? window : this);
