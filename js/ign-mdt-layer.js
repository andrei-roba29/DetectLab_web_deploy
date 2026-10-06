/*
 * ign-mdt-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * Spain — relief / hillshade of the national LiDAR-derived digital terrain
 * model (PNOA-LiDAR → MDT), from the Instituto Geográfico Nacional (IGN/IDEE)
 * WMTS tile cache, fetched live as the user pans and zooms. Nothing is
 * downloaded or pre-generated.
 *
 * Why this file exists
 *   The Spain row used to request the INSPIRE *WMS*
 *   (servicios.idee.es/wms-inspire/mdt, layer EL.ElevationGridCoverage with
 *   STYLES=Elevaciones). That style name is not what the service publishes,
 *   and a dynamically rendered elevation coverage is the wrong product for a
 *   relief overlay anyway — the requests succeeded and the tiles were empty.
 *
 *   The same data is published as a ready-made WMTS tile cache whose
 *   "GoogleMapsCompatible" matrix set IS the standard XYZ grid, so it drops
 *   straight into a Leaflet map with no projection work at all.
 *
 * Verified live on 2026-10-06 (details in SPAIN_LIDAR_IGN_MDT.md):
 *   • GetCapabilities lists two layers: "Relieve" (shaded relief of the MDT)
 *     and "EL.ElevationGridCoverage" (INSPIRE elevation colours).
 *   • TileMatrixSet GoogleMapsCompatible = EPSG:3857, 256 px, levels 0…20.
 *   • A real tile returned 200, content-type image/png, 48 507 bytes,
 *     geowebcache-cache-result: HIT, geowebcache-gridset: GoogleMapsCompatible,
 *     and its geowebcache-tile-bounds matched the standard XYZ tile exactly
 *     ⇒ TileMatrix=z, TileCol=x, TileRow=y, no conversion needed.
 *   • access-control-allow-origin: * and HTTPS + HSTS ⇒ no CORS and no
 *     mixed-content problem.
 *   • Licence in the capabilities: "No se aplican condiciones" / CC BY 4.0
 *     (scne.es).
 *
 * Exposes `window.IgnMdt`:
 *   .CONFIG / .MODES
 *   .tileTemplate(mode)      → the {z}/{x}/{y} URL template (pure)
 *   .tileUrl(mode, z, x, y)  → one concrete tile URL (pure, used by the tests)
 *   .createLayer(options)    → L.TileLayer subclass instance
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
        // Public WMTS endpoint — no key, no token. HTTPS (the site is HTTPS).
        WMTS_URL: 'https://servicios.idee.es/wmts/mdt',

        // Optional caching proxy / CDN in front of the public server; see the
        // Nginx and Cloudflare Worker snippets in SPAIN_LIDAR_IGN_MDT.md.
        //   window.IGN_MDT_PROXY_URL = 'https://mdt-cache.example.com/wmts/mdt';
        PROXY_URL: root.IGN_MDT_PROXY_URL || '',

        DEFAULT_MODE: 'relieve',

        // Layer identifiers exactly as published by GetCapabilities.
        MODES: {
            relieve: {
                label: 'Relieve · hillshade (MDT)',
                layer: 'Relieve',
                style: 'default'
            },
            elevacion: {
                label: 'Elevación · INSPIRE colour ramp',
                layer: 'EL.ElevationGridCoverage',
                style: 'default'
            }
        },

        TILE_MATRIX_SET: 'GoogleMapsCompatible',   // = standard XYZ, EPSG:3857
        FORMAT: 'image/png',
        VERSION: '1.0.0',

        OPACITY: 0.7,
        MIN_ZOOM: 5,            // it is a pre-generated cache, so low zoom is cheap
        MAX_NATIVE_ZOOM: 20,    // real maximum from the capabilities (levels 0…20)
        MAX_ZOOM: 20,
        TILE_SIZE: 256,
        KEEP_BUFFER: 1,         // public government server: barely preload
        CROSS_ORIGIN: false,    // plain <img> tiles need no CORS

        // Coverage from the capabilities (EL.ElevationGridCoverage bounding
        // box −18.211 27.634 → 4.779 43.944): peninsula + Balearics + Canaries.
        // NOTE: the "Relieve" layer is in fact global outside Spain (GEBCO /
        // EMODnet / Copernicus bathymetry and relief), but this row is the
        // Spanish LiDAR layer, so requests are clipped to Spain.
        BOUNDS: [[27.63, -18.22], [43.95, 4.78]],

        ATTRIBUTION: 'Relieve © <a href="https://www.ign.es/" target="_blank" rel="noopener">' +
            'Instituto Geográfico Nacional de España</a> (CC BY 4.0)'
    };
    /* ════════════════════════ end of configuration ═══════════════════════ */

    // Transparent 1×1 PNG: Leaflet shows it instead of a broken image when a
    // tile 404s (outside the cached area) or fails.
    var BLANK_TILE = 'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function mode(key) {
        return CONFIG.MODES[key] || CONFIG.MODES[CONFIG.DEFAULT_MODE];
    }

    /**
     * WMTS KVP template for Leaflet / OpenLayers XYZ sources.
     * GoogleMapsCompatible maps 1:1 to XYZ: TileMatrix=z, TileCol=x, TileRow=y.
     */
    function tileTemplate(key) {
        var m = mode(key);
        var base = CONFIG.PROXY_URL || CONFIG.WMTS_URL;
        return base + '?service=WMTS&request=GetTile&version=' + CONFIG.VERSION +
            '&layer=' + encodeURIComponent(m.layer) +
            '&style=' + encodeURIComponent(m.style) +
            '&tilematrixset=' + encodeURIComponent(CONFIG.TILE_MATRIX_SET) +
            '&format=' + encodeURIComponent(CONFIG.FORMAT) +
            '&TileMatrix={z}&TileRow={y}&TileCol={x}';
    }

    /** One concrete tile URL (pure helper, handy for tests and debugging). */
    function tileUrl(key, z, x, y) {
        return tileTemplate(key)
            .replace('{z}', z)
            .replace('{y}', y)
            .replace('{x}', x);
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
            // A 404 outside the cached area is "no tile here", not an error:
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

        // One warning per layer, never one per tile: outside the cached area
        // 404s are normal and must not flood the console.
        _onTileError: function () {
            if (this._warned) return;
            this._warned = true;
            console.warn('[IgnMdt] some ' + mode(this.options.mode).layer +
                ' tiles are unavailable (outside coverage or service error); ' +
                'further failures are silent');
        },

        /** Switch Relieve ⇄ Elevación without rebuilding the layer. */
        setMode: function (key) {
            if (!CONFIG.MODES[key] || key === this.options.mode) return this;
            this.options.mode = key;
            this._warned = false;
            this.setUrl(tileTemplate(key));
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
        tileTemplate: tileTemplate,
        tileUrl: tileUrl,
        createLayer: createLayer,
        modeKeys: function () { return Object.keys(CONFIG.MODES); }
    };
})(typeof window !== 'undefined' ? window : this);
