/*
 * geoportal-nmt-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * Polish LiDAR-derived terrain shading (ISOK / NMT 1 m) from the official
 * GUGiK · Geoportal.gov.pl OGC services, fetched live as the user pans and
 * zooms. Nothing is downloaded or pre-generated.
 *
 * Why this file exists
 *   The previous Polish layer requested the GUGiK "Skorowidze" services
 *   (gugik:SkorowidzDanychPomiarowychLIDAR2011 …2026). Those publish the
 *   INDEX SHEETS of the LiDAR *measurement data* — survey metadata, not
 *   terrain imagery — so the requests succeeded (HTTP 200) and the tiles were
 *   effectively empty. The terrain shading lives in a different service.
 *
 * NO TOKENS. The Geoportal viewer internally uses
 *   https://mapy.geoportal.gov.pl/gprest/services/ISOK_Cien/MapServer/tile/
 *     {level}/{row}/{col}?token=…
 * That URL carries a viewer session token: it is not a public interface, it
 * expires, and it must never be embedded in a third-party site. This module
 * only uses the public, token-free OGC services published at
 * https://www.geoportal.gov.pl/pl/usluga/uslugi-przegladania-wms-i-wmts/
 *
 * Verified live on 2026-10-06 (details in POLAND_LIDAR_GEOPORTAL.md):
 *   • WMTS .../PZGIK/NMT/GRID1/WMTS/ShadedRelief exists (layer "Cieniowanie")
 *     but publishes ONLY the EPSG:2180 TileMatrixSet, 512 px tiles,
 *     image/jpeg → unusable as-is in a Web-Mercator Leaflet map.
 *   • WMS  .../PZGIK/NMT/GRID1/WMS/ShadedRelief — layer name "Raster",
 *     WMS 1.3.0, image/png, MaxWidth/MaxHeight 4096.
 *   • WMS  .../PZGIK/NMT/GRID1/WMS/Hypsometry   — layer name "Raster"
 *     ("Dynamiczna hipsometria"), EPSG:3857 advertised.
 *   • Both answer HTTPS, send CORS headers, and accept CRS=EPSG:3857
 *     (ShadedRelief does not advertise 3857 but reprojects it: the response
 *     is content-type image/png, not a ServiceException).
 *   ⇒ The WMS in EPSG:3857 is the simplest thing that renders aligned, so
 *     that is what this module uses. A per-tile EPSG:4326 code path exists as
 *     an automatic fallback in case the server ever starts rejecting 3857.
 *
 * Exposes `window.GeoportalNMT`:
 *   .CONFIG / .MODES
 *   .wmsUrl(mode)                     → service endpoint
 *   .tileUrl(mode, bbox, size, crs)   pure URL builder (used by the tests)
 *   .createLayer(options)             → L.TileLayer.WMS subclass instance
 *
 * No build step, no dependencies beyond Leaflet 1.x, no API keys, no tokens.
 */
(function (root) {
    'use strict';

    var L = root.L;
    if (!L) {
        console.error('[GeoportalNMT] Leaflet is not loaded — geoportal-nmt-layer.js must load after leaflet.js');
        return;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  CONFIG — everything tunable lives here and nowhere else.
     * ═══════════════════════════════════════════════════════════════════════ */
    var CONFIG = {
        // Public OGC endpoints (HTTPS — the site is HTTPS, so an http:// service
        // would be blocked as mixed content).
        WMS_BASE: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WMS/',

        // Optional caching proxy in front of the government server; see the
        // Nginx / Cloudflare Worker snippets in POLAND_LIDAR_GEOPORTAL.md.
        //   window.GEOPORTAL_NMT_PROXY_BASE = 'https://nmt-cache.example.com/.../WMS/';
        PROXY_BASE: root.GEOPORTAL_NMT_PROXY_BASE || '',

        DEFAULT_MODE: 'cieniowanie',

        // Service + layer names read from the live GetCapabilities documents.
        // Both services call their single layer "Raster".
        MODES: {
            cieniowanie: {
                label: 'Cieniowanie · hillshade (NMT 1 m)',
                service: 'ShadedRelief',
                layer: 'Raster'
            },
            hipsometria: {
                label: 'Hipsometria · colour relief',
                service: 'Hypsometry',
                layer: 'Raster'
            }
        },

        VERSION: '1.3.0',
        FORMAT: 'image/png',
        TRANSPARENT: true,
        STYLES: '',

        // EPSG:3857 keeps everything aligned with the basemap for free.
        // FALLBACK_CRS is used automatically if 3857 ever starts failing.
        CRS: 'EPSG:3857',
        FALLBACK_CRS: 'EPSG:4326',
        FALLBACK_AFTER_ERRORS: 6,

        OPACITY: 0.7,
        MIN_ZOOM: 10,          // below this a tile covers more than the server likes
        MAX_NATIVE_ZOOM: 18,   // 1 m grid; above this Leaflet upscales
        MAX_ZOOM: 20,
        TILE_SIZE: 256,        // WMS MaxWidth/MaxHeight is 4096 — well above this
        KEEP_BUFFER: 1,        // public government server: barely preload
        CROSS_ORIGIN: false,   // plain <img> tiles need no CORS

        // Poland only — EX_GeographicBoundingBox from the capabilities
        // (13.753705 48.880529 → 24.774761 54.950005), rounded outwards.
        BOUNDS: [[48.87, 13.74], [54.96, 24.79]],

        // Required attribution. The service metadata states that using it
        // means accepting the Geoportal Regulamin, so it is linked.
        ATTRIBUTION: 'Cieniowanie: © GUGiK / <a href="https://www.geoportal.gov.pl/" ' +
            'target="_blank" rel="noopener">Geoportal.gov.pl</a> (dane ISOK/NMT)'
    };
    /* ════════════════════════ end of configuration ═══════════════════════ */

    // Transparent 1×1 PNG: Leaflet swaps it in for failed tiles, so the user
    // never sees a broken-image icon.
    var BLANK_TILE = 'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function mode(key) {
        return CONFIG.MODES[key] || CONFIG.MODES[CONFIG.DEFAULT_MODE];
    }

    function wmsUrl(key) {
        var base = (CONFIG.PROXY_BASE || CONFIG.WMS_BASE).replace(/\/+$/, '');
        return base + '/' + mode(key).service;
    }

    function round(n, digits) {
        var f = Math.pow(10, digits === undefined ? 4 : digits);
        return Math.round(n * f) / f;
    }

    /**
     * Build a WMS GetMap request for one tile.
     * @param {String} key   mode key ('cieniowanie' | 'hipsometria')
     * @param {Array}  bbox  [minx, miny, maxx, maxy] — metres for EPSG:3857,
     *                       degrees for EPSG:4326 (already in 1.3.0 axis order)
     * @param {Number} size  tile size in pixels (square)
     * @param {String} crs   'EPSG:3857' or 'EPSG:4326'
     */
    function tileUrl(key, bbox, size, crs) {
        var px = size || CONFIG.TILE_SIZE;
        var useCrs = crs || CONFIG.CRS;
        var digits = (useCrs === 'EPSG:4326') ? 7 : 4;
        var params = [
            'SERVICE=WMS',
            'VERSION=' + CONFIG.VERSION,
            'REQUEST=GetMap',
            'LAYERS=' + encodeURIComponent(mode(key).layer),
            'STYLES=' + encodeURIComponent(CONFIG.STYLES),
            'CRS=' + encodeURIComponent(useCrs),
            'BBOX=' + bbox.map(function (v) { return round(v, digits); }).join(','),
            'WIDTH=' + px,
            'HEIGHT=' + px,
            'FORMAT=' + encodeURIComponent(CONFIG.FORMAT),
            'TRANSPARENT=' + (CONFIG.TRANSPARENT ? 'TRUE' : 'FALSE')
        ];
        return wmsUrl(key) + '?' + params.join('&');
    }

    /* ── the tile layer ──────────────────────────────────────────────────── */

    var GeoportalNMTLayer = L.TileLayer.extend({
        options: {
            mode: CONFIG.DEFAULT_MODE,
            crs: CONFIG.CRS,
            tileSize: CONFIG.TILE_SIZE,
            minZoom: CONFIG.MIN_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            maxNativeZoom: CONFIG.MAX_NATIVE_ZOOM,
            keepBuffer: CONFIG.KEEP_BUFFER,
            opacity: CONFIG.OPACITY,
            attribution: CONFIG.ATTRIBUTION,
            // Leaflet's own graceful fallback: a failed tile shows this
            // instead of a broken image.
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
            this._errorCount = 0;
            // L.TileLayer's own initialize takes (url, options); the URL is
            // computed per tile, so pass an empty template.
            L.TileLayer.prototype.initialize.call(this, '', this.options);
        },

        onAdd: function (map) {
            L.TileLayer.prototype.onAdd.call(this, map);
            // One warning per layer, never one per tile.
            this.on('tileerror', this._onTileError, this);
        },

        onRemove: function (map) {
            this.off('tileerror', this._onTileError, this);
            L.TileLayer.prototype.onRemove.call(this, map);
        },

        _onTileError: function () {
            this._errorCount++;
            if (!this._warned) {
                this._warned = true;
                console.warn('[GeoportalNMT] a ' + mode(this.options.mode).service +
                    ' tile could not be loaded; further failures are silent');
            }
            // EPSG:3857 is accepted by the server today but only EPSG:2180 /
            // 4326 are advertised for the hillshade. If 3857 ever starts
            // failing, fall back to per-tile EPSG:4326 requests instead of
            // leaving the user with an empty layer.
            if (this.options.crs === CONFIG.CRS &&
                this._errorCount >= CONFIG.FALLBACK_AFTER_ERRORS) {
                console.warn('[GeoportalNMT] switching to ' + CONFIG.FALLBACK_CRS +
                    ' tiles after repeated failures');
                this.options.crs = CONFIG.FALLBACK_CRS;
                this._errorCount = 0;
                this.redraw();
            }
        },

        /**
         * One GetMap per tile. The tile extent comes from Leaflet itself, so
         * the shading lands exactly where the basemap tile is.
         */
        getTileUrl: function (coords) {
            var bounds = this._tileCoordsToBounds(coords);
            var size = this.getTileSize();
            var sw = bounds.getSouthWest();
            var ne = bounds.getNorthEast();

            if (this.options.crs === 'EPSG:4326') {
                // WMS 1.3.0 + EPSG:4326 ⇒ axis order is lat,lon.
                return tileUrl(this.options.mode,
                    [sw.lat, sw.lng, ne.lat, ne.lng], size.x, 'EPSG:4326');
            }
            var crs = (this._map && this._map.options.crs) || L.CRS.EPSG3857;
            var swP = crs.project(sw);
            var neP = crs.project(ne);
            return tileUrl(this.options.mode,
                [swP.x, swP.y, neP.x, neP.y], size.x, 'EPSG:3857');
        },

        /** Switch Cieniowanie ⇄ Hipsometria without rebuilding the layer. */
        setMode: function (key) {
            if (!CONFIG.MODES[key] || key === this.options.mode) return this;
            this.options.mode = key;
            this._warned = false;
            this._errorCount = 0;
            if (this._map) this.redraw();
            return this;
        },

        getMode: function () { return this.options.mode; }
    });

    function createLayer(options) {
        return new GeoportalNMTLayer(options || {});
    }

    root.GeoportalNMT = {
        CONFIG: CONFIG,
        MODES: CONFIG.MODES,
        BLANK_TILE: BLANK_TILE,
        Layer: GeoportalNMTLayer,
        wmsUrl: wmsUrl,
        tileUrl: tileUrl,
        createLayer: createLayer,
        modeKeys: function () { return Object.keys(CONFIG.MODES); }
    };
})(typeof window !== 'undefined' ? window : this);
