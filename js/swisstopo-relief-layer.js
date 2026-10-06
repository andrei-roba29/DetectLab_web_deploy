/*
 * swisstopo-relief-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * Switzerland — relief shading of the national LiDAR terrain models
 * (swissALTI3D / swissSURFACE3D / swissBATHY3D), fetched live from swisstopo's
 * public RESTful WMTS on geo.admin.ch as the user pans and zooms. Nothing is
 * downloaded or pre-generated.
 *
 * Why this file exists
 *   The Switzerland row used to call the WMS https://wms.geo.admin.ch/ with
 *   LAYERS=ch.swisstopo.swisssurface3d.metadata — the *metadata* layer of
 *   swissSURFACE3D, i.e. the acquisition footprints and their attributes, not
 *   terrain imagery. The requests succeeded and drew (at best) tile outlines.
 *   The real relief products are published as a ready-made WMTS cache whose
 *   "3857" matrix set is the standard XYZ grid, so they drop straight into
 *   Leaflet with no projection work at all.
 *
 * Verified live on 2026-10-06 (full report in SWITZERLAND_LIDAR_SWISSTOPO.md):
 *   • GetCapabilities https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml
 *     lists ch.swisstopo.swissalti3d-reliefschattierung ("swissALTI3D
 *     multidirektionales Relief"), format image/png, Dimension Time with the
 *     single value "current" (= default), TileMatrixSet "3857_18".
 *   • The matrix set 3857_18 is the standard Web-Mercator pyramid: origin
 *     -20037508.342789244 / 20037508.342789244, 256 px tiles, levels 0…18
 *     ⇒ maxNativeZoom = 18 (read, not guessed).
 *   • WGS84 bounding box 5.140242 45.398181 → 11.47757 48.230651
 *     (Switzerland + Liechtenstein + a margin of neighbouring territory).
 *   • Tiles: z11 and z14 and z18 all return 200 image/png (84 kB / 80 kB /
 *     25 kB); z19 returns an application/json error ⇒ the pyramid really does
 *     stop at 18.
 *   • access-control-allow-origin: * on every tile ⇒ <img> tiles work and
 *     fetch()/canvas reads work too. HTTPS throughout, no mixed content.
 *   • Served by CloudFront with cache-control
 *     "public, max-age=14400, s-maxage=31556952".
 *
 * Exposes `window.SwisstopoRelief`:
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
        console.error('[SwisstopoRelief] Leaflet is not loaded — swisstopo-relief-layer.js must load after leaflet.js');
        return;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  CONFIG — everything tunable lives here and nowhere else.
     * ═══════════════════════════════════════════════════════════════════════ */
    var CONFIG = {
        // Public RESTful WMTS endpoint — no key, no token, HTTPS only.
        // Full path pattern:
        //   {HOST}/1.0.0/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{x}/{y}.{ext}
        HOST: 'https://wmts.geo.admin.ch',

        // Optional caching proxy / CDN in front of the public service; see the
        // Nginx and Cloudflare Worker snippets in SWITZERLAND_LIDAR_SWISSTOPO.md:
        //   window.SWISSTOPO_PROXY_HOST = 'https://swisstopo-cache.example.com';
        PROXY_HOST: root.SWISSTOPO_PROXY_HOST || '',

        VERSION: '1.0.0',
        STYLE: 'default',
        // "current" = the latest version of the data. It is the only Time value
        // these relief layers publish (checked in the capabilities); other
        // swisstopo layers additionally expose yearly timestamps.
        TIME: 'current',
        TILE_MATRIX_SET: '3857',   // = EPSG:3857 Web Mercator, the standard XYZ grid
        EXT: 'png',

        DEFAULT_MODE: 'relief',

        // Layer identifiers exactly as published by GetCapabilities, each with
        // the maximum zoom of ITS OWN TileMatrixSet (3857_18 → 18, 3857_17 → 17).
        MODES: {
            relief: {
                label: 'swissALTI3D · multidirectional relief',
                layer: 'ch.swisstopo.swissalti3d-reliefschattierung',
                maxNativeZoom: 18          // TileMatrixSet 3857_18
            },
            mono: {
                // One light source from the north-west: harder shadows, often
                // the better read for small earthworks and terraces.
                label: 'swissALTI3D · mono-directional relief (NW)',
                layer: 'ch.swisstopo.swissalti3d-reliefschattierung_monodirektional',
                maxNativeZoom: 18          // TileMatrixSet 3857_18
            },
            surface: {
                // swissSURFACE3D = the LiDAR *surface* model (canopy, buildings).
                label: 'swissSURFACE3D · surface relief',
                layer: 'ch.swisstopo.swisssurface3d-reliefschattierung-multidirektional',
                maxNativeZoom: 18          // TileMatrixSet 3857_18
            },
            bathy: {
                // Lake floors — relevant for Swiss pile-dwelling sites.
                label: 'swissBATHY3D · lake-floor relief',
                layer: 'ch.swisstopo.swissbathy3d-reliefschattierung',
                maxNativeZoom: 17          // TileMatrixSet 3857_17
            }
        },

        OPACITY: 0.7,
        MIN_ZOOM: 7,            // it is a pre-generated cache, so low zoom is cheap
        MAX_ZOOM: 20,           // above maxNativeZoom Leaflet upscales
        TILE_SIZE: 256,
        KEEP_BUFFER: 1,         // public government service: barely preload
        CROSS_ORIGIN: false,    // plain <img> tiles need no CORS (ACAO is * anyway)

        // Coverage from the capabilities: 5.140242 45.398181 → 11.47757 48.230651
        // (Switzerland + Liechtenstein, with a margin of neighbouring country).
        BOUNDS: [[45.398181, 5.140242], [48.230651, 11.47757]],

        ATTRIBUTION: '© <a href="https://www.swisstopo.admin.ch/" target="_blank" ' +
            'rel="noopener">swisstopo</a>'
    };
    /* ════════════════════════ end of configuration ═══════════════════════ */

    // Transparent 1×1 PNG: shown instead of a broken image when a tile 404s
    // (outside the cached area) or the service hiccups.
    var BLANK_TILE = 'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function mode(key) {
        return CONFIG.MODES[key] || CONFIG.MODES[CONFIG.DEFAULT_MODE];
    }

    /**
     * RESTful WMTS template for Leaflet / OpenLayers XYZ sources.
     * The "3857" matrix set is the standard XYZ grid, so the path segments map
     * straight to {z}/{x}/{y} — TileMatrix = z, TileCol = x, TileRow = y.
     */
    function tileTemplate(key) {
        var m = mode(key);
        var base = (CONFIG.PROXY_HOST || CONFIG.HOST).replace(/\/+$/, '');
        return base + '/' + CONFIG.VERSION + '/' + m.layer + '/' + CONFIG.STYLE + '/' +
            CONFIG.TIME + '/' + CONFIG.TILE_MATRIX_SET + '/{z}/{x}/{y}.' + CONFIG.EXT;
    }

    /** One concrete tile URL (pure helper, handy for tests and debugging). */
    function tileUrl(key, z, x, y) {
        return tileTemplate(key)
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y);
    }

    /* ── the tile layer ──────────────────────────────────────────────────── */

    var SwisstopoReliefLayer = L.TileLayer.extend({
        options: {
            mode: CONFIG.DEFAULT_MODE,
            tileSize: CONFIG.TILE_SIZE,
            minZoom: CONFIG.MIN_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            maxNativeZoom: CONFIG.MODES[CONFIG.DEFAULT_MODE].maxNativeZoom,
            keepBuffer: CONFIG.KEEP_BUFFER,
            opacity: CONFIG.OPACITY,
            attribution: CONFIG.ATTRIBUTION,
            // A 404 outside the cached area means "no tile here", not an error:
            // Leaflet swaps in a transparent pixel instead of a broken image.
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

        // One warning per layer, never one per tile: beyond the data edge a
        // 404 is normal and must not flood the console.
        _onTileError: function () {
            if (this._warned) return;
            this._warned = true;
            console.warn('[SwisstopoRelief] some ' + mode(this.options.mode).layer +
                ' tiles are unavailable (outside coverage or service error); ' +
                'further failures are silent');
        },

        /** Switch relief product in place (each has its own maxNativeZoom). */
        setMode: function (key) {
            if (!CONFIG.MODES[key] || key === this.options.mode) return this;
            this.options.mode = key;
            this.options.maxNativeZoom = mode(key).maxNativeZoom;
            this._warned = false;
            this.setUrl(tileTemplate(key));
            return this;
        },

        getMode: function () { return this.options.mode; }
    });

    function createLayer(options) {
        return new SwisstopoReliefLayer(options || {});
    }

    root.SwisstopoRelief = {
        CONFIG: CONFIG,
        MODES: CONFIG.MODES,
        BLANK_TILE: BLANK_TILE,
        Layer: SwisstopoReliefLayer,
        tileTemplate: tileTemplate,
        tileUrl: tileUrl,
        createLayer: createLayer,
        modeKeys: function () { return Object.keys(CONFIG.MODES); }
    };
})(typeof window !== 'undefined' ? window : this);
