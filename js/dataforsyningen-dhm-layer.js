/*
 * dataforsyningen-dhm-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * Denmark — hillshade of Danmarks Højdemodel ("skyggekort", the LiDAR-derived
 * national elevation model), fetched live from Dataforsyningen
 * (Klimadatastyrelsen, ex-SDFI) as the user pans and zooms. Nothing is
 * downloaded or pre-generated.
 *
 * Why the WMS and not the WMTS
 *   The WMTS dhm_terraen_skyggekort_DAF publishes exactly ONE TileMatrixSet,
 *   "View1", and it is NOT the Web-Mercator/XYZ grid: CRS EPSG:25832
 *   (ETRS89 / UTM 32N), top-left corner 120000 / 6500000, 256 px tiles,
 *   14 levels (scale 5 851 428.57 → 714.29, i.e. 1638.4 → 0.2 m/px), and the
 *   tiles are image/jpeg (no transparency). Consuming that grid in Leaflet
 *   means proj4leaflet + switching the WHOLE map to EPSG:25832, which would
 *   break every other layer in DetectLab (OSM, CORONA, the other countries).
 *   The same rasters are served by the WMS dhm_DAF, which advertises
 *   EPSG:3857 and image/png — so the server reprojects, the tiles line up
 *   with the existing basemap pixel-for-pixel, and transparency works.
 *   Trade-off: a WMS GetMap is rendered on demand (slower, not pre-cached)
 *   where a native-grid WMTS tile is a cache hit. That is what the caching
 *   proxy in §5 of DENMARK_LIDAR_DATAFORSYNINGEN.md is for.
 *
 * Verified live on 2026-10-06 (full report in DENMARK_LIDAR_DATAFORSYNINGEN.md):
 *   • WMTS GetCapabilities answers WITHOUT a token: layer
 *     dhm_terraen_skyggekort, format image/jpeg only, TileMatrixSet View1
 *     (EPSG:25832) only — no EPSG:3857 grid anywhere.
 *   • WMS  GetCapabilities (dhm_DAF) also answers without a token and lists
 *     EPSG:3857 among the supported CRS, image/png + image/jpeg, and the
 *     layers dhm_terraen_skyggekort, dhm_overflade_skyggekort,
 *     dhm_kurve_traditionel, dhm_kurve_0_5_m, dhm_kurve_0_25_m,
 *     dhm_kote_*, dhm_punktoprindelse, dhm_korrektion.
 *   • Layer extent (skyggekort): 7.99125 54.4265 → 15.5995 57.7781.
 *   • GetTile / GetMap WITHOUT a token → OGC ServiceException
 *     "User not authorized" ⇒ a token is mandatory for imagery.
 *   • TRANSPARENT must be spelled TRUE/FALSE in upper case, or the service
 *     answers "TRANSPARENT must be either TRUE or FALSE".
 *   • CORS: the API gateway ECHOES the request Origin
 *     (access-control-allow-origin: https://<your-site>) instead of "*", so
 *     <img> tiles, fetch() and canvas reads all work.
 *
 * TOKEN — never in this file, never in the repository
 *   Default (recommended): tiles are requested from THIS site's own backend
 *   proxy (CONFIG.PROXY_PATH), which adds the token server-side as the
 *   "token" HTTP header. The browser never sees it.
 *   Fallback (INSECURE, for static hosting with no backend): set
 *   window.DETECTLAB_DK_TOKEN before the map initialises and the module
 *   talks to api.dataforsyningen.dk directly with ?token=… — visible to
 *   every visitor. Use a dedicated, disposable token if you do this.
 *
 * Exposes `window.DataforsyningenDHM`:
 *   .CONFIG / .MODES
 *   .endpoint()                        → proxy path or direct service URL
 *   .isProxied()                       → true when no token is in the browser
 *   .tileUrl(mode, bbox, size, token)  → pure URL builder (used by the tests)
 *   .createLayer(options)              → L.TileLayer subclass instance
 *
 * No build step, no dependencies beyond Leaflet 1.x.
 */
(function (root) {
    'use strict';

    var L = root.L;
    if (!L) {
        console.error('[DataforsyningenDHM] Leaflet is not loaded — dataforsyningen-dhm-layer.js must load after leaflet.js');
        return;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  CONFIG — everything tunable lives here and nowhere else.
     *  THE TOKEN IS NOT PART OF THIS BLOCK: it is injected by the server-side
     *  proxy, or (insecure fallback) read from window.DETECTLAB_DK_TOKEN.
     * ═══════════════════════════════════════════════════════════════════════ */
    var CONFIG = {
        // Same-origin proxy that adds the token server-side and caches tiles.
        // Implementation: backend/src/routes/geoProxy.js (Express), plus
        // Nginx / Cloudflare Worker variants in the README.
        PROXY_PATH: '/api/geo/dk-dhm',

        // Direct service, used only in the insecure client-token fallback.
        DIRECT_URL: 'https://api.dataforsyningen.dk/dhm_DAF',

        WMS_VERSION: '1.3.0',
        CRS: 'EPSG:3857',        // same grid as the basemap ⇒ no reprojection in the client
        FORMAT: 'image/png',     // PNG ⇒ real transparency (the WMTS is JPEG only)
        TRANSPARENT: 'TRUE',     // must be upper case for this service
        STYLES: '',              // the layers publish a single default style
        TILE_SIZE: 256,

        DEFAULT_MODE: 'terrain',

        /* Layer names exactly as published by GetCapabilities. minZoom values
         * are derived from each layer's MaxScaleDenominator: the service
         * simply draws nothing above that scale.
         *   skyggekort   : MaxScaleDenominator 1e7   → usable from z6
         *   kurve_trad.  : MaxScaleDenominator 130000 → usable from z12
         *   kurve_0_5_m  : MaxScaleDenominator 16000  → usable from z15
         */
        MODES: {
            terrain: {
                label: 'DHM Terræn · hillshade (bare earth)',
                layer: 'dhm_terraen_skyggekort',
                minZoom: 6
            },
            surface: {
                label: 'DHM Overflade · hillshade (surface)',
                layer: 'dhm_overflade_skyggekort',
                minZoom: 6
            },
            contours: {
                label: 'DHM Højdekurver · contours 2.5 m',
                layer: 'dhm_kurve_traditionel',
                minZoom: 12
            },
            contoursFine: {
                label: 'DHM Højdekurver · contours 0.5 m',
                layer: 'dhm_kurve_0_5_m',
                minZoom: 15
            }
        },

        OPACITY: 0.6,           // JPEG-era default kept: the hillshade is opaque-ish
        MIN_ZOOM: 6,            // nothing is rendered above 1:10 000 000
        MAX_ZOOM: 20,
        KEEP_BUFFER: 1,         // public agency server: barely preload
        CROSS_ORIGIN: false,    // plain <img> tiles need no CORS

        // Coverage of the skyggekort layers from the WMS capabilities:
        // 7.99125 54.4265 → 15.5995 57.7781 (Denmark).
        BOUNDS: [[54.4265, 7.99125], [57.7781, 15.5995]],

        // Free geographic data under CC BY 4.0; the data owner is
        // Klimadatastyrelsen (the Danish Climate Data Agency, ex-SDFI).
        ATTRIBUTION: 'Indeholder data fra <a href="https://dataforsyningen.dk/" ' +
            'target="_blank" rel="noopener">Klimadatastyrelsen</a>, Danmarks Højdemodel ' +
            '(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" ' +
            'rel="noopener">CC BY 4.0</a>)',

        // Shown once, non-blocking, when the service answers 401/403.
        AUTH_MESSAGE: 'Invalid or missing Dataforsyningen token'
    };
    /* ════════════════════════ end of configuration ═══════════════════════ */

    // Transparent 1×1 PNG: shown instead of a broken image when a tile fails.
    var BLANK_TILE = 'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function mode(key) {
        return CONFIG.MODES[key] || CONFIG.MODES[CONFIG.DEFAULT_MODE];
    }

    /** The token, if the deployment chose the insecure client-side fallback. */
    function clientToken() {
        return root.DETECTLAB_DK_TOKEN || '';
    }

    /** True when tiles go through our own backend (no token in the browser). */
    function isProxied() {
        return !clientToken();
    }

    /** Proxy path (default) or the public service URL (client-token mode). */
    function endpoint() {
        return isProxied() ? CONFIG.PROXY_PATH : CONFIG.DIRECT_URL;
    }

    /**
     * WMS 1.3.0 GetMap URL for one tile.
     * EPSG:3857 is an easting/northing CRS, so the 1.3.0 axis order is
     * minx,miny,maxx,maxy — no lat/lon swap (that trap only bites EPSG:4326).
     * `token` is appended only in the insecure direct mode; in proxy mode the
     * backend adds it as a request header and it never reaches the browser.
     */
    function tileUrl(key, bbox, size, token) {
        var m = mode(key);
        var base = token ? CONFIG.DIRECT_URL : CONFIG.PROXY_PATH;
        var url = base +
            (base.indexOf('?') === -1 ? '?' : '&') +
            'service=WMS' +
            '&request=GetMap' +
            '&version=' + CONFIG.WMS_VERSION +
            '&layers=' + m.layer +
            '&styles=' + CONFIG.STYLES +
            '&crs=' + CONFIG.CRS +
            '&bbox=' + bbox.join(',') +
            '&width=' + size +
            '&height=' + size +
            '&format=' + encodeURIComponent(CONFIG.FORMAT) +
            '&transparent=' + CONFIG.TRANSPARENT;
        if (token) url += '&token=' + encodeURIComponent(token);
        return url;
    }

    /* ── a small, non-blocking notice for 401/403 ────────────────────────── */

    var noticeShown = false;
    function showAuthNotice(message) {
        if (noticeShown) return;
        noticeShown = true;
        if (typeof document === 'undefined' || !document.body) {
            console.warn('[DataforsyningenDHM] ' + message);
            return;
        }
        var box = document.createElement('div');
        box.id = 'dkDhmTokenNotice';
        box.setAttribute('role', 'status');
        box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
            'z-index:12000;background:rgba(20,18,16,0.92);color:#f5f0eb;border:1px solid rgba(245,240,235,0.25);' +
            'border-radius:8px;padding:8px 12px;font-size:0.8rem;max-width:min(92vw,420px);' +
            'box-shadow:0 4px 18px rgba(0,0,0,0.45);display:flex;align-items:center;gap:10px;';
        var text = document.createElement('span');
        text.textContent = message;
        var close = document.createElement('button');
        close.type = 'button';
        close.textContent = '✕';
        close.setAttribute('aria-label', 'Dismiss');
        close.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:0.9rem;';
        close.onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); };
        box.appendChild(text);
        box.appendChild(close);
        document.body.appendChild(box);
        setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 12000);
    }

    /* ── the tile layer ──────────────────────────────────────────────────── */

    var DataforsyningenDHMLayer = L.TileLayer.extend({
        options: {
            mode: CONFIG.DEFAULT_MODE,
            tileSize: CONFIG.TILE_SIZE,
            minZoom: CONFIG.MODES[CONFIG.DEFAULT_MODE].minZoom,
            maxZoom: CONFIG.MAX_ZOOM,
            keepBuffer: CONFIG.KEEP_BUFFER,
            opacity: CONFIG.OPACITY,
            attribution: CONFIG.ATTRIBUTION,
            // A failed tile must never show a broken-image icon.
            errorTileUrl: BLANK_TILE,
            updateWhenZooming: false,
            updateWhenIdle: true,
            noWrap: true,
            crossOrigin: CONFIG.CROSS_ORIGIN
        },

        initialize: function (options) {
            L.setOptions(this, options || {});
            // Clip to Denmark so no request leaves the covered area.
            if (!this.options.bounds) {
                this.options.bounds = L.latLngBounds(CONFIG.BOUNDS);
            }
            this.options.minZoom = mode(this.options.mode).minZoom || CONFIG.MIN_ZOOM;
            this._warned = false;
            this._authChecked = false;
            // The URL is built per tile in getTileUrl(); the template is only
            // a placeholder for L.TileLayer's constructor.
            L.TileLayer.prototype.initialize.call(this, endpoint(), this.options);
        },

        onAdd: function (map) {
            L.TileLayer.prototype.onAdd.call(this, map);
            this.on('tileerror', this._onTileError, this);
        },

        onRemove: function (map) {
            this.off('tileerror', this._onTileError, this);
            L.TileLayer.prototype.onRemove.call(this, map);
        },

        /** Build the WMS GetMap request for one tile. */
        getTileUrl: function (coords) {
            var bounds = this._tileCoordsToBounds(coords);
            var size = this.getTileSize();
            var crs = (this._map && this._map.options.crs) || L.CRS.EPSG3857;
            var sw = crs.project(bounds.getSouthWest());
            var ne = crs.project(bounds.getNorthEast());
            return tileUrl(this.options.mode,
                [sw.x, sw.y, ne.x, ne.y], size.x, clientToken());
        },

        // One warning per layer, never one per tile. The first failure also
        // triggers a single probe that tells a token problem (401/403) apart
        // from an ordinary gap in the data.
        _onTileError: function () {
            if (!this._warned) {
                this._warned = true;
                console.warn('[DataforsyningenDHM] some ' + mode(this.options.mode).layer +
                    ' tiles are unavailable; further failures are silent');
            }
            this._probeAuthOnce();
        },

        _probeAuthOnce: function () {
            if (this._authChecked || typeof fetch !== 'function') return;
            this._authChecked = true;
            var self = this;
            // One tiny request over Denmark (Copenhagen), not a full tile run.
            var url = tileUrl(this.options.mode,
                [1398000, 7490000, 1399000, 7491000], 1, clientToken());
            fetch(url, { method: 'GET', cache: 'no-store' }).then(function (res) {
                if (res.status === 401 || res.status === 403) {
                    showAuthNotice(CONFIG.AUTH_MESSAGE);
                    return;
                }
                var type = res.headers && res.headers.get && res.headers.get('content-type');
                if (type && type.indexOf('xml') !== -1) {
                    // The OGC exception body says "User not authorized".
                    res.text().then(function (body) {
                        if (/not authorized|token/i.test(body)) showAuthNotice(CONFIG.AUTH_MESSAGE);
                    }).catch(function () { /* ignore */ });
                }
            }).catch(function () {
                // Network/CORS failure: say nothing rather than guess.
                void self;
            });
        },

        /** Switch product in place (each has its own minimum zoom). */
        setMode: function (key) {
            if (!CONFIG.MODES[key] || key === this.options.mode) return this;
            this.options.mode = key;
            this.options.minZoom = mode(key).minZoom || CONFIG.MIN_ZOOM;
            this._warned = false;
            if (this._map) this.redraw();
            return this;
        },

        getMode: function () { return this.options.mode; }
    });

    function createLayer(options) {
        return new DataforsyningenDHMLayer(options || {});
    }

    root.DataforsyningenDHM = {
        CONFIG: CONFIG,
        MODES: CONFIG.MODES,
        BLANK_TILE: BLANK_TILE,
        Layer: DataforsyningenDHMLayer,
        endpoint: endpoint,
        isProxied: isProxied,
        tileUrl: tileUrl,
        createLayer: createLayer,
        showAuthNotice: showAuthNotice,
        modeKeys: function () { return Object.keys(CONFIG.MODES); }
    };
})(typeof window !== 'undefined' ? window : this);
