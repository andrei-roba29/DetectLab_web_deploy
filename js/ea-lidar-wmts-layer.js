/*
 * ea-lidar-wmts-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * United Kingdom (England) — Environment Agency LIDAR Composite, fetched live
 * from the official public WMTS on environment.data.gov.uk as the user pans
 * and zooms. Nothing is downloaded or pre-generated.
 *
 * Why this file exists
 *   The UK row used to draw the same rasters through the *WMS* endpoint
 *   (…/geoservices/datasets/13787b9a-…/wms, one GetMap render per tile) and
 *   defaulted to the plain grey DTM. The identical rasters are also published
 *   as a ready-made, GeoWebCache-backed WMTS whose "WebMercatorQuad" matrix
 *   set is the standard XYZ grid — cheaper for a public government server,
 *   faster for us (most tiles answer "geowebcache-cache-result: HIT"), and a
 *   drop-in Leaflet tile layer with no projection work.
 *
 * Verified live on 2026-10-06 (full report in UK_LIDAR_EA_WMTS.md):
 *   • GetCapabilities …/lidar-composite-digital-terrain-model-dtm-1m/wmts
 *     publishes Lidar_Composite_Hillshade_DTM_1m, Lidar_Composite_DTM_1m and
 *     Lidar_Composite_Elevation_DTM_1m; formats image/png (default),
 *     image/jpeg, image/vnd.jpeg-png, image/png8; no Dimension, no key.
 *   • TileMatrixSets: WebMercatorQuad (used here), EPSG:900913, EPSG:4326 and
 *     British National Grid. WebMercatorQuad = EPSG:3857, 256 px, the same
 *     grid as OpenStreetMap ⇒ tileMatrix = z, tileCol = x, tileRow = y.
 *   • TileMatrixSetLimits for WebMercatorQuad run from level 0 to level 24
 *     ⇒ maxNativeZoom = 24 (read from the capabilities, not guessed).
 *     Confirmed live: z24 returns 200 image/png, z25 returns an XML
 *     ServiceException.
 *   • WGS84 bounding box of the hillshade layer:
 *     -7.104775741839742 49.85060473351981 → 2.0842821419111135 55.87708724246775
 *     (England; the box overlaps Wales/southern Scotland but the data does not).
 *   • Tiles: the documented example z15/16183/10989 returns 200 image/png.
 *     A tile *outside* the published limits (e.g. Edinburgh at z13) returns
 *     "text/xml" — a ServiceException, not an image — which is why the layer
 *     is clipped to the bounds below and falls back to a transparent pixel.
 *   • access-control-allow-origin: * on tile responses ⇒ <img> tiles work and
 *     so do fetch()/canvas reads. (Error responses carry no CORS header, but
 *     they are never requested inside the bounds.)
 *   • HTTPS throughout (Cloudflare in front of GeoServer/GeoWebCache), so no
 *     mixed-content problem on an https page. cache-control: max-age=120.
 *
 * Licence: Open Government Licence v3.0. Attribution statement required by
 * the dataset: "© Environment Agency copyright and/or database right 2022.
 * All rights reserved." — see CONFIG.ATTRIBUTION and the README.
 *
 * Exposes `window.EaLidarWmts`:
 *   .CONFIG / .MODES
 *   .tileTemplate(mode)      → the {z}/{x}/{y} URL template (pure)
 *   .tileUrl(mode, z, x, y)  → one concrete tile URL (pure, used by the tests)
 *   .boundsFor(mode)         → L.LatLngBounds of that layer's published extent
 *   .createLayer(options)    → L.TileLayer subclass instance
 *
 * No build step, no dependencies beyond Leaflet 1.x, no API keys, no tokens.
 */
(function (root) {
    'use strict';

    var L = root.L;
    if (!L) {
        console.error('[EaLidarWmts] Leaflet is not loaded — ea-lidar-wmts-layer.js must load after leaflet.js');
        return;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  CONFIG — everything tunable lives here and nowhere else.
     * ═══════════════════════════════════════════════════════════════════════ */
    var CONFIG = {
        // Public WMTS endpoint — no key, no token, HTTPS only. Each dataset
        // has its own service path under /spatialdata/<dataset>/wmts.
        HOST: 'https://environment.data.gov.uk',

        // Optional caching proxy / CDN in front of the public service; see the
        // Nginx and Cloudflare Worker snippets in UK_LIDAR_EA_WMTS.md:
        //   window.EA_LIDAR_PROXY_HOST = 'https://ea-lidar-cache.example.com';
        PROXY_HOST: root.EA_LIDAR_PROXY_HOST || '',

        // KVP GetTile parameters. The names are case-sensitive camelCase, and
        // the format value must stay percent-encoded (image%2Fpng).
        VERSION: '1.0.0',
        TILE_MATRIX_SET: 'WebMercatorQuad',  // = EPSG:3857, the standard XYZ grid
        FORMAT: 'image/png',                 // transparent PNG so the basemap shows through
        TRANSPARENT: true,                   // optional for PNG; harmless and explicit

        DEFAULT_MODE: 'hillshade',

        /* Layer identifiers exactly as published by GetCapabilities, each with
         * the maximum zoom and the WGS84 extent of ITS OWN capabilities entry.
         *   service  – path segment under /spatialdata/…/wmts
         *   layer    – WMTS layer identifier
         *   style    – GeoServer publishes an empty default style for these
         *              layers; the documented example sends style=hillshade and
         *              the server accepts either. Kept as documented.
         *   bounds   – [[southLat, westLng], [northLat, eastLng]]
         */
        MODES: {
            hillshade: {
                label: 'Hillshade DTM 1 m (terrain)',
                service: 'lidar-composite-digital-terrain-model-dtm-1m',
                layer: 'Lidar_Composite_Hillshade_DTM_1m',
                style: 'hillshade',
                maxNativeZoom: 24,
                bounds: [[49.85060473351981, -7.104775741839742],
                         [55.87708724246775, 2.0842821419111135]]
            },
            elevation: {
                // Colour-ramped elevation of the same 1 m DTM.
                label: 'Elevation DTM 1 m (colour)',
                service: 'lidar-composite-digital-terrain-model-dtm-1m',
                layer: 'Lidar_Composite_Elevation_DTM_1m',
                style: 'elevation',
                maxNativeZoom: 24,
                bounds: [[49.85060473351981, -7.104775741839742],
                         [55.87708724246775, 2.0842821419111135]]
            },
            dtm: {
                // The raw grey terrain model (what the row used to show).
                label: 'DTM 1 m (grey terrain model)',
                service: 'lidar-composite-digital-terrain-model-dtm-1m',
                layer: 'Lidar_Composite_DTM_1m',
                style: '',
                maxNativeZoom: 24,
                bounds: [[49.73965597228121, -7.8628214303032316],
                         [55.9815820801263, 2.6982849943441796]]
            },
            dsmHillshade: {
                // Sibling service: last-return SURFACE model — buildings,
                // vegetation and structures are included in the shading.
                label: 'Hillshade DSM 1 m (surface, last return)',
                service: 'lidar-composite-digital-surface-model-last-return-dsm-1m',
                layer: 'Lidar_Composite_Hillshade_LZ_DSM_1m',
                style: 'hillshade',
                maxNativeZoom: 24,
                bounds: [[49.81473356566392, -7.104718741179617],
                         [55.87721292831524, 2.150029768627088]]
            }
        },

        OPACITY: 0.7,
        MIN_ZOOM: 6,            // below this the whole of England is one screen
        MAX_ZOOM: 24,           // = the service maximum; Leaflet upscales above it
        TILE_SIZE: 256,
        KEEP_BUFFER: 1,         // public government service: barely preload
        CROSS_ORIGIN: false,    // plain <img> tiles need no CORS (ACAO is * anyway)

        // Default extent = the hillshade layer's published bounding box.
        // England only: the Environment Agency does not survey Scotland,
        // Wales or Northern Ireland.
        BOUNDS: [[49.85060473351981, -7.104775741839742],
                 [55.87708724246775, 2.0842821419111135]],

        // Open Government Licence v3.0 — both the OGL notice and the dataset's
        // own attribution statement.
        ATTRIBUTION: '© Environment Agency copyright and/or database right 2022 · ' +
            'Contains public sector information licensed under the ' +
            '<a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" ' +
            'target="_blank" rel="noopener">Open Government Licence v3.0</a>'
    };
    /* ════════════════════════ end of configuration ═══════════════════════ */

    // Transparent 1×1 PNG: shown instead of a broken image when a tile request
    // fails (outside the published limits the service answers with an XML
    // ServiceException, which an <img> treats as a load error).
    var BLANK_TILE = 'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function mode(key) {
        return CONFIG.MODES[key] || CONFIG.MODES[CONFIG.DEFAULT_MODE];
    }

    /**
     * KVP WMTS GetTile template for Leaflet / OpenLayers XYZ sources.
     * WebMercatorQuad is the standard XYZ grid, so the mapping is direct:
     * tileMatrix = {z}, tileCol = {x}, tileRow = {y}.
     */
    function tileTemplate(key) {
        var m = mode(key);
        var base = (CONFIG.PROXY_HOST || CONFIG.HOST).replace(/\/+$/, '');
        return base + '/spatialdata/' + m.service + '/wmts' +
            '?service=WMTS' +
            '&request=GetTile' +
            '&version=' + CONFIG.VERSION +
            '&layer=' + m.layer +
            '&style=' + (m.style || '') +
            '&tileMatrixSet=' + CONFIG.TILE_MATRIX_SET +
            '&format=' + encodeURIComponent(CONFIG.FORMAT) +
            '&transparent=' + (CONFIG.TRANSPARENT ? 'true' : 'false') +
            '&tileMatrix={z}&tileRow={y}&tileCol={x}';
    }

    /** One concrete tile URL (pure helper, handy for tests and debugging). */
    function tileUrl(key, z, x, y) {
        return tileTemplate(key)
            .replace('{z}', z)
            .replace('{y}', y)
            .replace('{x}', x);
    }

    /** The published extent of one product, as a Leaflet bounds object. */
    function boundsFor(key) {
        return L.latLngBounds(mode(key).bounds || CONFIG.BOUNDS);
    }

    /* ── the tile layer ──────────────────────────────────────────────────── */

    var EaLidarWmtsLayer = L.TileLayer.extend({
        options: {
            mode: CONFIG.DEFAULT_MODE,
            tileSize: CONFIG.TILE_SIZE,
            minZoom: CONFIG.MIN_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            maxNativeZoom: CONFIG.MODES[CONFIG.DEFAULT_MODE].maxNativeZoom,
            keepBuffer: CONFIG.KEEP_BUFFER,
            opacity: CONFIG.OPACITY,
            attribution: CONFIG.ATTRIBUTION,
            // Outside coverage the service returns an XML exception, which the
            // browser reports as a failed image: swap in a transparent pixel
            // rather than a broken-image icon.
            errorTileUrl: BLANK_TILE,
            updateWhenZooming: false,
            updateWhenIdle: true,
            noWrap: true,
            crossOrigin: CONFIG.CROSS_ORIGIN
        },

        initialize: function (options) {
            L.setOptions(this, options || {});
            // Clip to the product's own published extent unless the caller
            // supplied one, so no request is ever made outside coverage.
            if (!this.options.bounds) {
                this.options.bounds = boundsFor(this.options.mode);
            }
            this.options.maxNativeZoom = mode(this.options.mode).maxNativeZoom;
            this._warned = false;
            L.TileLayer.prototype.initialize.call(
                this, tileTemplate(this.options.mode), this.options);
        },

        onAdd: function (map) {
            L.TileLayer.prototype.onAdd.call(this, map);
            this.on('tileerror', this._onTileError, this);
        },

        onRemove: function (map) {
            this.off('tileerror', this._onTileError, this);
            L.TileLayer.prototype.onRemove.call(this, map);
        },

        // One warning per layer, never one per tile: at the edge of the survey
        // a failed tile is normal and must not flood the console.
        _onTileError: function () {
            if (this._warned) return;
            this._warned = true;
            console.warn('[EaLidarWmts] some ' + mode(this.options.mode).layer +
                ' tiles are unavailable (outside coverage or service error); ' +
                'further failures are silent');
        },

        /** Switch product in place (each has its own extent and zoom cap). */
        setMode: function (key) {
            if (!CONFIG.MODES[key] || key === this.options.mode) return this;
            this.options.mode = key;
            this.options.maxNativeZoom = mode(key).maxNativeZoom;
            this.options.bounds = boundsFor(key);
            this._warned = false;
            this.setUrl(tileTemplate(key));
            return this;
        },

        getMode: function () { return this.options.mode; }
    });

    function createLayer(options) {
        return new EaLidarWmtsLayer(options || {});
    }

    root.EaLidarWmts = {
        CONFIG: CONFIG,
        MODES: CONFIG.MODES,
        BLANK_TILE: BLANK_TILE,
        Layer: EaLidarWmtsLayer,
        tileTemplate: tileTemplate,
        tileUrl: tileUrl,
        boundsFor: boundsFor,
        createLayer: createLayer,
        modeKeys: function () { return Object.keys(CONFIG.MODES); }
    };
})(typeof window !== 'undefined' ? window : this);
