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
 *    etichetă permanentă cu titlul bătăliei
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
    var _group = null;         // L.layerGroup cu markerii
    var _circleById = {};      // id → L.circle (evenimente afișate)
    var _evById = {};          // id → eveniment (pentru refresh i18n)

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
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
        if (!_group) {
            _group = L.layerGroup([], { pane: 'pane_battles' });
            window._battlesGroup = _group;
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

    // ── Panoul de control (eticheta secolului + numărător) ──
    function updatePanel() {
        var valEl = document.getElementById('battlesPeriodValue');
        if (valEl) valEl.textContent = centuryLabel(_period);
        var cntEl = document.getElementById('battlesCountLabel');
        if (cntEl) {
            var n = _visible && _data ? eventsForPeriod().length : 0;
            cntEl.textContent = tt('battles_count').replace('{n}', String(n));
        }
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
                if (c.unbindTooltip) c.unbindTooltip();
                if (_group.hasLayer(c)) _group.removeLayer(c);
            }
        });
        _circleById = {};
        _evById = {};

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

            var txt = ev[mapL] || ev.ro;
            circle.bindTooltip(esc(txt.titlu), {
                permanent: true,
                direction: 'top',
                offset: [0, -8],
                className: 'battles-label battles-enter',
                interactive: true,
                opacity: 1
            });

            _circleById[ev.id] = circle;
            _evById[ev.id] = ev;
            circle.addTo(_group);
        });

        updatePanel();
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
            }).catch(function () {
                var cntEl = document.getElementById('battlesCountLabel');
                if (cntEl) cntEl.textContent = '⚠';
            });
        } else {
            if (_group) map.removeLayer(_group);
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
            if (c.setTooltipContent) c.setTooltipContent(esc(txt.titlu));
            if (c.bindPopup) c.bindPopup(buildPopupContent(ev)); // refolosește instanța → update live
        });
        updatePanel();
    });

    // Sincronizare inițială a etichetei + numărătorului
    function initPanel() {
        var valEl = document.getElementById('battlesPeriodValue');
        if (valEl) valEl.textContent = centuryLabel(_period);
        var cntEl = document.getElementById('battlesCountLabel');
        if (cntEl) cntEl.textContent = tt('battles_count').replace('{n}', '0');
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initPanel();
    } else {
        document.addEventListener('DOMContentLoaded', initPanel);
    }
})();
