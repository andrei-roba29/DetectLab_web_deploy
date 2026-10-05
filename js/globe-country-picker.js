/* ══════════════════════════════════════════════════════════════
   DetectLab — 3D Globe Country Gate
   ──────────────────────────────────────────────────────────────
   The very first thing an authenticated visitor sees in the map
   card: a MapLibre GL "globe" projection of the whole world. Every
   European country is tinted a translucent grey-violet with a black
   border; hovering a country swaps it to a translucent neon-green.
   Clicking a country hands off to the normal 2D working map (the
   existing Leaflet instance in js/map-app.js), locking pan/zoom so
   only that country — and whatever overlays intersect it — stay
   reachable. This replaces the earlier flat Leaflet country picker.
   See js/map-app.js#filterLayersForCountry for how the layer
   catalogue reacts to the selected ISO code.

   MapLibre GL JS + its CSS are lazy-loaded from unpkg the first time
   the gate actually has to render (never for a returning visitor who
   already picked a country — see readStoredSelection()). The
   European polygon set is streamed from the project's own Supabase
   bucket; if that payload is unavailable or unusable the module
   silently falls back to a public Natural Earth country outline
   file so the feature never hard-locks the app.
   ══════════════════════════════════════════════════════════════ */
(function (window, document) {
    'use strict';
    if (!window || !document) return;

    var GEOJSONSEQ_URL = 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/europe-places.geojsonseq';
    var FALLBACK_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
    var MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@5.16.0/dist/maplibre-gl.min.js';
    var MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@5.16.0/dist/maplibre-gl.min.css';
    var BASE_STYLE = 'https://tiles.openfreemap.org/styles/dark';
    var STORAGE_KEY = 'detectlab_selected_country_v1';
    var MIN_USABLE_COUNTRIES = 15;
    var FETCH_TIMEOUT_MS = 20000;
    var MAX_STREAMED_FEATURES = 8000;

    var CONTROL_IDS = ['mapSearchWrap', 'transpTab', 'transpPanel', 'verticalOpacityControl', 'verticalSatPeriodControl', 'mapHelpBtn'];

    // Every European (+ immediate-neighbour) ISO-3166-1 alpha-2 code the
    // picker will accept. Kept identical to the retired js/country-selector.js
    // list so coverage doesn't silently shrink.
    var NAMES = {
        AL: { en: 'Albania', ro: 'Albania' },
        AD: { en: 'Andorra', ro: 'Andorra' },
        AM: { en: 'Armenia', ro: 'Armenia' },
        AT: { en: 'Austria', ro: 'Austria' },
        AZ: { en: 'Azerbaijan', ro: 'Azerbaidjan' },
        BY: { en: 'Belarus', ro: 'Belarus' },
        BE: { en: 'Belgium', ro: 'Belgia' },
        BA: { en: 'Bosnia and Herzegovina', ro: 'Bosnia și Herțegovina' },
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
        VA: { en: 'Vatican City', ro: 'Vatican', alt: ['holy see'] }
    };

    // Rough [lng, lat, zoom] fallback used only when every geometry source
    // failed to load — keeps the picker usable (if geometrically crude)
    // even with zero network access to a polygon dataset.
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

    function isoFromProps(props) {
        props = props || {};
        var candidates = [
            props.ISO_A2, props.iso_a2, props.ISO2, props.iso2, props.ISO_A2_EH, props.iso_a2_eh,
            props.cca2, props.CCA2, props['ISO3166-1-Alpha-2'], props.iso_3166_1_alpha_2, props.CNTR_ID, props.cntr_id
        ];
        for (var i = 0; i < candidates.length; i++) {
            var v = candidates[i];
            if (v && typeof v === 'string' && /^[A-Za-z]{2}$/.test(v) && v.toUpperCase() !== 'NA') {
                return v.toUpperCase();
            }
        }
        var name = props.ADMIN || props.admin || props.NAME_EN || props.name_en || props.NAME || props.name ||
            props.name_long || props.NAME_LONG || props.sovereignt || props.SOVEREIGNT || '';
        return NAME_TO_ISO[normalizeName(name)] || null;
    }

    function nameFromProps(props, iso) {
        var raw = props.NAME_EN || props.name_en || props.ADMIN || props.admin || props.NAME || props.name ||
            props.name_long || props.NAME_LONG || '';
        if (raw) return String(raw);
        var ov = NAMES[iso];
        return ov ? ov.en : iso;
    }

    function geometryBBox(geom) {
        if (!geom) return null;
        var bbox = [Infinity, Infinity, -Infinity, -Infinity];
        function visit(coords, depth) {
            if (depth === 0) {
                var lng = coords[0], lat = coords[1];
                if (typeof lng !== 'number' || typeof lat !== 'number') return;
                if (lng < bbox[0]) bbox[0] = lng;
                if (lat < bbox[1]) bbox[1] = lat;
                if (lng > bbox[2]) bbox[2] = lng;
                if (lat > bbox[3]) bbox[3] = lat;
            } else {
                for (var i = 0; i < coords.length; i++) visit(coords[i], depth - 1);
            }
        }
        var depth = geom.type === 'Polygon' ? 2 : (geom.type === 'MultiPolygon' ? 3 : null);
        if (depth === null) return null;
        try { visit(geom.coordinates, depth); } catch (e) { return null; }
        if (!isFinite(bbox[0]) || !isFinite(bbox[1])) return null;
        return bbox;
    }

    function mergeBbox(a, b) {
        return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
    }

    /* ── Fetch helpers ── */
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

    function parseSeqLine(line) {
        if (!line) return null;
        // GeoJSON Text Sequences (RFC 8142) may prefix each record with the
        // ASCII Record Separator (0x1E); plain NDJSON never does.
        line = line.replace(/^\u001e/, '').trim();
        if (!line) return null;
        try {
            var obj = JSON.parse(line);
            if (obj && obj.type === 'Feature' && obj.geometry) return obj;
        } catch (e) {}
        return null;
    }

    function streamFeatures(response, maxFeatures) {
        var features = [];
        if (!response.body || typeof TextDecoder === 'undefined' || !response.body.getReader) {
            return response.text().then(function (text) {
                var lines = text.split(/\r?\n/);
                for (var i = 0; i < lines.length && features.length < maxFeatures; i++) {
                    var f = parseSeqLine(lines[i]);
                    if (f) features.push(f);
                }
                return features;
            });
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buffer = '';
        function pump() {
            return reader.read().then(function (result) {
                if (result.done) {
                    var last = parseSeqLine(buffer);
                    if (last) features.push(last);
                    return features;
                }
                buffer += decoder.decode(result.value, { stream: true });
                var parts = buffer.split('\n');
                buffer = parts.pop();
                for (var i = 0; i < parts.length; i++) {
                    if (features.length >= maxFeatures) {
                        try { reader.cancel(); } catch (e) {}
                        return features;
                    }
                    var f = parseSeqLine(parts[i]);
                    if (f) features.push(f);
                }
                return pump();
            });
        }
        return pump();
    }

    function buildCatalog(rawFeatures) {
        var features = [];
        var isoToIds = {};
        var isoToBbox = {};
        var isoToName = {};
        var fid = 0;
        (rawFeatures || []).forEach(function (feat) {
            if (!feat || !feat.geometry) return;
            var gt = feat.geometry.type;
            if (gt !== 'Polygon' && gt !== 'MultiPolygon') return;
            var props = feat.properties || {};
            var iso = isoFromProps(props);
            if (!iso || !EUROPE_ISO[iso]) return;
            var bbox = geometryBBox(feat.geometry);
            if (!bbox) return;
            var thisId = fid++;
            var outProps = { _dl_iso: iso, _dl_name: nameFromProps(props, iso) };
            features.push({ type: 'Feature', id: thisId, geometry: feat.geometry, properties: outProps });
            (isoToIds[iso] || (isoToIds[iso] = [])).push(thisId);
            isoToBbox[iso] = isoToBbox[iso] ? mergeBbox(isoToBbox[iso], bbox) : bbox;
            if (!isoToName[iso]) isoToName[iso] = outProps._dl_name;
        });
        return { type: 'FeatureCollection', features: features, isoToIds: isoToIds, isoToBbox: isoToBbox, isoToName: isoToName };
    }

    function loadSupabaseCatalog() {
        return fetchWithTimeout(GEOJSONSEQ_URL, FETCH_TIMEOUT_MS)
            .then(function (res) { return streamFeatures(res, MAX_STREAMED_FEATURES); })
            .then(function (raw) {
                var cat = buildCatalog(raw);
                var count = Object.keys(cat.isoToBbox).length;
                if (count < MIN_USABLE_COUNTRIES) {
                    throw new Error('Supabase europe-places dataset yielded only ' + count + ' usable countries');
                }
                console.info('[DetectLab] Globe gate: ' + count + ' countries loaded from the Supabase dataset.');
                return cat;
            });
    }

    function loadFallbackCatalog() {
        return fetchWithTimeout(FALLBACK_GEOJSON_URL, FETCH_TIMEOUT_MS)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                var cat = buildCatalog(data.features || []);
                console.warn('[DetectLab] Globe gate: using the public country-outline fallback (' + Object.keys(cat.isoToBbox).length + ' countries).');
                return cat;
            });
    }

    function loadCatalog() {
        return loadSupabaseCatalog().catch(function (err) {
            console.warn('[DetectLab] Globe gate: Supabase dataset unavailable, falling back.', err && err.message);
            return loadFallbackCatalog();
        });
    }

    /* ── Lazy asset loading ── */
    var libPromise = null;
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(s);
        });
    }
    function loadCssOnce(href) {
        if (document.querySelector('link[data-dl-globe-css]')) return;
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        l.setAttribute('data-dl-globe-css', '1');
        document.head.appendChild(l);
    }
    function supportsWebGL() {
        try {
            var c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }
    function loadMapLibre() {
        if (window.maplibregl) return Promise.resolve();
        if (!supportsWebGL()) return Promise.reject(new Error('WebGL unavailable'));
        if (libPromise) return libPromise;
        loadCssOnce(MAPLIBRE_CSS);
        libPromise = loadScript(MAPLIBRE_JS);
        return libPromise;
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

    /* ── Leaflet handoff ── */
    function setMapControlsHidden(hidden) {
        CONTROL_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.classList.toggle('auth-hidden', !!hidden);
        });
    }

    function restrictLeafletToCountry(map, bbox) {
        if (!map || !window.L) return;
        try {
            var sw = window.L.latLng(bbox[1], bbox[0]);
            var ne = window.L.latLng(bbox[3], bbox[2]);
            var bounds = window.L.latLngBounds(sw, ne);
            var padded = bounds.pad(0.25);
            map.setMaxBounds(null);
            var fitZoom;
            try { fitZoom = map.getBoundsZoom(padded, false); } catch (e) { fitZoom = null; }
            if (typeof fitZoom === 'number' && isFinite(fitZoom)) {
                var baseMin = (map.options && map.options.minZoom) || 2;
                var baseMax = (map.options && map.options.maxZoom) || 20;
                var newMin = Math.max(baseMin, Math.min(baseMax, fitZoom - 0.4));
                map.setMinZoom(newMin);
            }
            map.options.maxBoundsViscosity = 1;
            map.setMaxBounds(padded);
            map.fitBounds(bounds, { padding: [24, 24], maxZoom: 9, animate: true });
        } catch (e) {
            console.warn('[DetectLab] Globe gate: could not restrict the map to the selected country', e);
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
        var leafletMap = state.leafletMap || window._dlMap;
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

    /* ── Module state & DOM refs ── */
    var state = {
        leafletMap: null,
        map: null,
        catalog: null,
        readyPromise: null,
        globeFailed: false,
        layerWired: false,
        spinEnabled: true,
        userInteracting: false,
        hoveredIso: null
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

    /* ── Spin animation (pauses on interaction, matches the classic
       Mapbox/MapLibre "spinning globe" demo pattern) ── */
    function spinGlobe() {
        var map = state.map;
        if (!map || !state.spinEnabled || state.userInteracting) return;
        var zoom = map.getZoom();
        if (zoom >= 4) return;
        var degPerSec = zoom > 2 ? (360 / 240) * ((4 - zoom) / 2) : 360 / 240;
        var center = map.getCenter();
        center.lng -= degPerSec;
        map.easeTo({ center: center, duration: 1000, easing: function (n) { return n; } });
    }
    function startSpin() {
        var map = state.map;
        if (!map || map._dlSpinWired) return;
        map._dlSpinWired = true;
        map.on('moveend', spinGlobe);
        map.on('mousedown', function () { state.userInteracting = true; });
        map.on('touchstart', function () { state.userInteracting = true; }, { passive: true });
        map.on('dragend', function () { state.userInteracting = false; spinGlobe(); });
        map.on('pitchend', function () { state.userInteracting = false; spinGlobe(); });
        map.on('rotateend', function () { state.userInteracting = false; spinGlobe(); });
        map.on('wheel', function () { state.userInteracting = true; window.clearTimeout(map._dlWheelTimer); map._dlWheelTimer = window.setTimeout(function () { state.userInteracting = false; }, 1200); });
        spinGlobe();
    }

    /* ── MapLibre construction ── */
    function buildGlobe() {
        if (state.map) return Promise.resolve(state.map);
        return new Promise(function (resolve, reject) {
            try {
                var map = new window.maplibregl.Map({
                    container: els.canvas,
                    style: BASE_STYLE,
                    center: [20, 38],
                    zoom: 1.35,
                    minZoom: 0.6,
                    maxZoom: 6.5,
                    maxPitch: 0,
                    dragRotate: false,
                    pitchWithRotate: false,
                    touchPitch: false,
                    attributionControl: { compact: true }
                });
                state.map = map;
                map.addControl(new window.maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'bottom-right');
                map.on('error', function (e) { console.warn('[DetectLab] Globe gate map error', e && e.error); });
                map.on('style.load', function () {
                    try { if (typeof map.setProjection === 'function') map.setProjection({ type: 'globe' }); } catch (e) {}
                    try {
                        map.setSky({
                            'sky-color': '#0a0f2b',
                            'sky-horizon-blend': 0.55,
                            'horizon-color': '#2c2545',
                            'horizon-fog-blend': 0.55,
                            'fog-color': '#120a24',
                            'fog-ground-blend': 0.7,
                            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 5, 0.35, 8, 0]
                        });
                    } catch (e) {}
                    resolve(map);
                });
            } catch (err) { reject(err); }
        });
    }

    function wireLayer() {
        var map = state.map, catalog = state.catalog;
        if (!map || !catalog || state.layerWired) return;
        state.layerWired = true;
        map.addSource('dl-countries', { type: 'geojson', data: catalog });
        map.addLayer({
            id: 'dl-countries-fill',
            type: 'fill',
            source: 'dl-countries',
            paint: {
                'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#39ff14', '#6b5f82'],
                'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.5, 0.34]
            }
        });
        map.addLayer({
            id: 'dl-countries-line',
            type: 'line',
            source: 'dl-countries',
            paint: {
                'line-color': '#000000',
                'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.2, 1],
                'line-opacity': 0.92
            }
        });

        function setHoverState(iso, val) {
            (catalog.isoToIds[iso] || []).forEach(function (fid) {
                map.setFeatureState({ source: 'dl-countries', id: fid }, { hover: val });
            });
        }
        map.on('mousemove', 'dl-countries-fill', function (e) {
            if (!e.features || !e.features.length) return;
            var iso = e.features[0].properties._dl_iso;
            if (!iso || iso === state.hoveredIso) return;
            if (state.hoveredIso) setHoverState(state.hoveredIso, false);
            state.hoveredIso = iso;
            setHoverState(iso, true);
            map.getCanvas().style.cursor = 'pointer';
            showHint(displayName(iso, catalog.isoToName[iso]));
            state.userInteracting = true;
        });
        map.on('mouseleave', 'dl-countries-fill', function () {
            if (state.hoveredIso) setHoverState(state.hoveredIso, false);
            state.hoveredIso = null;
            map.getCanvas().style.cursor = '';
            hideHint();
            state.userInteracting = false;
            spinGlobe();
        });
        map.on('click', 'dl-countries-fill', function (e) {
            if (!e.features || !e.features.length) return;
            var iso = e.features[0].properties._dl_iso;
            if (iso) selectCountry(iso);
        });

        startSpin();
    }

    function selectCountry(iso) {
        var catalog = state.catalog;
        var bbox = catalog && catalog.isoToBbox[iso];
        if (!bbox) return;
        var name = displayName(iso, catalog.isoToName[iso]);
        state.spinEnabled = false;
        showHint(name, true);
        try {
            if (state.map) {
                state.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 48, duration: 900, maxZoom: 5 });
            }
        } catch (e) {}
        window.setTimeout(function () { finishSelection(iso, name, bbox); }, state.map ? 680 : 0);
    }

    function finishSelection(iso, name, bbox) {
        persistSelection(iso, name, bbox);
        applySelection(iso, name, bbox);
        closeGate(true);
    }

    /* ── Gate open/close orchestration ── */
    function ensureReady() {
        if (state.readyPromise) return state.readyPromise;
        showError(false);
        showLoading(true);

        var catalogPromise = loadCatalog().then(function (cat) { state.catalog = cat; });
        var globePromise = loadMapLibre()
            .then(buildGlobe)
            .then(function () { state.globeFailed = false; })
            .catch(function (err) {
                state.globeFailed = true;
                console.warn('[DetectLab] Globe gate: 3D globe unavailable, using the list fallback.', err && err.message);
            });

        state.readyPromise = Promise.all([catalogPromise, globePromise]).then(function () {
            showLoading(false);
            if (!state.globeFailed) {
                wireLayer();
                if (els.canvas) els.canvas.style.display = '';
                if (els.fallbackWrap) els.fallbackWrap.classList.add('hidden');
            } else {
                if (els.canvas) els.canvas.style.display = 'none';
                populateFallbackSelect();
                if (els.fallbackWrap) els.fallbackWrap.classList.remove('hidden');
            }
        }).catch(function (err) {
            state.readyPromise = null;
            showLoading(false);
            var t = (document.documentElement.lang === 'ro')
                ? 'Harta lumii nu a putut fi încărcată. Verifică conexiunea și încearcă din nou.'
                : 'The world map could not load. Please check your connection and try again.';
            showError(true, t);
            throw err;
        });
        return state.readyPromise;
    }

    function openGate() {
        if (!els.root) return;
        els.root.classList.remove('hidden', 'is-leaving');
        els.root.setAttribute('aria-hidden', 'false');
        if (els.closeBtn) els.closeBtn.style.display = hasSelection() ? '' : 'none';
        setMapControlsHidden(true);
        ensureReady().then(function () {
            if (!state.globeFailed) {
                state.spinEnabled = true;
                window.requestAnimationFrame(function () { state.map && state.map.resize(); spinGlobe(); });
            }
        }).catch(function () { /* surfaced via showError() inside ensureReady */ });
    }

    function closeGate(revealControls) {
        if (!els.root) return;
        els.root.classList.add('is-leaving');
        // Stop spending GPU time rotating the globe while it isn't visible;
        // openGate() re-enables this once the gate is shown again.
        state.spinEnabled = false;
        window.setTimeout(function () {
            els.root.classList.add('hidden');
            els.root.classList.remove('is-leaving');
            els.root.setAttribute('aria-hidden', 'true');
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
        if (els.fallbackBtn) {
            els.fallbackBtn.addEventListener('click', function () {
                var iso = els.fallbackSelect && els.fallbackSelect.value;
                if (!iso) return;
                var catalog = state.catalog;
                var bbox = (catalog && catalog.isoToBbox[iso]) || null;
                var name = displayName(iso, (catalog && catalog.isoToName[iso]) || NAMES[iso].en);
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
            window._detectlabSelectedCountry = null;
            window._detectlabSelectedCountryName = null;
            window._detectlabCountryBounds = null;
            document.documentElement.classList.remove('country-selected');
            if (document.body) document.body.classList.remove('country-selected');
        },
        getSelection: function () {
            return hasSelection() ? { iso: window._detectlabSelectedCountry, name: window._detectlabSelectedCountryName, bbox: window._detectlabCountryBounds } : null;
        }
    };
})(window, document);
