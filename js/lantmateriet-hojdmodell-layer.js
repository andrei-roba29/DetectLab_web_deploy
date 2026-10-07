/*
 * lantmateriet-hojdmodell-layer.js
 * ───────────────────────────────────────────────────────────────────────────
 * Sweden — terrain shading ("terrängskuggning") and slope images
 * ("terränglutning") from Lantmäteriet's national LiDAR-based height model,
 * fetched live as the user pans and zooms. One WMS GetMap request per Leaflet
 * tile. Nothing is downloaded or pre-generated.
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  READ THIS BEFORE CHANGING CONFIG.SOURCE                              ║
 * ║                                                                       ║
 * ║  https://minkarta.lantmateriet.se/map/hojdmodell is the backend of    ║
 * ║  Lantmäteriet's own viewer "Min karta". It answers without any        ║
 * ║  credentials, but it is NOT a public interface for third parties.     ║
 * ║  Its GetCapabilities carries the INSPIRE metadata id                  ║
 * ║  fdd69965-97f5-4296-88de-0f1a4316eafa, which is the record for the    ║
 * ║  product "Markhöjdmodell Visning" (ex "Höjdmodell Visning"). That     ║
 * ║  record states: "Licens för användning av resurs krävs. Avgift för    ║
 * ║  användning av resurs tas ut." The Geotorget product card prices it   ║
 * ║  at 75 625 kr/year incl. VAT and publishes the real access point as   ║
 * ║  https://maps.lantmateriet.se/hojdmodell/wms/v1.1 — which answers     ║
 * ║  401 Authorization Required.                                          ║
 * ║                                                                       ║
 * ║  ⇒ 'geotorget' (the licensed service, credentials added by our own    ║
 * ║    server-side proxy) is the DEFAULT and the only source fit for      ║
 * ║    production.                                                        ║
 * ║  ⇒ 'minkarta' exists only so the layer can be looked at locally while ║
 * ║    a Geotorget agreement is being signed. It logs a loud warning and  ║
 * ║    must never be shipped to visitors.                                 ║
 * ║                                                                       ║
 * ║  Full evidence, licence analysis and alternatives:                    ║
 * ║  SWEDEN_LIDAR_LANTMATERIET.md                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Verified live on 2026-10-07 against
 * minkarta.lantmateriet.se/map/hojdmodell (details in the .md):
 *   • Server is MapServer (errors come back as "msWMSLoadGetMapParams(): …").
 *   • Service title "Visningstjänst höjdmodell", WMS 1.1.1 and 1.3.0.
 *   • FOUR layers, not one: terrangskuggning, terranglutning,
 *     terranglutning_brunton, ursprung_kvalitet.
 *   • Supported CRS include epsg:3857 — so no proj4leaflet and no custom
 *     CRS are needed; the tiles line up with the Web-Mercator basemap.
 *   • Formats: image/png, image/jpeg, image/png; mode=8bit.
 *   • MaxWidth / MaxHeight = 4096 ⇒ 256 px tiles are far inside the cap.
 *   • EX_GeographicBoundingBox 6.31918 53.90617 → 29.28575 72.0992.
 *   • NO ScaleHint and NO Min/MaxScaleDenominator anywhere ⇒ the server
 *     advertises no scale limits, so the zoom window below is our own
 *     politeness policy, not something the service asked for.
 *   • GetMap with SRS=EPSG:3857 returns a real 256×256 RGBA PNG, as does the
 *     native SRS=EPSG:3006 request.
 *   • An invalid LAYERS value returns an OGC ServiceException document
 *     (application/vnd.ogc.se_xml), NOT an image — hence errorTileUrl below.
 *
 * Exposes `window.LantmaterietHojdmodell`:
 *   .CONFIG / .MODES
 *   .source()                        → 'geotorget' | 'minkarta'
 *   .endpoint()                      → proxy path or direct service URL
 *   .isProxied()                     → true when nothing secret is in the browser
 *   .tileUrl(mode, bbox, size)       → pure URL builder (used by the tests)
 *   .createLayer(options)            → L.TileLayer subclass instance
 *   .modeKeys()
 *
 * No build step, no dependencies beyond Leaflet 1.x, no credentials in the
 * browser.
 */
(function (root) {
    'use strict';

    var L = root.L;
    if (!L) {
        console.error('[LantmaterietHojdmodell] Leaflet is not loaded — ' +
            'lantmateriet-hojdmodell-layer.js must load after leaflet.js');
        return;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  CONFIG — everything tunable lives here and nowhere else.
     *  NO USERNAME, PASSWORD OR TOKEN IS PART OF THIS BLOCK. The licensed
     *  service is reached through PROXY_PATH; the credentials are added by
     *  backend/src/routes/geoProxy.js (or the Netlify function / Cloudflare
     *  Worker / Nginx variants described in SWEDEN_LIDAR_LANTMATERIET.md).
     * ═══════════════════════════════════════════════════════════════════════ */
    var CONFIG = {
        /* ── which service to talk to ───────────────────────────────────────
         * 'geotorget' → the licensed product "Markhöjdmodell Visning", via
         *               our own same-origin proxy. PRODUCTION DEFAULT.
         * 'minkarta'  → the unauthenticated Min karta viewer backend.
         *               EVALUATION ONLY — see the banner at the top.
         * Override at runtime (before the map initialises) with:
         *     window.DETECTLAB_SE_WMS_SOURCE = 'minkarta';
         */
        SOURCE: 'geotorget',

        // Same-origin proxy that adds the Geotorget credentials server-side
        // and caches tiles for 7 days.
        PROXY_PATH: '/api/geo/se-hojdmodell',

        // The licensed access point, as published on the Geotorget product
        // card. Requested by the proxy, never by the browser.
        GEOTORGET_URL: 'https://maps.lantmateriet.se/hojdmodell/wms/v1.1',

        // The Min karta viewer backend. Evaluation only.
        MINKARTA_URL: 'https://minkarta.lantmateriet.se/map/hojdmodell',

        /* ── WMS request shape ──────────────────────────────────────────────
         * 1.1.1 on purpose: it takes SRS= and always uses minx,miny,maxx,maxy.
         * WMS 1.3.0 would take CRS= and swaps the axis order for geographic
         * CRSs such as EPSG:4326 — a classic source of flipped/offset
         * hillshade. EPSG:3857 is easting/northing so it would be safe either
         * way, but 1.1.1 removes the question entirely.
         */
        VERSION: '1.1.1',
        CRS: 'EPSG:3857',      // advertised by the service; same grid as the basemap
        FORMAT: 'image/png',   // PNG ⇒ real transparency over the basemap
        TRANSPARENT: 'true',
        STYLES: '',            // every layer publishes a single default style
        TILED: 'true',         // hint: the server may cache grid-aligned requests
        TILE_SIZE: 256,

        DEFAULT_MODE: 'terrangskuggning',

        /* Layer names exactly as published by GetCapabilities.
         * The service advertises no scale limits, so minZoom is ours. */
        MODES: {
            terrangskuggning: {
                label: 'Terrängskuggning · hillshade (DTM 1 m)',
                layer: 'terrangskuggning',
                minZoom: 8
            },
            terranglutning: {
                label: 'Terränglutning · slope, greyscale',
                layer: 'terranglutning',
                minZoom: 8
            },
            terranglutning_brunton: {
                label: 'Terränglutning · slope, brown/purple',
                layer: 'terranglutning_brunton',
                minZoom: 8
            },
            ursprung_kvalitet: {
                label: 'Ursprung och kvalitet · source & quality',
                layer: 'ursprung_kvalitet',
                minZoom: 8
            }
        },

        OPACITY: 0.7,          // the brief's default

        /* Zoom window.
         * MIN_ZOOM 8  — at z8 one 256 px tile already spans ~156 km and the
         *               server has to shade a 1 m DEM across it. Going lower
         *               is pure load for no visible detail.
         * MAX_NATIVE_ZOOM 17 — the model is a 1 m grid. At 60° N one pixel at
         *               z16 is ~1.2 m and at z17 ~0.6 m, so 17 is already
         *               oversampled; above it Leaflet upscales the last real
         *               tiles instead of asking for more.
         */
        MIN_ZOOM: 8,
        MAX_NATIVE_ZOOM: 17,
        MAX_ZOOM: 20,

        KEEP_BUFFER: 1,        // public government server: barely preload
        CROSS_ORIGIN: false,   // plain <img> tiles need no CORS

        /* Coverage clip. The capabilities bounding box (6.31918 53.90617 →
         * 29.28575 72.0992) is the MapServer extent and spills far into the
         * North Sea, Norway and Finland where there is no data, so we clip to
         * Sweden proper instead and almost no request leaves the covered area.
         * The corners are Sweden's real extremes, rounded outwards:
         *   S 55.336 (Smygehuk)   N 69.060 (Treriksröset)
         *   W 10.958 (Stora Drammen, Koster)  E 24.156 (Kataja)
         * A rectangle cannot do better than this — Malmö and Copenhagen are
         * 25 km apart across the Öresund, so southern Denmark's corner is
         * unavoidably inside the box. Those tiles simply come back empty. */
        BOUNDS: [[55.20, 10.80], [69.20, 24.30]],
        SERVICE_BOUNDS: [[53.90617, 6.31918], [72.0992, 29.28575]],

        /* Attribution. "Markhöjdmodell Visning" is a licensed, fee-based
         * product — it is NOT part of Lantmäteriet's CC0 open data. The
         * agreement requires the source mark © Lantmäteriet. */
        ATTRIBUTION: 'Terrängskuggning © <a href="https://www.lantmateriet.se/" ' +
            'target="_blank" rel="noopener">Lantmäteriet</a>',

        // Shown once, non-blocking, when the service answers 401/403.
        AUTH_MESSAGE: 'Missing or invalid Lantmäteriet (Geotorget) credentials'
    };
    /* ════════════════════════ end of configuration ═══════════════════════ */

    // Transparent 1×1 PNG. Leaflet swaps it in for a failed tile, so a
    // ServiceException document never becomes a broken-image icon.
    var BLANK_TILE = 'data:image/png;base64,' +
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    function mode(key) {
        return CONFIG.MODES[key] || CONFIG.MODES[CONFIG.DEFAULT_MODE];
    }

    var _warnedAboutMinkarta = false;

    /** 'geotorget' (default) or 'minkarta' (evaluation only). */
    function source() {
        var chosen = root.DETECTLAB_SE_WMS_SOURCE || CONFIG.SOURCE;
        if (chosen !== 'minkarta') return 'geotorget';
        if (!_warnedAboutMinkarta) {
            _warnedAboutMinkarta = true;
            console.warn('[LantmaterietHojdmodell] SOURCE="minkarta": requesting the ' +
                'Min karta viewer backend directly. That endpoint is the fee-based ' +
                'product "Markhöjdmodell Visning" and is NOT licensed for third-party ' +
                'use. Evaluation only — switch to "geotorget" before deploying. ' +
                'See SWEDEN_LIDAR_LANTMATERIET.md.');
        }
        return 'minkarta';
    }

    /** True when no credential can possibly be in the browser. */
    function isProxied() {
        return source() === 'geotorget';
    }

    /** Proxy path (licensed service) or the Min karta URL (evaluation). */
    function endpoint() {
        return isProxied() ? CONFIG.PROXY_PATH : CONFIG.MINKARTA_URL;
    }

    /**
     * WMS 1.1.1 GetMap URL for one tile.
     * @param {string} key   mode key, e.g. 'terrangskuggning'
     * @param {number[]} bbox [minx, miny, maxx, maxy] in EPSG:3857 metres
     * @param {number} size  tile edge in pixels (256)
     * @returns {string}
     *
     * EPSG:3857 is an easting/northing CRS and WMS 1.1.1 has no axis-order
     * rule anyway, so the bbox is always minx,miny,maxx,maxy. Getting this
     * wrong is what produces an offset or mirrored hillshade.
     */
    function tileUrl(key, bbox, size) {
        var m = mode(key);
        var base = endpoint();
        return base +
            (base.indexOf('?') === -1 ? '?' : '&') +
            'SERVICE=WMS' +
            '&REQUEST=GetMap' +
            '&VERSION=' + CONFIG.VERSION +
            '&LAYERS=' + encodeURIComponent(m.layer) +
            '&STYLES=' + CONFIG.STYLES +
            '&SRS=' + encodeURIComponent(CONFIG.CRS) +
            '&BBOX=' + bbox.join(',') +
            '&WIDTH=' + size +
            '&HEIGHT=' + size +
            '&FORMAT=' + encodeURIComponent(CONFIG.FORMAT) +
            '&TRANSPARENT=' + CONFIG.TRANSPARENT +
            '&TILED=' + CONFIG.TILED;
    }

    /* ── a small, non-blocking notice for 401/403 ────────────────────────── */

    var noticeShown = false;
    function showAuthNotice(message) {
        if (noticeShown) return;
        noticeShown = true;
        if (typeof document === 'undefined' || !document.body) {
            console.warn('[LantmaterietHojdmodell] ' + message);
            return;
        }
        var box = document.createElement('div');
        box.id = 'seHojdmodellAuthNotice';
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

    var LantmaterietHojdmodellLayer = L.TileLayer.extend({
        options: {
            mode: CONFIG.DEFAULT_MODE,
            tileSize: CONFIG.TILE_SIZE,
            minZoom: CONFIG.MIN_ZOOM,
            maxNativeZoom: CONFIG.MAX_NATIVE_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            keepBuffer: CONFIG.KEEP_BUFFER,
            opacity: CONFIG.OPACITY,
            attribution: CONFIG.ATTRIBUTION,
            // A ServiceException or a 401 must never show a broken image.
            errorTileUrl: BLANK_TILE,
            // Don't re-queue tiles on every frame of a pinch/scroll zoom.
            updateWhenZooming: false,
            updateWhenIdle: true,
            noWrap: true,
            crossOrigin: CONFIG.CROSS_ORIGIN
        },

        initialize: function (options) {
            L.setOptions(this, options || {});
            // Clip to Sweden so no request leaves the covered area.
            if (!this.options.bounds) {
                this.options.bounds = L.latLngBounds(CONFIG.BOUNDS);
            }
            this.options.minZoom = mode(this.options.mode).minZoom || CONFIG.MIN_ZOOM;
            this._warned = false;
            this._authChecked = false;
            // The real URL is built per tile in getTileUrl(); this template is
            // only a placeholder for L.TileLayer's constructor.
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
            // Leaflet's own tile extent, projected with the map's CRS, is what
            // guarantees the hillshade lands exactly on the basemap tile.
            var bounds = this._tileCoordsToBounds(coords);
            var size = this.getTileSize();
            var crs = (this._map && this._map.options && this._map.options.crs) || L.CRS.EPSG3857;
            var sw = crs.project(bounds.getSouthWest());
            var ne = crs.project(bounds.getNorthEast());
            return tileUrl(this.options.mode, [sw.x, sw.y, ne.x, ne.y], size.x);
        },

        // One warning per layer, never one per tile. The first failure also
        // triggers a single probe that tells a credentials problem (401/403)
        // apart from an ordinary gap in the data.
        _onTileError: function () {
            if (!this._warned) {
                this._warned = true;
                console.warn('[LantmaterietHojdmodell] some ' + mode(this.options.mode).layer +
                    ' tiles are unavailable; further failures are silent');
            }
            this._probeAuthOnce();
        },

        _probeAuthOnce: function () {
            if (this._authChecked || typeof fetch !== 'function') return;
            this._authChecked = true;
            // One 1×1 px request over central Sweden, not a full tile run.
            var url = tileUrl(this.options.mode, [1990000, 8250000, 1990100, 8250100], 1);
            fetch(url, { method: 'GET', cache: 'no-store' }).then(function (res) {
                if (res.status === 401 || res.status === 403) {
                    showAuthNotice(CONFIG.AUTH_MESSAGE);
                    return;
                }
                var type = res.headers && res.headers.get && res.headers.get('content-type');
                if (type && type.indexOf('xml') !== -1) {
                    res.text().then(function (body) {
                        if (/not authori[sz]ed|unauthorized|credential|login/i.test(body)) {
                            showAuthNotice(CONFIG.AUTH_MESSAGE);
                        }
                    }).catch(function () { /* ignore */ });
                }
            }).catch(function () {
                // Network/CORS failure: say nothing rather than guess. The
                // service sends no CORS header we can rely on, so a rejected
                // fetch() here does not mean the <img> tiles are broken.
            });
        },

        /** Switch product in place, without rebuilding the layer. */
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
        return new LantmaterietHojdmodellLayer(options || {});
    }

    root.LantmaterietHojdmodell = {
        CONFIG: CONFIG,
        MODES: CONFIG.MODES,
        BLANK_TILE: BLANK_TILE,
        Layer: LantmaterietHojdmodellLayer,
        source: source,
        endpoint: endpoint,
        isProxied: isProxied,
        tileUrl: tileUrl,
        createLayer: createLayer,
        showAuthNotice: showAuthNotice,
        modeKeys: function () { return Object.keys(CONFIG.MODES); }
    };
})(typeof window !== 'undefined' ? window : this);
