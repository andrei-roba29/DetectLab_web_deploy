/* =====================================================================
 * battles-layer.js — strat premium „Bătălii / Battles"
 * ---------------------------------------------------------------------
 * Date bilingve: data/conflicte_militare/conflicte_militare_romania.bilingual.json
 * (163 evenimente, sec. VIII î.Hr. – 1944, RO + EN)
 *
 * Comportament:
 *  • switch master (premium) — toggleBattlesLayer(on)
 *  • slider DE PERIOADĂ (nu de opacitate!): secolele -8 … 20 (VIII î.Hr. – XX d.Hr.);
 *    fiecare secol afișează evenimentele aferente
 *  • fiecare eveniment: zonă colorată semitransparentă cu contur punctat +
 *    etichetă permanentă cu titlul bătăliei, ANCORATĂ PE PROPRIA RAZĂ
 *    (marginea cercului); etichetele se redistribuie automat în jurul cercului
 *    la pan/zoom, ca să nu se suprapună între ele
 *  • click pe zonă SAU etichetă → fereastră extinsă cu descrierea completă
 *    (bilingvă) + buton „Caută mai mult / Search more" → căutare Google
 *    cu titlul și anul bătăliei
 * ===================================================================== */
(function () {
    'use strict';

    var DATA_URL = 'data/conflicte_militare/conflicte_militare_romania.bilingual.json';

    // ── Stare internă ──
    var _data = null;          // evenimentele (după fetch)
    var _promise = null;       // fetch în curs
    var _visible = false;      // stratul e pornit?
    var _period = 14;          // secolul selectat (secol_n: -8 … 20)
    var _group = null;         // L.layerGroup cu cercurile
    var _circleById = {};      // id → L.circle (evenimente afișate)
    var _evById = {};          // id → eveniment (pentru refresh i18n)
    var _labelById = {};       // id → { el, circle, ev } — etichetele proprii
    var _mapHooked = false;    // evenimentele de hartă sunt deja legate?

    // ── Paleta de culori pe epoci (culori sugestive, semitransparente) ──
    var EPOCHS = [
        { min: -8, max: -1, color: '#9b59b6', key: 'battles_epoch_antiquity' },    // Antichitate preromană
        { min: 1,  max: 4,  color: '#e74c3c', key: 'battles_epoch_dacoroman' },    // Epoca daco-romană
        { min: 5,  max: 9,  color: '#e67e22', key: 'battles_epoch_migrations' },   // Migrații / ev mediu timpuriu
        { min: 10, max: 13, color: '#d4a017', key: 'battles_epoch_medieval' },     // Evul Mediu
        { min: 14, max: 17, color: '#16a085', key: 'battles_epoch_earlymodern' },  // Epoca modernă timpurie
        { min: 18, max: 20, color: '#2980b9', key: 'battles_epoch_modern' }        // Epoca modernă
    ];

    // ── Helpers i18n ──
    function lang() {
        return (typeof window._currentLang === 'function') ? window._currentLang() : 'ro';
    }
    function T() {
        var l = lang();
        return (typeof translations !== 'undefined' && translations[l]) ? translations[l] : {};
    }
    function tt(key) {
        var t = T();
        return t[key] !== undefined ? t[key] : key;
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── Etichete de secol (RO + EN) ──
    var RO_NUM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
        'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
    var EN_ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
        '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th'];

    function centuryLabel(n) {
        var abs = Math.abs(n);
        if (lang() === 'ro') {
            return 'Sec. ' + (RO_NUM[abs] || abs) + (n < 0 ? ' î.Hr.' : ' d.Hr.');
        }
        return (EN_ORD[abs] || abs) + ' c. ' + (n < 0 ? 'BC' : 'AD');
    }

    function yearLabel(y) {
        if (lang() === 'ro') return (y < 0 ? (-y) + ' î.Hr.' : y + ' d.Hr.');
        return (y < 0 ? (-y) + ' BC' : y + ' AD');
    }

    function dateRange(ev) {
        var approx = /^c\./.test(ev.ro.data_start || '') || /^c\./.test(ev.ro.data_end || '');
        var prefix = approx ? 'c. ' : '';
        if (ev.an_start === ev.an_end) return prefix + yearLabel(ev.an_start);
        return prefix + yearLabel(ev.an_start) + ' – ' + yearLabel(ev.an_end);
    }

    function epochColor(secolN) {
        for (var i = 0; i < EPOCHS.length; i++) {
            if (secolN >= EPOCHS[i].min && secolN <= EPOCHS[i].max) return EPOCHS[i].color;
        }
        return '#8e8e8e';
    }

    // ── Încărcare date (o singură dată) ──
    function loadData() {
        if (_data) return Promise.resolve(_data);
        if (_promise) return _promise;
        _promise = fetch(DATA_URL)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (db) {
                _data = (db && db.conflicte) || [];
                return _data;
            })
            .catch(function (err) {
                _promise = null;
                console.error('[Battles] Nu s-au putut încărca datele:', err);
                throw err;
            });
        return _promise;
    }

    function getMap() {
        return window._dlMap || window.map || null;
    }

    // ── Panou / grup Leaflet ──
    function ensurePane(map) {
        if (!map.getPane('pane_battles')) {
            map.createPane('pane_battles');
            map.getPane('pane_battles').style.zIndex = 640; // deasupra Roman (625), sub tooltips (650)
        }
        if (!map.getPane('pane_battles_labels')) {
            map.createPane('pane_battles_labels');
            map.getPane('pane_battles_labels').style.zIndex = 645; // etichetele, peste zone
        }
        if (!_group) {
            _group = L.layerGroup([], { pane: 'pane_battles' });
            window._battlesGroup = _group;
        }
        // Repoziționăm etichetele la fiecare schimbare de hartă (pan / zoom / resize)
        if (!_mapHooked) {
            _mapHooked = true;
            var relayout = function () { if (_visible) relayoutLabels(); };
            map.on('moveend zoomend resize viewreset', relayout);
        }
    }

    // ── Evenimentele din secolul selectat ──
    // Un eveniment aparține secolului dacă intervalul lui (an_start..an_end)
    // se suprapune cu intervalul secolului (ex. sec. XIV = 1301–1400,
    // sec. VIII î.Hr. = -800…-701).
    function eventsForPeriod() {
        var n = _period;
        var startYear, endYear;
        if (n < 0) {
            startYear = n * 100;
            endYear = n * 100 + 99;
        } else {
            startYear = (n - 1) * 100 + 1;
            endYear = n * 100;
        }
        if (!_data) return [];
        return _data.filter(function (ev) {
            return ev.an_start <= endYear && ev.an_end >= startYear;
        });
    }

    // ── Conținutul popup-ului (bilingv) ──
    function buildPopupContent(ev) {
        var l = lang();
        var txt = ev[l] || ev.ro;
        var isContext = ev.teritoriu !== 'da';
        // Căutarea Google folosește titlul + anul bătăliei (ex. „Battle of Posada 1330")
        var searchYear = ev.an_start < 0 ? (-ev.an_start) + ' BC' : String(ev.an_start);
        var query = encodeURIComponent(txt.titlu + ' ' + searchYear);
        var googleUrl = 'https://www.google.com/search?q=' + query;

        var html = '<div class="battles-popup-inner">';
        html += '<div class="battles-popup-title">' + esc(txt.titlu) + '</div>';
        html += '<div class="battles-popup-meta">' +
            '<span class="battles-popup-date">🗓 ' + esc(dateRange(ev)) + '</span>' +
            '<span class="battles-popup-type">' + esc(txt.tip) + '</span>' +
            '</div>';
        if (isContext) {
            html += '<div class="battles-popup-context">' + esc(tt('battles_context_note')) + '</div>';
        }
        html += '<div class="battles-popup-row"><span class="battles-popup-k">' + esc(tt('battles_popup_location')) + '</span><span>' + esc(txt.locatie) + '</span></div>';
        html += '<div class="battles-popup-row"><span class="battles-popup-k">' + esc(tt('battles_popup_participants')) + '</span><span>' + esc(txt.participanti) + '</span></div>';
        html += '<div class="battles-popup-row"><span class="battles-popup-k">' + esc(tt('battles_popup_result')) + '</span><span>' + esc(txt.rezultat) + '</span></div>';
        html += '<div class="battles-popup-desc">' + esc(txt.descriere) + '</div>';
        html += '<a class="battles-popup-search" href="' + googleUrl + '" target="_blank" rel="noopener">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex-shrink:0"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2"/><line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
            '<span>' + esc(tt('battles_search_more')) + '</span>' +
            '</a>';
        html += '</div>';
        return html;
    }

    // ── Panoul de control (doar eticheta secolului) ──
    function updatePanel() {
        var valEl = document.getElementById('battlesPeriodValue');
        if (valEl) valEl.textContent = centuryLabel(_period);
    }

    // ── Etichete ancorate pe fiecare rază (fără suprapunere) ──
    // Direcții în jurul cercului, pornind dinspre nord (sus), în sens orar.
    var LABEL_DIRS = [
        [0, -1], [0.7071, -0.7071], [1, 0], [0.7071, 0.7071],
        [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071]
    ];
    // Pentru fiecare direcție: unde se „prinde" eticheta de punctul de ancorare
    // (fracțiuni din lățimea / înălțimea etichetei, raportate la centrul ei).
    var LABEL_ATTACH = [
        [0, -0.5], [-0.5, -0.5], [-0.5, 0], [-0.5, 0.5],
        [0, 0.5], [0.5, 0.5], [0.5, 0], [0.5, -0.5]
    ];
    var LABEL_GAP = 8;   // distanța etichetei față de marginea cercului (px)
    var LABEL_PAD = 3;   // spațiu de siguranță între etichete (px)

    // Raza cercului exprimată în pixeli (în sistemul de coordonate al hărții).
    function circlePixelRadius(map, latlng, radiusMeters) {
        if (typeof map.latLngToContainerPoint !== 'function' ||
            typeof map.containerPointToLatLng !== 'function' ||
            typeof map.distance !== 'function' || !radiusMeters) return 0;
        var pt = map.latLngToContainerPoint(latlng);
        var mpp = map.distance(latlng, map.containerPointToLatLng([pt.x, pt.y - 1]));
        return mpp > 0 ? radiusMeters / mpp : 0;
    }

    function boxesOverlap(a, b) {
        return a.minX < b.maxX && a.maxX > b.minX &&
               a.minY < b.maxY && a.maxY > b.minY;
    }

    function overlapArea(a, b) {
        if (!boxesOverlap(a, b)) return 0;
        var w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        var h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        return w * h;
    }

    // Repoziționează toate etichetele: fiecare este ancorată pe marginea
    // propriului cerc („pe propria rază") și, dacă se suprapune cu altele,
    // este mutată în jurul cercului până găsește un loc liber.
    function relayoutLabels() {
        var map = getMap();
        if (!map) return;
        var ids = Object.keys(_labelById);
        if (!ids.length) return;
        if (typeof map.latLngToLayerPoint !== 'function') return;

        var placed = []; // casetele deja ocupate
        ids.forEach(function (id) {
            var rec = _labelById[id];
            var circle = rec.circle, el = rec.el;
            var latlng = (typeof circle.getLatLng === 'function') ? circle.getLatLng() : null;
            if (!latlng) return;
            var w = el.offsetWidth || 0;
            var h = el.offsetHeight || 0;
            if (!w || !h) return; // încă nemăsurată — se reia la următorul relayout

            var center = map.latLngToLayerPoint(latlng);
            var rMeters = (typeof circle.getRadius === 'function') ? circle.getRadius() : 0;
            var rPx = circlePixelRadius(map, latlng, rMeters);

            var best = null, bestOverlap = Infinity;
            for (var i = 0; i < LABEL_DIRS.length; i++) {
                var d = LABEL_DIRS[i];
                var at = LABEL_ATTACH[i];
                var ax = center.x + d[0] * (rPx + LABEL_GAP);
                var ay = center.y + d[1] * (rPx + LABEL_GAP);
                var cx = ax + at[0] * w;
                var cy = ay + at[1] * h;
                var box = {
                    minX: cx - w / 2 - LABEL_PAD, minY: cy - h / 2 - LABEL_PAD,
                    maxX: cx + w / 2 + LABEL_PAD, maxY: cy + h / 2 + LABEL_PAD
                };
                var ov = 0;
                for (var j = 0; j < placed.length; j++) ov += overlapArea(box, placed[j]);
                if (ov === 0) { best = { cx: cx, cy: cy, box: box }; break; }
                if (ov < bestOverlap) { bestOverlap = ov; best = { cx: cx, cy: cy, box: box }; }
            }
            placed.push(best.box);
            el.style.transform = 'translate3d(' +
                Math.round(best.cx - w / 2) + 'px,' +
                Math.round(best.cy - h / 2) + 'px,0)';
        });
    }

    // ── Randare markeri pentru secolul curent ──
    function render() {
        var map = getMap();
        if (!map || !_group) return;

        // curățăm markerii anteriori (și popup-urile deschise)
        Object.keys(_circleById).forEach(function (id) {
            var c = _circleById[id];
            if (c) {
                if (c.closePopup) c.closePopup();
                if (_group.hasLayer(c)) _group.removeLayer(c);
            }
        });
        _circleById = {};
        _evById = {};

        // curățăm etichetele vechi
        Object.keys(_labelById).forEach(function (id) {
            var rec = _labelById[id];
            if (rec && rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
        });
        _labelById = {};

        var events = eventsForPeriod();
        var mapL = lang();

        events.forEach(function (ev) {
            if (ev.lat == null || ev.lng == null) return;
            var isContext = ev.teritoriu !== 'da';
            var color = epochColor(ev.secol_n);
            var radius = (ev.zona_aprox === 1) ? 26000 : 9000;

            var circle = L.circle([ev.lat, ev.lng], {
                pane: 'pane_battles',
                radius: radius,
                color: isContext ? '#dfe6ee' : color,
                weight: isContext ? 1.4 : 2.2,
                opacity: 0.9,
                dashArray: isContext ? '3 7' : '8 6',   // contur punctat
                fillColor: color,
                fillOpacity: isContext ? 0.12 : 0.30,  // semitransparent
                className: 'battles-zone battles-enter',
                interactive: true,
                bubblingMouseEvents: false
            });

            // Popup-ul complet; click pe zonă SAU pe etichetă îl deschide
            // (eticheta interactivă redirecționează click-ul către cerc,
            //  iar bindPopup are toggle-ul standard Leaflet)
            circle.bindPopup(buildPopupContent(ev), {
                maxWidth: 430,
                minWidth: 280,
                className: 'battles-popup',
                autoPan: true,
                closeButton: true
            });

            // Eticheta permanentă — element propriu, ancorat pe marginea
            // cercului (poziția e calculată în relayoutLabels).
            var txt = ev[mapL] || ev.ro;
            circle._labelText = txt.titlu; // expus pentru teste
            var el = document.createElement('div');
            el.className = 'battles-label';
            el.textContent = txt.titlu;
            el.title = txt.titlu;
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                circle.openPopup();
            });
            var pane = map.getPane('pane_battles_labels');
            if (pane) pane.appendChild(el);
            _labelById[ev.id] = { el: el, circle: circle, ev: ev };

            _circleById[ev.id] = circle;
            _evById[ev.id] = ev;
            circle.addTo(_group);
        });

        relayoutLabels();
        updatePanel();

        // Fonturile se pot încărca după randare și schimbă lățimea etichetelor
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                if (_visible) relayoutLabels();
            });
        }
    }

    // ── API public ──
    window.toggleBattlesLayer = function (on) {
        _visible = !!on;
        var toggleEl = document.getElementById('battlesToggle');
        if (toggleEl) toggleEl.checked = _visible;

        var map = getMap();
        if (!map) return;
        ensurePane(map);

        if (_visible) {
            _group.addTo(map);
            loadData().then(function () {
                if (_visible) render();
            }).catch(function (err) {
                console.error('[Battles] Nu s-au putut încărca datele:', err);
            });
        } else {
            if (_group) map.removeLayer(_group);
            Object.keys(_labelById).forEach(function (id) {
                var rec = _labelById[id];
                if (rec && rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
            });
            _labelById = {};
        }
    };

    // Sliderul de perioadă: secol_n (-8 … 20)
    window.setBattlesPeriod = function (val) {
        var n = parseInt(val, 10);
        if (isNaN(n)) return;
        if (n < -8) n = -8;
        if (n > 20) n = 20;
        _period = n;

        var sliderEl = document.getElementById('battlesPeriodSlider');
        if (sliderEl) sliderEl.value = String(n);

        if (_visible && _data) render();
        else updatePanel();
    };

    // Re-randare la schimbarea limbii (RO ↔ EN):
    // etichetele și popup-urile existente sunt actualizate pe loc (fără flicker)
    document.addEventListener('detectlab:langchange', function () {
        if (!_visible) return;
        var mapL = lang();
        Object.keys(_circleById).forEach(function (id) {
            var c = _circleById[id];
            var ev = _evById[id];
            if (!c || !ev) return;
            var txt = ev[mapL] || ev.ro;
            if (c.bindPopup) c.bindPopup(buildPopupContent(ev)); // refolosește instanța → update live
            c._labelText = txt.titlu; // expus pentru teste
            var rec = _labelById[id];
            if (rec && rec.el) {
                rec.el.textContent = txt.titlu;
                rec.el.title = txt.titlu;
            }
        });
        relayoutLabels();
        updatePanel();
    });

    // Sincronizare inițială a etichetei de secol
    function initPanel() {
        var valEl = document.getElementById('battlesPeriodValue');
        if (valEl) valEl.textContent = centuryLabel(_period);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initPanel();
    } else {
        document.addEventListener('DOMContentLoaded', initPanel);
    }
})();
