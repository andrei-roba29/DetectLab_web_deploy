/* ══════════════════════════════════════════════════════════════
   DetectLab — 3D Globe Country Gate (canvas edition)
   ──────────────────────────────────────────────────────────────
   The very first thing an authenticated visitor sees in the map
   card: an orthographic globe rendered on a plain 2D <canvas> with
   d3-geo. The Earth texture (Blue Marble + hillshade) is sampled
   per-pixel straight onto the canvas; every European country is tinted
   translucent grey-violet with a black border, hovering flips it to
   translucent neon-green, and clicking flies to the country before
   handing off to the Leaflet-controlled working map (js/map-app.js),
   whose permanent basemap is a MapLibre-rendered 3D globe.

   The gate deliberately stays canvas-based instead of using MapLibre
   for hit-testing: WebGL context loss/driver blacklists and unreliable
   feature-state picking previously made country selection fragile. The
   gate picture is drawn by us, and picking is pure geometry
   (projection.invert + d3.geoContains) so hover/click can't miss. The
   working map's separate MapLibre globe has an inline local style and a
   raster fallback if WebGL cannot start.

   Everything needed to draw the globe ships with the site:
     js/d3.min.js, js/topojson-client.min.js  (lazy-loaded, local)
     data/countries-50m.json                  (world-atlas TopoJSON)
     images/globe/earth-blue-marble.jpg/.png  (texture + topology)
   Optionally, higher-detail European coastlines are streamed in the
   background from the project's Natural Earth 10m shapefile on
   Supabase; the gate is fully usable before (and without) it.
   See GLOBE_COUNTRY_GATE.md.
   ══════════════════════════════════════════════════════════════ */
(function (window, document) {
    'use strict';
    if (!window || !document) return;

    /* ── Assets: local first, public mirror as fallback ── */
    var D3_JS = 'js/d3.min.js?v=7.9.0';
    var TOPOJSON_JS = 'js/topojson-client.min.js?v=3.1.0';
    var SHAPEFILE_JS = 'js/shapefile.js?v=0.6.6';
    var ATLAS_LOCAL = 'data/countries-50m.json?v=20261008';
    var ATLAS_REMOTE = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
    var TEXTURE_LOCAL = 'images/globe/earth-blue-marble.jpg?v=20261008';
    var TEXTURE_REMOTE = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg';
    var TOPOLOGY_LOCAL = 'images/globe/earth-topology.png?v=20261008';
    var TOPOLOGY_REMOTE = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png';
    var SHP_URL = 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/ne_10m_admin_0_countries.shp';

    var STORAGE_KEY = 'detectlab_selected_country_v1';
    var FETCH_TIMEOUT_MS = 20000;

    /* ── Locked country view ─────────────────────────────────────────────
       Once a country is picked the working map is pinned to it: the
       maxBounds box keeps every drag inside the country (maxBoundsViscosity
       1 snaps a gesture straight back) and the zoom floor is the fit zoom,
       so the user cannot wander off the chosen country. Zooming out to that
       floor is the signal for the “Exit view” button built by
       js/country-dock.js; the only other way out is picking another country
       from the dock glued to the search bar (or from this globe). The
       permanent 3D globe basemap is never replaced by a selection — see
       COUNTRY_SELECTION_DOCK.md. */
    var LOCK_PAD = 0.15;         // degrees of slack around the country bbox
    // Leaflet snaps the zoom to whole levels by default, so the floor has to be
    // a *reachable* step: one level below the fitted view. That is the “zoomed
    // out at maximum” state the dock's Exit view button watches for, and it is
    // also the only legal way out of a locked view (see js/country-dock.js).
    var LOCK_ZOOM_SLACK = 1;
    var FIT_MAX_ZOOM = 11;       // micro-states: never dive into a single street

    var CONTROL_IDS = ['mapSearchWrap', 'transpTab', 'transpPanel', 'verticalOpacityControl', 'verticalSatPeriodControl', 'mapHelpBtn'];

    // Every European (+ immediate-neighbour) ISO-3166-1 alpha-2 code the
    // picker will accept. Kept identical to the retired js/country-selector.js
    // list so coverage doesn't silently shrink. `alt` entries also cover the
    // exact spellings used by the world-atlas 50m dataset ("Bosnia and Herz.",
    // "Macedonia", "Vatican"…) so every country resolves to an ISO code.
    var NAMES = {
        AL: { en: 'Albania', ro: 'Albania' },
        AD: { en: 'Andorra', ro: 'Andorra' },
        AM: { en: 'Armenia', ro: 'Armenia' },
        AT: { en: 'Austria', ro: 'Austria' },
        AZ: { en: 'Azerbaijan', ro: 'Azerbaidjan' },
        BY: { en: 'Belarus', ro: 'Belarus' },
        BE: { en: 'Belgium', ro: 'Belgia' },
        BA: { en: 'Bosnia and Herzegovina', ro: 'Bosnia și Herțegovina', alt: ['bosnia and herz', 'bosnia & herzegovina'] },
        BG: { en: 'Bulgaria', ro: 'Bulgaria' },
        HR: { en: 'Croatia', ro: 'Croația' },
        CY: { en: 'Cyprus', ro: 'Cipru' },
        CZ: { en: 'Czechia', ro: 'Cehia', alt: ['czech republic'] },
        DK: { en: 'Denmark', ro: 'Danemarca' },
        EE: { en: 'Estonia', ro: 'Estonia' },
        FI: { en: 'Finland', ro: 'Finlanda' },
        FR: { en: 'France', ro: 'Franța' },
        GE: { en: 'Georgia', ro: 'Georgia' },
        DE: { en: 'Germany', ro: 'Germania' },
        GR: { en: 'Greece', ro: 'Grecia', alt: ['hellenic republic'] },
        HU: { en: 'Hungary', ro: 'Ungaria' },
        IS: { en: 'Iceland', ro: 'Islanda' },
        IE: { en: 'Ireland', ro: 'Irlanda' },
        IT: { en: 'Italy', ro: 'Italia' },
        XK: { en: 'Kosovo', ro: 'Kosovo' },
        LV: { en: 'Latvia', ro: 'Letonia' },
        LI: { en: 'Liechtenstein', ro: 'Liechtenstein' },
        LT: { en: 'Lithuania', ro: 'Lituania' },
        LU: { en: 'Luxembourg', ro: 'Luxemburg' },
        MT: { en: 'Malta', ro: 'Malta' },
        MD: { en: 'Moldova', ro: 'Moldova', alt: ['republic of moldova'] },
        MC: { en: 'Monaco', ro: 'Monaco' },
        ME: { en: 'Montenegro', ro: 'Muntenegru' },
        NL: { en: 'Netherlands', ro: 'Țările de Jos', alt: ['holland'] },
        MK: { en: 'North Macedonia', ro: 'Macedonia de Nord', alt: ['macedonia'] },
        NO: { en: 'Norway', ro: 'Norvegia' },
        PL: { en: 'Poland', ro: 'Polonia' },
        PT: { en: 'Portugal', ro: 'Portugalia' },
        RO: { en: 'Romania', ro: 'România' },
        RU: { en: 'Russia', ro: 'Rusia', alt: ['russian federation'] },
        SM: { en: 'San Marino', ro: 'San Marino' },
        RS: { en: 'Serbia', ro: 'Serbia', alt: ['republic of serbia'] },
        SK: { en: 'Slovakia', ro: 'Slovacia' },
        SI: { en: 'Slovenia', ro: 'Slovenia' },
        ES: { en: 'Spain', ro: 'Spania' },
        SE: { en: 'Sweden', ro: 'Suedia' },
        CH: { en: 'Switzerland', ro: 'Elveția' },
        TR: { en: 'Turkey', ro: 'Turcia', alt: ['turkiye', 'türkiye', 'republic of turkiye'] },
        UA: { en: 'Ukraine', ro: 'Ucraina' },
        GB: { en: 'United Kingdom', ro: 'Regatul Unit', alt: ['uk', 'great britain', 'england', 'scotland', 'wales', 'northern ireland'] },
        VA: { en: 'Vatican City', ro: 'Vatican', alt: ['vatican', 'holy see'] }
    };

    // Rough [lng, lat, zoom] fallback used only when every geometry source
    // failed to load — keeps the picker usable (if geometrically crude)
    // even with zero access to a polygon dataset.
    var APPROX_CENTER = {
        AL: [20.1, 41.2, 7.3], AD: [1.6, 42.55, 9.5], AM: [45.0, 40.3, 7], AT: [14.2, 47.6, 6.6],
        AZ: [47.6, 40.3, 6.6], BY: [27.9, 53.5, 6.2], BE: [4.6, 50.6, 7.4], BA: [17.8, 44.1, 7],
        BG: [25.3, 42.7, 6.8], HR: [16.4, 45.3, 6.8], CY: [33.3, 35.1, 8.1], CZ: [15.4, 49.8, 7],
        DK: [10.0, 56.1, 6.4], EE: [25.6, 58.7, 7], FI: [26.0, 64.5, 4.6], FR: [2.4, 46.6, 5.2],
        GE: [43.5, 42.2, 6.8], DE: [10.3, 51.1, 5.6], GR: [22.9, 39.0, 6], HU: [19.5, 47.2, 6.8],
        IS: [-19.0, 64.9, 5.6], IE: [-8.0, 53.3, 6.2], IT: [12.6, 42.5, 5.3], XK: [20.9, 42.6, 8.2],
        LV: [24.6, 56.9, 6.7], LI: [9.55, 47.17, 10.3], LT: [23.9, 55.2, 6.8], LU: [6.13, 49.8, 9.3],
        MT: [14.4, 35.9, 10], MD: [28.4, 47.4, 7.2], MC: [7.42, 43.73, 12.5], ME: [19.3, 42.7, 8.1],
        NL: [5.3, 52.2, 6.6], MK: [21.7, 41.6, 7.6], NO: [11.0, 64.5, 4.2], PL: [19.1, 52.1, 5.9],
        PT: [-8.2, 39.5, 6], RO: [24.9, 45.9, 6.1], RU: [60.0, 61.5, 2.6], SM: [12.45, 43.94, 11.5],
        RS: [20.9, 44.1, 7], SK: [19.5, 48.7, 7.3], SI: [14.8, 46.1, 7.9], ES: [-3.7, 40.3, 5.2],
        SE: [17.6, 62.5, 4.1], CH: [8.2, 46.8, 7.2], TR: [35.2, 39.0, 5.3], UA: [31.2, 48.4, 5.3],
        GB: [-2.9, 54.2, 5.1], VA: [12.45, 41.9, 13]
    };

    var EUROPE_ISO = {};
    Object.keys(NAMES).forEach(function (iso) { EUROPE_ISO[iso] = true; });

    var NAME_TO_ISO = {};
    Object.keys(NAMES).forEach(function (iso) {
        var entry = NAMES[iso];
        [entry.en, entry.ro].concat(entry.alt || []).forEach(function (n) {
            if (!n) return;
            NAME_TO_ISO[normalizeName(n)] = iso;
        });
    });

    function normalizeName(s) {
        s = String(s || '').toLowerCase().trim();
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
        return s.replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function currentLang() {
        try {
            if (typeof window._currentLang === 'function') return window._currentLang();
        } catch (e) {}
        return (document.documentElement && document.documentElement.lang) || 'en';
    }

    function displayName(iso, datasetName) {
        var ov = NAMES[iso];
        var lang = currentLang();
        if (ov) {
            if (lang === 'ro' && ov.ro) return ov.ro;
            if (ov.en) return ov.en;
        }
        return datasetName || iso;
    }

    /* ── Fetch / script helpers ── */
    function fetchWithTimeout(url, timeoutMs) {
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = controller && timeoutMs ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
        return fetch(url, { signal: controller ? controller.signal : undefined }).then(function (res) {
            if (timer) clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
            return res;
        }, function (err) {
            if (timer) clearTimeout(timer);
            throw err;
        });
    }

    var scriptPromises = {};
    function loadScript(src) {
        if (scriptPromises[src]) return scriptPromises[src];
        scriptPromises[src] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { delete scriptPromises[src]; reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(s);
        });
        return scriptPromises[src];
    }

    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('Image failed: ' + src)); };
            img.src = src;
        });
    }

    /* ── Persistence ── */
    function persistSelection(iso, name, bbox) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ iso: iso, name: name, bbox: bbox, ts: Date.now() }));
        } catch (e) {}
    }
    function readStoredSelection() {
        try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            if (obj && obj.iso && EUROPE_ISO[obj.iso] && Array.isArray(obj.bbox) && obj.bbox.length === 4) return obj;
        } catch (e) {}
        return null;
    }
    function clearStoredSelection() {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }

    /* ── Leaflet handoff (unchanged contract with js/map-app.js) ── */
    function setMapControlsHidden(hidden) {
        CONTROL_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.toggle('auth-hidden', !!hidden);
        });
    }

    function activeMap() { return state.leafletMap || window._dlMap || null; }

    /* Remembers the map's own zoom limits the first time a country is locked,
       so switching country to country never ratchets minZoom upwards. */
    function rememberBaseZoom(map) {
        if (state.baseMinZoom != null || !map) return;
        var opts = map.options || {};
        state.baseMinZoom = (typeof opts.minZoom === 'number') ? opts.minZoom : 2;
        state.baseMaxZoom = (typeof opts.maxZoom === 'number') ? opts.maxZoom : 20;
    }

    // The zoom the country view opens at: the bbox fitted to the viewport,
    // capped so micro-states (Monaco, Vatican…) don't fall into one street.
    function countryFitZoom(map, padded) {
        var fit = FIT_MAX_ZOOM;
        try {
            var z = map.getBoundsZoom(padded, false);
            if (typeof z === 'number' && isFinite(z)) fit = Math.min(FIT_MAX_ZOOM, z);
        } catch (e) { /* keep the cap */ }
        return Math.max(state.baseMinZoom, Math.min(state.baseMaxZoom, fit));
    }

    /* Lock the working map to one country: pan pinned to the (slightly
       padded) country box, zoom floor at the fit zoom. The permanent 3D globe
       base is never replaced here — a selection only moves the camera and
       locks it. */
    function restrictLeafletToCountry(map, bbox) {
        if (!map || !window.L) return;
        try {
            rememberBaseZoom(map);
            var sw = window.L.latLng(bbox[1], bbox[0]);
            var ne = window.L.latLng(bbox[3], bbox[2]);
            var bounds = window.L.latLngBounds(sw, ne);
            var padded = bounds.pad(LOCK_PAD);
            var fitZoom = countryFitZoom(map, padded);
            map.setMaxBounds(null);
            map.options.maxBoundsViscosity = 1;
            map.setMaxBounds(padded);
            map.setMinZoom(Math.max(state.baseMinZoom, fitZoom - LOCK_ZOOM_SLACK));
            if (typeof map.setMaxZoom === 'function') map.setMaxZoom(state.baseMaxZoom);
            map.fitBounds(bounds, { padding: [24, 24], maxZoom: fitZoom, animate: true });
            state.locked = true;
            state.fitZoom = fitZoom;
            // The bounds of the selected country stay visible on the map for
            // the whole locked view (outline once geometry is loaded).
            showCountryBoundsLayer(map, window._detectlabSelectedCountry, bbox);
            if (document.documentElement) document.documentElement.classList.add('country-view-locked');
            fireLockChange(true);
        } catch (e) {
            console.warn('[DetectLab] Globe gate: could not restrict the map to the selected country', e);
        }
    }

    /* Release the lock: free panning and the map's original zoom range.
       Used by the “Exit view” button (js/country-dock.js) and by reset(). */
    function unlockCountryView() {
        var map = activeMap();
        state.locked = false;
        state.fitZoom = null;
        if (document.documentElement) document.documentElement.classList.remove('country-view-locked');
        if (map) {
            try {
                map.setMaxBounds(null);
                if (map.options) map.options.maxBoundsViscosity = 0;
                if (state.baseMinZoom != null && typeof map.setMinZoom === 'function') map.setMinZoom(state.baseMinZoom);
                if (state.baseMaxZoom != null && typeof map.setMaxZoom === 'function') map.setMaxZoom(state.baseMaxZoom);
            } catch (e) {
                console.warn('[DetectLab] Globe gate: could not release the country lock', e);
            }
        }
        // Layer coverage filtering belongs to the locked view — drop it so the
        // whole catalogue is selectable again once the user roams freely.
        if (typeof window.unfilterLayersForCountry === 'function') {
            try { window.unfilterLayersForCountry(); } catch (e) {}
        }
        removeCountryBoundsLayer();
        fireLockChange(false);
    }

    /* ── Selected-country bounds on the working map ────────────────────────
       A selection keeps the country bounds visible on the Leaflet map: the
       country outline when the gate's geometry is loaded, otherwise the
       selection bbox. Drawn non-interactive in its own pane above every data
       pane (LIDAR 610, historical maps ≤ 652), removed when the lock is
       released (“Exit view”, reset) and replaced on every new selection. */
    var BOUNDS_PANE = 'pane_country_bounds';
    var BOUNDS_PANE_Z = 688;   // above the data panes, under tracks (690)/measure (700)

    function ensureBoundsPane(map) {
        try {
            if (!map || typeof map.getPane !== 'function' || typeof map.createPane !== 'function') return null;
            var pane = map.getPane(BOUNDS_PANE);
            if (!pane) {
                pane = map.createPane(BOUNDS_PANE);
                if (pane && pane.style) pane.style.zIndex = BOUNDS_PANE_Z;
            }
            return BOUNDS_PANE;
        } catch (e) { return null; }
    }

    function removeCountryBoundsLayer() {
        var layer = state.boundsLayer;
        state.boundsLayer = null;
        if (!layer) return;
        var map = activeMap();
        if (map && typeof map.removeLayer === 'function') {
            try { map.removeLayer(layer); } catch (e) {}
        }
    }

    function showCountryBoundsLayer(map, iso, bbox) {
        if (!map || !window.L || !Array.isArray(bbox) || bbox.length !== 4) return;
        removeCountryBoundsLayer();
        // Leaflet passes these options straight to every vector it builds
        // (bundled 1.9.4: geometryToLayer forwards the GeoJSON options), so
        // pane/interactive apply to the outline itself.
        var styleOpts = {
            color: '#39ff14',
            weight: 2.5,
            opacity: 0.9,
            fillColor: '#39ff14',
            fillOpacity: 0.05,
            interactive: false,
            bubblingMouseEvents: false
        };
        var paneName = ensureBoundsPane(map);
        if (paneName) styleOpts.pane = paneName;
        var layer = null;
        var entry = (iso && G.byIso) ? G.byIso[iso] : null;
        if (entry && entry.feature && typeof window.L.geoJSON === 'function') {
            try { layer = window.L.geoJSON(entry.feature, styleOpts); } catch (e) { layer = null; }
        }
        if (!layer && typeof window.L.rectangle === 'function') {
            try {
                layer = window.L.rectangle([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], styleOpts);
            } catch (e) { layer = null; }
        }
        if (!layer || typeof map.addLayer !== 'function') return;
        try {
            map.addLayer(layer);
            state.boundsLayer = layer;
        } catch (e) {}
    }

    // Redraw once the atlas (or the 10m shapefile refinement) is ready: a
    // selection restored from localStorage starts with the plain bbox rectangle
    // and upgrades to the real country outline as soon as geometry exists.
    function refreshCountryBoundsLayer() {
        if (!state.locked || !state.boundsLayer) return;
        var map = activeMap();
        if (!map) return;
        showCountryBoundsLayer(map, window._detectlabSelectedCountry, window._detectlabCountryBounds);
    }

    function fireLockChange(locked) {
        var detail = {
            locked: !!locked,
            iso: window._detectlabSelectedCountry || null,
            bbox: window._detectlabCountryBounds || null,
            fitZoom: state.fitZoom
        };
        try {
            document.dispatchEvent(new CustomEvent('detectlab:country-lockchange', { detail: detail }));
        } catch (e) {
            try {
                var evt = document.createEvent('CustomEvent');
                evt.initCustomEvent('detectlab:country-lockchange', true, true, detail);
                document.dispatchEvent(evt);
            } catch (e2) {}
        }
    }

    function callFilterLayersWithRetry(iso, attemptsLeft) {
        if (typeof window.filterLayersForCountry === 'function') {
            try { window.filterLayersForCountry(iso); } catch (e) {}
            return;
        }
        if (attemptsLeft <= 0) return;
        window.setTimeout(function () { callFilterLayersWithRetry(iso, attemptsLeft - 1); }, 60);
    }

    function hasSelection() {
        return !!window._detectlabSelectedCountry;
    }

    function applySelection(iso, name, bbox) {
        window._detectlabSelectedCountry = iso;
        window._detectlabSelectedCountryName = name;
        window._detectlabCountryBounds = bbox;
        window._detectlabCountryLayer = {
            eachLayer: function (cb) {
                if (!window.L) return;
                var sw = window.L.latLng(bbox[1], bbox[0]);
                var ne = window.L.latLng(bbox[3], bbox[2]);
                cb({ feature: { properties: { ISO_A2: iso } }, getBounds: function () { return window.L.latLngBounds(sw, ne); } });
            }
        };
        var leafletMap = activeMap();
        if (leafletMap) restrictLeafletToCountry(leafletMap, bbox);
        document.documentElement.classList.add('country-selected');
        if (document.body) document.body.classList.add('country-selected');
        callFilterLayersWithRetry(iso, 40);
        setMapControlsHidden(false);
        var detail = { iso: iso, name: name, bbox: bbox };
        try {
            document.dispatchEvent(new CustomEvent('detectlab:country-selected', { detail: detail }));
        } catch (e) {
            var evt = document.createEvent('CustomEvent');
            evt.initCustomEvent('detectlab:country-selected', true, true, detail);
            document.dispatchEvent(evt);
        }
    }

    /* ══════════════════════════════════════════════════════════
       Canvas globe engine
       (adapted from the reference orthographic-canvas implementation:
       per-pixel texture sampling + hillshade for the base layer, d3
       geoPath vector overlays for countries, geometric picking)
       ══════════════════════════════════════════════════════════ */
    var G = {
        W: 800, H: 600,
        rot: [-15, -50],            // centred on Europe
        k: 1.55,                     // zoom factor
        eu: [],                      // [{iso, name, feature, lat, lng, size, bounds, bboxEU, fromShp}]
        byIso: {},
        hovered: null,
        selected: null,              // entry highlighted during the fly-to animation
        world: null,                 // world-atlas features (all countries)
        mesh: null,                  // world border mesh (faint)
        land: null,                  // merged land (texture-less fallback fill)
        tex: null, texName: 'none',
        shade: null,
        layer: null, baseKey: '', baseStep: 0, off: null,
        proj: null,
        canvas: null, ctx: null,
        spinEnabled: true,
        userInteracting: false,
        flying: false,
        mk: function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
        key: function () { return [this.rot[0].toFixed(3), this.rot[1].toFixed(3), this.k.toFixed(3), this.W, this.H, this.texName].join('|'); }
    };

    function polysOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
    function centroidOf(p) { return window.d3.geoCentroid({ type: 'Polygon', coordinates: p }); }
    // Loose window used to pick candidate shapes out of the raw shapefile.
    function looseEu(p) { var c = centroidOf(p), lo = c[0], la = c[1]; return lo > -32 && lo < 190 && la > 34 && la < 82; }
    // Display window: continental Europe (+ Caucasus/Turkey); Russia keeps all
    // of its polygons so the globe never shows a truncated coastline.
    function keepFor(iso, p) {
        if (iso === 'RU') return true;
        var c = centroidOf(p), lo = c[0], la = c[1];
        return lo > -32 && lo < 62 && la > 33 && la < 82;
    }
    // Hand-off window: what the Leaflet map gets locked to. European Russia
    // only — the app's layer catalogue is European.
    function inHandoffWindow(p) {
        var c = centroidOf(p), lo = c[0], la = c[1];
        return lo > -32 && lo < 62 && la > 33 && la < 82;
    }
    function bboxArea(poly) {
        var a = 1e9, b = -1e9, c = 1e9, e = -1e9;
        for (var i = 0; i < poly[0].length; i++) {
            var x = poly[0][i][0], y = poly[0][i][1];
            if (x < a) a = x; if (x > b) b = x;
            if (y < c) c = y; if (y > e) e = y;
        }
        return (b - a) * (e - c);
    }
    function lngLatBbox(polys) {
        var w = 1e9, s = 1e9, e = -1e9, n = -1e9;
        polys.forEach(function (poly) {
            poly.forEach(function (ring) {
                for (var i = 0; i < ring.length; i++) {
                    var x = ring[i][0], y = ring[i][1];
                    if (x < w) w = x; if (x > e) e = x;
                    if (y < s) s = y; if (y > n) n = y;
                }
            });
        });
        return (w <= e && s <= n) ? [w, s, e, n] : null;
    }
    function simp(ring) {
        if (ring.length < 40) return ring;
        var out = [ring[0]], l = ring[0];
        for (var i = 1; i < ring.length - 1; i++) {
            var p = ring[i];
            if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.03) { out.push(p); l = p; }
        }
        out.push(ring[ring.length - 1]);
        return out.length >= 4 ? out : ring;
    }
    function simpPoly(p) { // keep the original if simplification breaks the polygon
        var d3g = window.d3;
        var q = p.map(simp);
        var same = true;
        for (var i = 0; i < q.length; i++) if (q[i] !== p[i]) { same = false; break; }
        if (same) return p;
        var a0 = d3g.geoArea({ type: 'Polygon', coordinates: p });
        var a1 = d3g.geoArea({ type: 'Polygon', coordinates: q });
        return Math.abs(a1 - a0) <= 0.0005 + 0.05 * a0 ? q : p;
    }

    function isoOfWorldFeature(f) {
        var name = f && f.properties && f.properties.name;
        return NAME_TO_ISO[normalizeName(name)] || null;
    }

    // shpFeatures may be null → the public world-atlas geometry is used.
    // When the 10m shapefile is available its (much more detailed) shapes are
    // matched to the atlas countries by point-in-polygon on their centroids.
    function buildEurope(shpFeatures) {
        var d3g = window.d3;
        var euWorld = [];
        var seen = {};
        (G.world || []).forEach(function (f) {
            var iso = isoOfWorldFeature(f);
            if (iso && EUROPE_ISO[iso] && !seen[iso] && f.geometry &&
                (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
                seen[iso] = true;
                euWorld.push({ iso: iso, feature: f });
            }
        });

        var found = {};
        (shpFeatures || []).forEach(function (f) {
            if (!f || !f.geometry) return;
            if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') return;
            var kept = polysOf(f.geometry).filter(looseEu);
            if (!kept.length) return;
            var big = kept.reduce(function (a, b) { return bboxArea(a) > bboxArea(b) ? a : b; });
            var pt = centroidOf(big);
            for (var i = 0; i < euWorld.length; i++) {
                if (d3g.geoContains(euWorld[i].feature, pt)) {
                    var iso = euWorld[i].iso;
                    found[iso] = (found[iso] || []).concat(polysOf(f.geometry));
                    break;
                }
            }
        });

        var eu = [];
        euWorld.forEach(function (w) {
            var iso = w.iso;
            var src = found[iso] || polysOf(w.feature.geometry);
            var coords = src.filter(function (p) { return keepFor(iso, p); }).map(simpPoly);
            if (!coords.length) return;
            var big = coords.reduce(function (a, b) { return bboxArea(a) > bboxArea(b) ? a : b; });
            var c = centroidOf(big), lng = c[0], lat = c[1];
            var feature = { type: 'Feature', properties: { iso: iso }, geometry: { type: 'MultiPolygon', coordinates: coords } };
            var euPolys = coords.filter(inHandoffWindow);
            var bboxEU = lngLatBbox(euPolys.length ? euPolys : coords);
            eu.push({
                iso: iso,
                name: (w.feature.properties && w.feature.properties.name) || NAMES[iso].en,
                feature: feature,
                lat: lat, lng: lng,
                size: Math.sqrt(bboxArea(big)),
                bounds: d3g.geoBounds(feature),
                bboxEU: bboxEU,
                fromShp: !!found[iso]
            });
        });
        G.eu = eu;
        G.byIso = {};
        eu.forEach(function (d) { G.byIso[d.iso] = d; });
        return eu;
    }

    function makeTexture(img) {
        var w = 2048, h = 1024, c = G.mk(w, h), x = c.getContext('2d');
        x.drawImage(img, 0, 0, w, h);
        return { w: w, h: h, data: x.getImageData(0, 0, w, h).data };
    }
    function makeShade(topo) { // hillshade derived from the elevation map
        var w = 2048, h = 1024, c = G.mk(w, h), x = c.getContext('2d');
        x.drawImage(topo, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h).data, sh = new Float32Array(w * h);
        for (var y = 1; y < h - 1; y++) {
            for (var i = 1; i < w - 1; i++) {
                var dh = d[((y + 1) * w + i + 1) * 4] - d[((y - 1) * w + i - 1) * 4];
                sh[y * w + i] = Math.max(0.65, Math.min(1.35, 1 + dh * 0.012));
            }
        }
        sh.fill(1, 0, w); sh.fill(1, (h - 1) * w);
        return sh;
    }

    function getProj() {
        var R = Math.min(G.W, G.H) / 2 * 0.88 * G.k;
        return window.d3.geoOrthographic().rotate(G.rot).translate([G.W / 2, G.H / 2]).scale(R).clipAngle(90).precision(0.5);
    }

    // Background + texture + world borders. Rebuilt only when rotation/zoom/
    // size/texture change (G.key()); vector overlays are drawn on top each
    // frame in draw().
    function drawBase(step) {
        var d3g = window.d3;
        var ctx = G.layer.getContext('2d'), W = G.W, H = G.H;
        var proj = getProj(), R = proj.scale(), cx = W / 2, cy = H / 2;
        var path = d3g.geoPath(proj, ctx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#060814'; ctx.fillRect(0, 0, W, H);
        // atmosphere halo
        var g = ctx.createRadialGradient(cx, cy, R * 0.99, cx, cy, R * 1.1);
        g.addColorStop(0, 'rgba(90,170,255,.5)'); g.addColorStop(1, 'rgba(90,170,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.1, 0, 7); ctx.fill();
        ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = '#0e2a47'; ctx.fill();

        if (G.tex) {
            var s = step;
            var x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
            var x1 = Math.min(W, Math.ceil(cx + R)), y1 = Math.min(H, Math.ceil(cy + R));
            var w = Math.max(1, Math.ceil((x1 - x0) / s)), h = Math.max(1, Math.ceil((y1 - y0) / s));
            if (!G.off || G.off.width !== w || G.off.height !== h) G.off = G.mk(w, h);
            var octx = G.off.getContext('2d'), img = octx.createImageData(w, h), id = img.data;
            var lam0 = -G.rot[0] * Math.PI / 180, phi0 = -G.rot[1] * Math.PI / 180;
            var sinp = Math.sin(phi0), cosp = Math.cos(phi0);
            var T = G.tex, tw = T.w, th = T.h, sh = G.shade;
            for (var j = 0; j < h; j++) {
                var py = (cy - (y0 + j * s + s / 2)) / R;
                for (var i = 0; i < w; i++) {
                    var px = ((x0 + i * s + s / 2) - cx) / R, r2 = px * px + py * py, o = (j * w + i) * 4;
                    if (r2 >= 1) continue;
                    var z = Math.sqrt(1 - r2);
                    var lat = Math.asin(z * sinp + py * cosp), lon = lam0 + Math.atan2(px, z * cosp - py * sinp);
                    var ld = lon * 57.29578; ld = ((ld + 180) % 360 + 360) % 360;
                    var u = Math.min(tw - 1, (ld / 360 * tw) | 0);
                    var v = Math.max(0, Math.min(th - 1, ((90 - lat * 57.29578) / 180 * th) | 0));
                    var ti = v * tw + u, f = (sh ? sh[ti] : 1) * (0.62 + 0.38 * Math.sqrt(z));
                    id[o] = Math.min(255, T.data[ti * 4] * f);
                    id[o + 1] = Math.min(255, T.data[ti * 4 + 1] * f);
                    id[o + 2] = Math.min(255, T.data[ti * 4 + 2] * f);
                    id[o + 3] = 255;
                }
            }
            octx.putImageData(img, 0, 0);
            ctx.save(); ctx.beginPath(); path({ type: 'Sphere' }); ctx.clip();
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(G.off, 0, 0, w, h, x0, y0, w * s, h * s);
            ctx.restore();
        } else if (G.land) { // texture-less fallback: flat land fill
            ctx.beginPath(); path(G.land); ctx.fillStyle = '#2d4a3e'; ctx.fill();
        }
        if (G.mesh) { ctx.beginPath(); path(G.mesh); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 0.6; ctx.stroke(); }
        G.baseKey = G.key();
    }

    function draw(step) {
        var d3g = window.d3;
        var ctx = G.ctx;
        if (!ctx) return;
        if (!G.layer || G.layer.width !== G.W || G.layer.height !== G.H) {
            G.layer = G.mk(G.W, G.H);
            G.baseKey = '';
        }
        if (G.baseKey !== G.key() || G.baseStep !== step) { drawBase(step); G.baseStep = step; }
        ctx.drawImage(G.layer, 0, 0, G.W, G.H);
        var proj = getProj(); G.proj = proj;
        var path = d3g.geoPath(proj, ctx);
        var d, q, i;

        // all European countries: translucent grey-violet fill, black border
        // over a pale casing (legible on sea, land and ice alike)
        for (i = 0; i < G.eu.length; i++) {
            d = G.eu[i];
            ctx.beginPath(); path(d.feature);
            ctx.fillStyle = 'rgba(107,95,130,.34)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 1.8; ctx.stroke();
            ctx.strokeStyle = 'rgba(0,0,0,.95)'; ctx.lineWidth = 0.9; ctx.stroke();
        }
        ctx.lineJoin = 'round';
        if (G.selected) { // fly-to highlight
            ctx.beginPath(); path(G.selected.feature);
            ctx.fillStyle = 'rgba(57,255,20,.5)'; ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 5; ctx.stroke();
            ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2.4; ctx.stroke();
        }
        if (G.hovered && G.hovered !== G.selected) { // neon-green hover
            ctx.beginPath(); path(G.hovered.feature);
            ctx.fillStyle = 'rgba(57,255,20,.42)'; ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4.5; ctx.stroke();
            ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2; ctx.stroke();
        }
        // micro-states: ring marker when they'd be invisible at this zoom
        for (i = 0; i < G.eu.length; i++) {
            d = G.eu[i];
            var hv = d === G.hovered || d === G.selected;
            if (!hv || d.size * G.k > 1.5) continue;
            q = proj([d.lng, d.lat]);
            if (!q || d3g.geoDistance([d.lng, d.lat], [-G.rot[0], -G.rot[1]]) > 1.5) continue;
            ctx.beginPath(); ctx.arc(q[0], q[1], 9, 0, 7);
            ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 5; ctx.stroke();
            ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2.5; ctx.stroke();
        }
        // label for the hovered / selected country
        var labelled = [];
        if (G.selected) labelled.push(G.selected);
        if (G.hovered && G.hovered !== G.selected) labelled.push(G.hovered);
        var center = [-G.rot[0], -G.rot[1]];
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (i = 0; i < labelled.length; i++) {
            d = labelled[i];
            if (d3g.geoDistance([d.lng, d.lat], center) > 1.45) continue;
            q = proj([d.lng, d.lat]);
            if (!q) continue;
            ctx.font = '600 ' + Math.round(12 + Math.min(6, d.size * G.k * 0.5)) + 'px system-ui, sans-serif';
            ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)';
            var label = displayName(d.iso, d.name);
            ctx.strokeText(label, q[0], q[1]);
            ctx.fillStyle = '#eaffdd';
            ctx.fillText(label, q[0], q[1]);
        }
    }

    // Geometric picking: exact point-in-polygon first, then a 12-px screen
    // tolerance so micro-states (Malta, Monaco, Vatican…) stay clickable.
    function pick(x, y) {
        var d3g = window.d3;
        var proj = G.proj || getProj();
        var pt = proj.invert([x, y]);
        if (!pt || isNaN(pt[0]) || isNaN(pt[1])) return null;
        // reject the far side of the globe
        if (d3g.geoDistance(pt, [-G.rot[0], -G.rot[1]]) > Math.PI / 2) return null;
        var lo = pt[0], la = pt[1], i, d;
        for (i = 0; i < G.eu.length; i++) {
            d = G.eu[i];
            var b = d.bounds, w = b[0][0], s = b[0][1], e = b[1][0], n = b[1][1];
            if (la < s || la > n) continue;
            if (!(w <= e ? (lo >= w && lo <= e) : (lo >= w || lo <= e))) continue;
            if (d3g.geoContains(d.feature, pt)) return d;
        }
        var best = null, bd = 12;
        for (i = 0; i < G.eu.length; i++) {
            d = G.eu[i];
            if (d.size > 2.5) continue;
            var q = proj([d.lng, d.lat]);
            if (!q) continue;
            var dist = Math.hypot(q[0] - x, q[1] - y);
            if (dist < bd) { bd = dist; best = d; }
        }
        return best;
    }

    /* ── Render scheduling (coarse while interacting, refine when idle) ── */
    var drawing = false, idleTimer = 0, nextStep = 1;
    function render(step) {
        step = step || 1;
        nextStep = Math.max(nextStep, step);
        if (drawing) return;
        drawing = true;
        window.requestAnimationFrame(function () {
            drawing = false;
            if (!G.ctx || !gateVisible()) { nextStep = 1; return; }
            var st = nextStep; nextStep = 1;
            var dpr = Math.min(2, window.devicePixelRatio || 1);
            G.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            try { draw(st); } catch (e) { console.warn('[DetectLab] Globe gate render error', e); }
            if (st > 1) {
                window.clearTimeout(idleTimer);
                idleTimer = window.setTimeout(function () { render(1); }, 140);
            }
        });
    }

    function gateVisible() {
        return !!(els.root && !els.root.classList.contains('hidden'));
    }

    function resizeNow() {
        if (!G.canvas || !els.canvas) return;
        var r = els.canvas.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        G.W = Math.max(200, Math.round(r.width));
        G.H = Math.max(200, Math.round(r.height));
        G.canvas.width = Math.round(G.W * dpr);
        G.canvas.height = Math.round(G.H * dpr);
        G.layer = null;
        render(1);
    }

    /* ── Interaction: drag-rotate, hover, click, wheel + pinch zoom ── */
    function canvasXY(e) {
        var r = G.canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }
    function setZoom(k) {
        G.k = Math.max(0.8, Math.min(16, k));
        render(2);
    }
    function wireCanvasEvents() {
        var cv = G.canvas;
        var down = null;
        var pointers = {};
        var pinchDist = 0;

        cv.addEventListener('pointerdown', function (e) {
            try { cv.setPointerCapture(e.pointerId); } catch (err) {}
            pointers[e.pointerId] = canvasXY(e);
            var ids = Object.keys(pointers);
            G.userInteracting = true;
            G.spinEnabled = false; // first touch stops the idle auto-spin for good
            if (ids.length === 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
                down = null;
            } else {
                down = { p: canvasXY(e), moved: 0, rot: G.rot.slice() };
            }
        });
        cv.addEventListener('pointermove', function (e) {
            var p = canvasXY(e);
            if (pointers[e.pointerId]) pointers[e.pointerId] = p;
            var ids = Object.keys(pointers);
            if (ids.length === 2) { // pinch zoom
                var a = pointers[ids[0]], b = pointers[ids[1]];
                var dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
                if (pinchDist > 0 && dist > 0) setZoom(G.k * dist / pinchDist);
                pinchDist = dist;
                return;
            }
            if (down && !G.flying) {
                var dx = p[0] - down.p[0], dy = p[1] - down.p[1];
                down.moved = Math.max(down.moved, Math.hypot(dx, dy));
                if (down.moved > 4) {
                    var f = 0.3 / G.k;
                    G.rot = [down.rot[0] + dx * f, Math.max(-90, Math.min(90, down.rot[1] - dy * f))];
                    if (G.hovered) { G.hovered = null; hideHint(); }
                    render(3);
                    return;
                }
            }
            if (G.flying) return;
            var h = pick(p[0], p[1]);
            if (h !== G.hovered) {
                G.hovered = h;
                cv.style.cursor = h ? 'pointer' : 'grab';
                if (h) showHint(displayName(h.iso, h.name)); else hideHint();
                render(1);
            }
        });
        function release(e) {
            delete pointers[e.pointerId];
            if (!Object.keys(pointers).length) { G.userInteracting = false; pinchDist = 0; }
        }
        cv.addEventListener('pointerup', function (e) {
            if (down && down.moved <= 4 && !G.flying) {
                var h = pick.apply(null, canvasXY(e));
                if (h) selectCountry(h.iso);
            }
            down = null;
            release(e);
        });
        cv.addEventListener('pointercancel', function (e) { down = null; release(e); });
        cv.addEventListener('pointerleave', function () {
            if (G.hovered) { G.hovered = null; hideHint(); render(1); }
        });
        cv.addEventListener('wheel', function (e) {
            e.preventDefault();
            G.spinEnabled = false;
            setZoom(G.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        }, { passive: false });
    }

    /* ── Idle auto-spin (until the first interaction) ── */
    var spinRaf = 0;
    function spinLoop() {
        spinRaf = 0;
        if (!gateVisible()) return;
        if (G.spinEnabled && !G.userInteracting && !G.flying && !document.hidden) {
            G.rot[0] += 0.045;
            render(2);
        }
        spinRaf = window.requestAnimationFrame(spinLoop);
    }
    function startSpinLoop() {
        if (!spinRaf) spinRaf = window.requestAnimationFrame(spinLoop);
    }
    function stopSpinLoop() {
        if (spinRaf) { window.cancelAnimationFrame(spinRaf); spinRaf = 0; }
    }

    /* ── Fly-to animation, then hand off to Leaflet ── */
    function flyTo(entry, done) {
        var d3g = window.d3;
        G.flying = true;
        G.selected = entry;
        G.hovered = null;
        var rot0 = G.rot.slice(), k0 = G.k;
        var lon1 = -entry.lng, lat1 = -entry.lat;
        lon1 = rot0[0] + (((lon1 - rot0[0] + 540) % 360) - 180); // shortest way round
        var b = entry.bounds;
        var spanLon = b[1][0] >= b[0][0] ? b[1][0] - b[0][0] : 360 - b[0][0] + b[1][0];
        var span = Math.max(spanLon, b[1][1] - b[0][1], 0.5);
        var k1 = Math.max(2, Math.min(9, 60 / span));
        if (entry.iso === 'RU') k1 = 1.8;
        var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
        var dur = 950;
        function stepFrame() {
            var now = (window.performance && performance.now) ? performance.now() : Date.now();
            var t = Math.min(1, (now - t0) / dur);
            var e = t * t * (3 - 2 * t); // smoothstep
            G.rot = [rot0[0] + (lon1 - rot0[0]) * e, rot0[1] + (lat1 - rot0[1]) * e];
            G.k = k0 + (k1 - k0) * e;
            render(2);
            if (t < 1 && gateVisible()) {
                window.requestAnimationFrame(stepFrame);
            } else {
                render(1);
                window.setTimeout(function () {
                    G.flying = false;
                    done();
                }, 180);
            }
        }
        window.requestAnimationFrame(stepFrame);
    }

    function selectCountry(iso) {
        var entry = G.byIso[iso];
        if (!entry || !entry.bboxEU) return;
        var name = displayName(iso, entry.name);
        showHint(name, true);
        flyTo(entry, function () {
            finishSelection(iso, name, entry.bboxEU);
            G.selected = null;
        });
    }

    function finishSelection(iso, name, bbox) {
        persistSelection(iso, name, bbox);
        applySelection(iso, name, bbox);
        closeGate(true);
    }

    /* ══════════════════════════════════════════════════════════
       Switching country without the globe — the API behind
       js/country-dock.js (the slide-down list glued to the search bar).
       ══════════════════════════════════════════════════════════ */

    // Last-resort bbox for a country whose geometry never loaded: the rough
    // [lng, lat, zoom] table above still yields a sane locked view.
    function approxBbox(iso) {
        var c = APPROX_CENTER[iso] || [15, 48, 5];
        var lonSpan = 360 / Math.pow(2, c[2]);   // ≈ the width the old picker zoomed to
        var latSpan = lonSpan * 0.6;
        return [c[0] - lonSpan / 2, c[1] - latSpan / 2, c[0] + lonSpan / 2, c[1] + latSpan / 2];
    }

    // What the dock renders: every selectable country with its 2-letter code,
    // both names and the bbox it locks the map to (real geometry when it is
    // loaded, the static approximation otherwise). Sorted for the current
    // language, so the grid order follows the UI language like the rest of
    // the site.
    function listCountries() {
        var lang = currentLang();
        return Object.keys(NAMES).map(function (iso) {
            var entry = G.byIso[iso];
            return {
                iso: iso,
                code: iso,
                name: displayName(iso, (entry && entry.name) || NAMES[iso].en),
                en: NAMES[iso].en,
                ro: NAMES[iso].ro,
                bbox: (entry && entry.bboxEU) || approxBbox(iso),
                fromGeometry: !!(entry && entry.bboxEU)
            };
        }).sort(function (a, b) {
            return a.name.localeCompare(b.name, lang === 'ro' ? 'ro' : 'en');
        });
    }

    function nameOf(iso) {
        iso = String(iso || '').toUpperCase();
        if (!NAMES[iso]) return null;
        var entry = G.byIso[iso];
        return displayName(iso, (entry && entry.name) || NAMES[iso].en);
    }

    /* Pick a country straight from the search-bar dock: the geometry is
       loaded in the background (local atlas, one small fetch), then the map
       is moved to the country and locked to it exactly like a globe pick —
       same localStorage record and the same `detectlab:country-selected`
       event, so search sources and layer filtering follow along unchanged. */
    function selectCountryByIso(iso) {
        iso = String(iso || '').toUpperCase();
        if (!NAMES[iso]) return Promise.reject(new Error('Unknown country code: ' + iso));
        return ensureReady().then(function () {
            var entry = G.byIso[iso];
            var bbox = (entry && entry.bboxEU) || approxBbox(iso);
            var name = displayName(iso, (entry && entry.name) || NAMES[iso].en);
            finishSelection(iso, name, bbox);
            return { iso: iso, name: name, bbox: bbox };
        });
    }

    // Warm d3/topojson/atlas in the background so the first dock click is
    // instant (the globe gate itself only loads them when it opens).
    function prefetch() {
        return ensureReady().then(function () { return true; }, function () { return false; });
    }

    /* “Exit view” — the button js/country-dock.js shows in the middle of the
       bottom edge once the locked country view is zoomed all the way out.
       It releases the lock, pulls back to the European overview and reopens
       the globe, so leaving a country always means choosing another one. */
    function exitView() {
        var map = activeMap();
        unlockCountryView();
        if (map && typeof map.setView === 'function') {
            try {
                map.setView([48.5, 14], Math.max(state.baseMinZoom || 2, 4), { animate: true });
            } catch (e) {}
        }
        openGate();
    }

    /* ── Data loading ── */
    function loadLibraries() {
        var need = [];
        if (!(window.d3 && window.d3.geoOrthographic && window.d3.geoContains)) need.push(loadScript(D3_JS));
        if (!(window.topojson && window.topojson.feature)) need.push(loadScript(TOPOJSON_JS));
        return Promise.all(need);
    }

    function loadAtlas() {
        function parse(json) {
            var tj = window.topojson;
            var feats = tj.feature(json, json.objects.countries).features;
            G.world = feats;
            G.mesh = tj.mesh(json, json.objects.countries, function (a, b) { return a !== b; });
            try { G.land = tj.merge(json, json.objects.countries.geometries); } catch (e) { G.land = null; }
            return feats;
        }
        return fetchWithTimeout(ATLAS_LOCAL, FETCH_TIMEOUT_MS)
            .then(function (res) { return res.json(); })
            .then(parse)
            .catch(function (err) {
                console.warn('[DetectLab] Globe gate: local atlas unavailable, trying the public mirror.', err && err.message);
                return fetchWithTimeout(ATLAS_REMOTE, FETCH_TIMEOUT_MS)
                    .then(function (res) { return res.json(); })
                    .then(parse);
            });
    }

    // The Blue Marble texture is decoration: the globe (flat land fill) works
    // without it, so this never blocks the gate.
    var texturesStarted = false;
    function loadTextures() {
        if (texturesStarted) return;
        texturesStarted = true;
        var shadePromise = loadImage(TOPOLOGY_LOCAL)
            .catch(function () { return loadImage(TOPOLOGY_REMOTE); })
            .then(function (img) { return makeShade(img); })
            .catch(function () { return null; });
        loadImage(TEXTURE_LOCAL)
            .catch(function () { return loadImage(TEXTURE_REMOTE); })
            .then(function (img) { return makeTexture(img); })
            .then(function (tex) {
                return shadePromise.then(function (shade) {
                    G.tex = tex;
                    G.shade = shade;
                    G.texName = 'blue-marble';
                    render(1);
                });
            })
            .catch(function (err) {
                console.warn('[DetectLab] Globe gate: Earth texture unavailable, using the flat land fill.', err && err.message);
            });
    }

    // Optional refinement: trade the 50m atlas coastlines for the Natural
    // Earth 10m shapefile when it can be streamed. Never blocks, never fails
    // the gate.
    var shpStarted = false;
    function refineFromShapefile() {
        if (shpStarted) return;
        shpStarted = true;
        loadScript(SHAPEFILE_JS)
            .then(function () {
                if (!window.shapefile || typeof window.shapefile.read !== 'function') {
                    throw new Error('shapefile reader unavailable');
                }
                return window.shapefile.read(SHP_URL);
            })
            .then(function (collection) {
                var feats = collection && collection.features;
                if (!feats || !feats.length) throw new Error('empty shapefile');
                var selIso = G.selected && G.selected.iso;
                var hovIso = G.hovered && G.hovered.iso;
                buildEurope(feats);
                G.selected = selIso ? G.byIso[selIso] || null : null;
                G.hovered = hovIso ? G.byIso[hovIso] || null : null;
                var n = G.eu.filter(function (d) { return d.fromShp; }).length;
                console.info('[DetectLab] Globe gate: refined ' + n + '/' + G.eu.length + ' countries from the 10m shapefile.');
                render(1);
                refreshCountryBoundsLayer();   // redraw the outline with the finer shape
            })
            .catch(function (err) {
                console.info('[DetectLab] Globe gate: 10m shapefile not available (' + (err && err.message) + '); keeping the 50m outlines.');
            });
    }

    /* ── Module state & DOM refs ── */
    var state = {
        leafletMap: null,
        readyPromise: null,
        globeFailed: false,
        locked: false,          // is the working map pinned to a country right now?
        fitZoom: null,          // the zoom the current country view opens at
        baseMinZoom: null,      // the map's own zoom range, remembered once
        baseMaxZoom: null,
        boundsLayer: null       // the country outline/bbox drawn on the Leaflet map
    };

    var els = {};
    function cacheEls() {
        els.root = document.getElementById('globeGate');
        els.canvas = document.getElementById('globeGateCanvas');
        els.loading = document.getElementById('globeGateLoading');
        els.error = document.getElementById('globeGateError');
        els.errorText = document.getElementById('globeGateErrorText');
        els.retryBtn = document.getElementById('globeGateRetryBtn');
        els.hint = document.getElementById('globeGateHint');
        els.closeBtn = document.getElementById('globeGateCloseBtn');
        els.reopenBtn = document.getElementById('globeGateReopenBtn');
        els.fallbackWrap = document.getElementById('globeGateFallback');
        els.fallbackSelect = document.getElementById('globeGateFallbackSelect');
        els.fallbackBtn = document.getElementById('globeGateFallbackBtn');
        els.zoomIn = document.getElementById('globeGateZoomIn');
        els.zoomOut = document.getElementById('globeGateZoomOut');
    }

    function showLoading(show) { if (els.loading) els.loading.classList.toggle('hidden', !show); }
    function showError(show, msg) {
        if (els.error) els.error.classList.toggle('hidden', !show);
        if (show && els.errorText && msg) els.errorText.textContent = msg;
    }
    function showHint(text, strong) {
        if (!els.hint) return;
        els.hint.textContent = text || '';
        els.hint.classList.toggle('show', !!text);
        els.hint.style.borderColor = strong ? '#39ff14' : '';
    }
    function hideHint() { if (els.hint) els.hint.classList.remove('show'); }

    function populateFallbackSelect() {
        if (!els.fallbackSelect || els.fallbackSelect.options.length) return;
        var codes = Object.keys(NAMES).sort(function (a, b) {
            return displayName(a, NAMES[a].en).localeCompare(displayName(b, NAMES[b].en));
        });
        codes.forEach(function (iso) {
            var opt = document.createElement('option');
            opt.value = iso;
            opt.textContent = displayName(iso, NAMES[iso].en);
            els.fallbackSelect.appendChild(opt);
        });
    }

    /* ── Gate open/close orchestration ── */
    function buildCanvas() {
        if (G.canvas || !els.canvas) return;
        var cv = document.createElement('canvas');
        cv.className = 'globe-gate-cv';
        cv.setAttribute('aria-label', 'Interactive globe');
        els.canvas.appendChild(cv);
        G.canvas = cv;
        G.ctx = cv.getContext('2d');
        wireCanvasEvents();
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(function () { resizeNow(); }).observe(els.canvas);
        } else {
            window.addEventListener('resize', resizeNow);
        }
    }

    function ensureReady() {
        if (state.readyPromise) return state.readyPromise;
        showError(false);
        if (els.fallbackWrap) els.fallbackWrap.classList.add('hidden');
        showLoading(true);

        state.readyPromise = loadLibraries()
            .then(loadAtlas)
            .then(function () {
                buildEurope(null);
                if (!G.eu.length) throw new Error('no European countries in the dataset');
                buildCanvas();
                if (!G.ctx) throw new Error('canvas 2d context unavailable');
                state.globeFailed = false;
                showLoading(false);
                resizeNow();
                render(1);
                loadTextures();
                refineFromShapefile();
                // A selection restored from storage drew the bbox rectangle —
                // now that geometry exists, upgrade it to the country outline.
                refreshCountryBoundsLayer();
            })
            .catch(function (err) {
                // The gate must never hard-lock the app: fall back to a plain
                // country <select> built from the static name table.
                console.warn('[DetectLab] Globe gate: canvas globe unavailable, using the list fallback.', err && err.message);
                state.globeFailed = true;
                showLoading(false);
                populateFallbackSelect();
                if (els.fallbackWrap) els.fallbackWrap.classList.remove('hidden');
            });
        return state.readyPromise;
    }

    function openGate() {
        if (!els.root) return;
        els.root.classList.remove('hidden', 'is-leaving');
        els.root.setAttribute('aria-hidden', 'false');
        if (document.documentElement) document.documentElement.classList.add('globe-gate-open');
        if (els.closeBtn) els.closeBtn.style.display = hasSelection() ? '' : 'none';
        setMapControlsHidden(true);
        G.selected = null;
        G.flying = false;
        ensureReady().then(function () {
            if (!state.globeFailed) {
                window.requestAnimationFrame(function () {
                    resizeNow();
                    G.spinEnabled = true;
                    startSpinLoop();
                });
            }
        });
    }

    function closeGate(revealControls) {
        if (!els.root) return;
        els.root.classList.add('is-leaving');
        stopSpinLoop();
        G.spinEnabled = false;
        hideHint();
        window.setTimeout(function () {
            els.root.classList.add('hidden');
            els.root.classList.remove('is-leaving');
            els.root.setAttribute('aria-hidden', 'true');
            if (document.documentElement) document.documentElement.classList.remove('globe-gate-open');
        }, 420);
        if (revealControls && hasSelection()) setMapControlsHidden(false);
    }

    function wireChrome() {
        if (els.closeBtn) {
            els.closeBtn.addEventListener('click', function () { closeGate(true); });
        }
        if (els.reopenBtn) {
            els.reopenBtn.addEventListener('click', function () { openGate(); });
        }
        if (els.retryBtn) {
            els.retryBtn.addEventListener('click', function () {
                state.readyPromise = null;
                openGate();
            });
        }
        if (els.zoomIn) els.zoomIn.addEventListener('click', function () { G.spinEnabled = false; setZoom(G.k * 1.3); });
        if (els.zoomOut) els.zoomOut.addEventListener('click', function () { G.spinEnabled = false; setZoom(G.k / 1.3); });
        if (els.fallbackBtn) {
            els.fallbackBtn.addEventListener('click', function () {
                var iso = els.fallbackSelect && els.fallbackSelect.value;
                if (!iso) return;
                var entry = G.byIso[iso];
                var bbox = (entry && entry.bboxEU) || null;
                var name = displayName(iso, (entry && entry.name) || NAMES[iso].en);
                if (!bbox) {
                    var c = APPROX_CENTER[iso] || [15, 48, 6];
                    var pad = 0.6;
                    bbox = [c[0] - pad, c[1] - pad, c[0] + pad, c[1] + pad];
                }
                finishSelection(iso, name, bbox);
            });
        }
        document.addEventListener('detectlab:langchange', function () {
            if (els.fallbackSelect) {
                els.fallbackSelect.innerHTML = '';
                populateFallbackSelect();
            }
            if (gateVisible()) render(1);
        });
    }

    function evaluateAuthState(user) {
        if (!user) { closeGate(false); return; }
        if (!hasSelection()) openGate();
    }

    var attached = false;
    function attach(leafletMap) {
        cacheEls();
        if (!els.root) return;
        state.leafletMap = leafletMap || state.leafletMap;
        if (!attached) {
            attached = true;
            wireChrome();

            var stored = readStoredSelection();
            if (stored) {
                applySelection(stored.iso, stored.name, stored.bbox);
            } else {
                setMapControlsHidden(true);
            }

            window.addEventListener('detectlab:authchange', function (e) {
                var user = (e.detail && e.detail.user) || (typeof window._authUser === 'function' ? window._authUser() : null);
                evaluateAuthState(user);
            });

            // Covers the (rare) case where auth state was already resolved
            // before this script ran — e.g. a fast cached session.
            if (typeof window._authUser === 'function') {
                var immediateUser = window._authUser();
                if (immediateUser) evaluateAuthState(immediateUser);
            }
        } else if (leafletMap && hasSelection()) {
            restrictLeafletToCountry(leafletMap, window._detectlabCountryBounds);
        }
    }

    window.DetectLabGlobeGate = {
        attach: attach,
        open: openGate,
        close: function () { closeGate(true); },
        hasSelection: hasSelection,
        reset: function () {
            clearStoredSelection();
            unlockCountryView();
            window._detectlabSelectedCountry = null;
            window._detectlabSelectedCountryName = null;
            window._detectlabCountryBounds = null;
            document.documentElement.classList.remove('country-selected');
            if (document.body) document.body.classList.remove('country-selected');
        },
        getSelection: function () {
            return hasSelection() ? { iso: window._detectlabSelectedCountry, name: window._detectlabSelectedCountryName, bbox: window._detectlabCountryBounds } : null;
        },

        /* ── Country switching & locked view (js/country-dock.js) ── */
        listCountries: listCountries,          // [{iso, code, name, en, ro, bbox}]
        nameOf: nameOf,                        // iso → localised name
        selectCountry: selectCountryByIso,     // iso → Promise (no globe needed)
        prefetch: prefetch,                    // warm atlas/geometry in the background
        isLocked: function () { return !!state.locked; },
        getLockZoom: function () { return state.fitZoom; },
        unlock: unlockCountryView,
        exitView: exitView,

        // Internal hooks for the node test-suite (test-globe-canvas-picker.js).
        // Not part of the public contract.
        _test: {
            G: G,
            NAMES: NAMES,
            NAME_TO_ISO: NAME_TO_ISO,
            normalizeName: normalizeName,
            buildEurope: buildEurope,
            pick: pick,
            getProj: getProj,
            displayName: displayName,
            draw: draw,
            drawBase: drawBase,
            state: state,
            approxBbox: approxBbox,
            listCountries: listCountries,
            restrictLeafletToCountry: restrictLeafletToCountry,
            unlockCountryView: unlockCountryView,
            showCountryBoundsLayer: showCountryBoundsLayer,
            removeCountryBoundsLayer: removeCountryBoundsLayer,
            refreshCountryBoundsLayer: refreshCountryBoundsLayer,
            BOUNDS_PANE: BOUNDS_PANE,
            BOUNDS_PANE_Z: BOUNDS_PANE_Z,
            LOCK_PAD: LOCK_PAD,
            LOCK_ZOOM_SLACK: LOCK_ZOOM_SLACK,
            FIT_MAX_ZOOM: FIT_MAX_ZOOM
        }
    };
})(window, document);
