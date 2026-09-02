/* =====================================================================
 * battles-layer.js — strat premium „Bătălii / Battles"
 * ---------------------------------------------------------------------
 * Date bilingve: data/conflicte_militare/conflicte_militare_romania.bilingual.json
 * (198 evenimente, sec. VIII î.Hr. – 1944, RO + EN)
 *
 * Comportament:
 *  • switch master (premium) — toggleBattlesLayer(on)
 *  • slider DE PERIOADĂ (nu de opacitate!): secolele -8 … 20 (VIII î.Hr. – XX d.Hr.);
 *    fiecare secol afișează evenimentele aferente
 *  • secolul selectat NU mai apare static deasupra sliderului: apare ca o
 *    bulă „on hover” ancorată pe thumb (hover mouse, drag touch, focus tastatură)
 *    și este oglindit în controlul vertical de pe hartă, ca sliderele de
 *    opacitate ale celorlalte straturi (vertical-opacity-control.js)
 *  • fiecare eveniment: zonă colorată semitransparentă cu contur punctat +
 *    etichetă permanentă cu titlul bătăliei, ANCORATĂ STATIC DEASUPRA
 *    PROPRIEI RAZE (marginea de sus a cercului); poziția rămâne pe aceeași
 *    axă la pan/zoom, fără redistribuire în jurul cercului. La zoom animat
 *    (rotiță / dublu-click) eticheta alunecă LINIAR la noua poziție, o dată cu
 *    cercurile — pe evenimentul „zoomanim”, prin tranziția CSS proprie a
 *    Leaflet (clasa .leaflet-zoom-animated) — iar la pinch-zoom este
 *    repoziționată cadru-cu-cadru pe „zoom”; nu mai așteaptă „zoomend”,
 *    deci nu mai sare după fiecare zoom
 *  • click pe zonă SAU etichetă → fereastră COMPACTĂ cu informații: lățime și
 *    înălțime plafonate raportat la ecran (px + vh/vw, din JS și CSS), fonturi
 *    și spațieri mici, descrierea lungă strânsă implicit în câteva rânduri și
 *    desfăcută la cerere cu „Detalii / Details" → nu mai acoperă ecranul;
 *    conținut bilingv + buton „Caută mai mult / Search more" → căutare Google
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
            // „zoom” se emite continuu în timpul pinch-zoom (touch / trackpad):
            // etichetele urmăresc cercurile cadru-cu-cadru, fără salt final.
            map.on('zoom', relayout);
            // „zoomanim” se emite o singură dată la zoom-ul animat (rotiță /
            // dublu-click): etichetele primesc poziția finală o dată cu începutul
            // animației, iar tranziția CSS de 0.25s (activă doar cât conținătorul
            // are clasa .leaflet-zoom-anim) le duce lin la loc — identic cu
            // comportamentul markerilor Leaflet, fără să se scaleze textul.
            map.on('zoomanim', function (e) { if (_visible) relayoutLabelsZoomAnim(e); });
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

    // ── Dimensiunile ferestrei de informații (popup) ──
    // Cerință: fereastra NU trebuie să acopere ecranul. Plafonăm lățimea și
    // înălțimea în JS (Leaflet le scrie inline pe .leaflet-popup-content) și
    // le mai strângem din CSS pe ecrane mici (vezi .battles-popup în
    // styles.css). Valorile de aici sunt „tavanul” pentru desktop; pe telefon
    // popup-ul ocupă ≈ 60% din lățime și ≈ 40% din înălțime.
    var POPUP_MIN_W = 180;
    var POPUP_MAX_W = 264;
    var POPUP_MAX_H = 300;

    function popupMetrics() {
        var w = window.innerWidth || document.documentElement.clientWidth || 1200;
        var h = window.innerHeight || document.documentElement.clientHeight || 800;
        var maxW = POPUP_MAX_W;
        if (w <= 420) maxW = Math.min(224, w - 48);
        else if (w <= 600) maxW = Math.min(240, w - 56);
        else if (w <= 900) maxW = Math.min(256, w - 64);
        var maxH = Math.min(POPUP_MAX_H, Math.round(h * 0.42));
        return {
            maxW: Math.max(POPUP_MIN_W + 10, Math.round(maxW)),
            minW: Math.min(POPUP_MIN_W, Math.round(maxW) - 20),
            maxH: Math.max(150, Math.round(maxH))
        };
    }

    // ── Conținutul popup-ului (bilingv) ──
    // Fereastra trebuie să rămână MICĂ: ocupă o fracțiune din ecran (mai ales
    // pe telefon), iar descrierea lungă este strânsă implicit în câteva
    // rânduri și se desface la cerere cu butonul „Detalii / Ascunde".
    var DESC_CLAMP_LEN = 120;   // peste această lungime descrierea poate fi strânsă

    // Butonul „Detalii / Ascunde” se arată doar dacă textul chiar nu încape în
    // rândurile strânse (altfel descrierea rămâne întreagă, fără fade inutil).
    function fitDescToggle(root) {
        if (!root || !root.querySelector) return;
        var desc = root.querySelector('.battles-popup-desc');
        if (!desc || !desc.classList) return;
        var btn = root.querySelector('.battles-popup-more');
        if (!btn) return;                       // descriere scurtă → fără buton
        if (desc.classList.contains('is-open')) {
            if (btn.style) btn.style.display = '';
            return;
        }
        var needed = (desc.scrollHeight || 0) > (desc.clientHeight || 0) + 2;
        if (btn.style) btn.style.display = needed ? '' : 'none';
        desc.classList.toggle('is-clamped', needed);
    }

    function buildPopupContent(ev) {
        var l = lang();
        var txt = ev[l] || ev.ro;
        var isContext = ev.teritoriu !== 'da';
        // Căutarea Google folosește titlul + anul bătăliei (ex. „Battle of Posada 1330")
        var searchYear = ev.an_start < 0 ? (-ev.an_start) + ' BC' : String(ev.an_start);
        var query = encodeURIComponent(txt.titlu + ' ' + searchYear);
        var googleUrl = 'https://www.google.com/search?q=' + query;

        var desc = String(txt.descriere == null ? '' : txt.descriere);
        var descClamped = desc.length > DESC_CLAMP_LEN;

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
        html += '<div class="battles-popup-desc' + (descClamped ? ' is-clamped' : '') + '">' + esc(desc) + '</div>';
        if (descClamped) {
            html += '<button type="button" class="battles-popup-more" aria-expanded="false" ' +
                'onclick="DetectLabBattlesPopup.toggleDesc(this)">' +
                '<span class="battles-popup-more-txt">' + esc(tt('battles_desc_more')) + '</span>' +
                '<svg class="battles-popup-more-caret" width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5 L6 8 L9.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</button>';
        }
        html += '<a class="battles-popup-search" href="' + googleUrl + '" target="_blank" rel="noopener">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex-shrink:0"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2"/><line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
            '<span>' + esc(tt('battles_search_more')) + '</span>' +
            '</a>';
        html += '</div>';
        return html;
    }

    // Desfacere / strângere a descrierii din interiorul popup-ului.
    // Apelat din onclick-ul butonului generat mai sus (popup-ul este HTML
    // inserat de Leaflet, deci nu avem un handler atașat la build).
    function toggleDesc(btn) {
        if (!btn) return;
        var box = btn.previousElementSibling;
        while (box && !(box.classList && box.classList.contains('battles-popup-desc'))) {
            box = box.previousElementSibling;
        }
        if (!box) return;
        var expanded = box.classList.toggle('is-open');
        btn.classList.toggle('is-open', expanded);
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        var label = btn.querySelector('.battles-popup-more-txt');
        if (label) label.textContent = tt(expanded ? 'battles_desc_less' : 'battles_desc_more');
        // Popup-ul își recalculează dimensiunea și poziția (autoPan) după ce
        // descrierea se desface sau se strânge. ATENȚIE: nu folosim update(),
        // care rescrie innerHTML-ul din string și ar pierde starea „deschis" —
        // doar layout + poziție + panare.
        try {
            var map = getMap();
            var pop = map && map._popup;
            if (pop && (!pop.isOpen || pop.isOpen())) {
                if (pop._updateLayout) pop._updateLayout();
                if (pop._updatePosition) pop._updatePosition();
                if (pop._adjustPan) pop._adjustPan();
            }
        } catch (e) { /* niciodată critic */ }
    }

    // ── Panoul de control: bulă „on hover” cu secolul ──
    // Secolul curent nu mai este afișat static deasupra sliderului; el apare
    // doar când sliderul este atins (pointerenter / pointerdown / focus).
    function updatePanel() {
        var label = centuryLabel(_period);
        var valEl = document.getElementById('battlesPeriodValue');
        if (valEl) valEl.textContent = label;
        var sliderEl = document.getElementById('battlesPeriodSlider');
        if (sliderEl && typeof sliderEl.setAttribute === 'function') {
            sliderEl.setAttribute('aria-valuetext', label);
        }
        positionPeriodTip();
    }

    // ── Bulă „on hover” cu secolul, ancorată pe thumb-ul sliderului ──
    var TIP_THUMB_W = 15;      // lățimea thumb-ului (.transp-slider::-webkit-slider-thumb)
    var TIP_GAP = 7;           // distanța dintre bulă și slider (px)
    var TIP_HIDE_DELAY = 900;  // ms — cât rămâne bula după ridicarea degetului
    var _tipPinned = false;    // true cât timp durează un drag (touch / mouse apăsat)
    var _tipTimer = null;
    var _sliderHooked = false;

    function positionPeriodTip() {
        var sliderEl = document.getElementById('battlesPeriodSlider');
        var tip = document.getElementById('battlesPeriodValue');
        if (!sliderEl || !tip) return;
        var min = parseFloat(sliderEl.min);
        var max = parseFloat(sliderEl.max);
        // Fără layout (teste) sau fără min/max valid: bula rămâne centrată din CSS.
        if (!isFinite(min) || !isFinite(max) || max <= min) return;
        if (typeof sliderEl.offsetLeft !== 'number' || !sliderEl.offsetWidth) return;

        var frac = (_period - min) / (max - min);
        frac = Math.max(0, Math.min(1, frac));
        var track = Math.max(0, sliderEl.offsetWidth - TIP_THUMB_W);
        var x = sliderEl.offsetLeft + TIP_THUMB_W / 2 + frac * track;

        // Clamping: bula nu iese din cardul stratului.
        var host = sliderEl.offsetParent || null;
        var hostW = host ? host.offsetWidth : 0;
        var tipW = tip.offsetWidth || 0;
        if (hostW && tipW) {
            x = Math.max(tipW / 2 + 2, Math.min(hostW - tipW / 2 - 2, x));
        }
        tip.style.left = Math.round(x) + 'px';
        tip.style.top = Math.round(sliderEl.offsetTop - TIP_GAP) + 'px';
    }

    function showPeriodTip() {
        var tip = document.getElementById('battlesPeriodValue');
        if (!tip) return;
        if (_tipTimer) { clearTimeout(_tipTimer); _tipTimer = null; }
        positionPeriodTip();
        tip.classList.add('visible');
    }

    function hidePeriodTip(delay) {
        var tip = document.getElementById('battlesPeriodValue');
        if (!tip) return;
        if (_tipTimer) clearTimeout(_tipTimer);
        _tipTimer = setTimeout(function () {
            _tipTimer = null;
            var t = document.getElementById('battlesPeriodValue');
            if (t) t.classList.remove('visible');
        }, delay || 0);
    }

    function hookPeriodSlider() {
        if (_sliderHooked) return;
        var sliderEl = document.getElementById('battlesPeriodSlider');
        if (!sliderEl || typeof sliderEl.addEventListener !== 'function') return;
        _sliderHooked = true;

        // Hover (mouse / stylus): bulă instantaneousă, dispare la ieșire.
        sliderEl.addEventListener('pointerenter', showPeriodTip);
        sliderEl.addEventListener('pointerleave', function () {
            if (!_tipPinned) hidePeriodTip(0);
        });
        // Touch / click: bula e „prinsă” cât timp durează drag-ul, apoi
        // mai zăbovește puțin (TIP_HIDE_DELAY) ca să poată fi citită.
        sliderEl.addEventListener('pointerdown', function () {
            _tipPinned = true;
            showPeriodTip();
        });
        sliderEl.addEventListener('pointerup', function () {
            _tipPinned = false;
            hidePeriodTip(TIP_HIDE_DELAY);
        });
        sliderEl.addEventListener('pointercancel', function () {
            _tipPinned = false;
            hidePeriodTip(0);
        });
        // Fallback pentru browsere vechi fără PointerEvent.
        sliderEl.addEventListener('touchstart', function () {
            _tipPinned = true;
            showPeriodTip();
        }, { passive: true });
        sliderEl.addEventListener('touchend', function () {
            _tipPinned = false;
            hidePeriodTip(TIP_HIDE_DELAY);
        });
        // Tastatură: apare la focus, dispare la blur.
        sliderEl.addEventListener('focus', showPeriodTip);
        sliderEl.addEventListener('blur', function () { hidePeriodTip(0); });
        // Mișcarea thumb-ului doar repoziționează bala (dacă e vizibilă);
        // valoarea poate veni și din oglinda verticală de pe hartă, caz în
        // care bala nu trebuie să apară de la sine.
        sliderEl.addEventListener('input', function () {
            var tip = document.getElementById('battlesPeriodValue');
            if (tip && tip.classList && tip.classList.contains('visible')) positionPeriodTip();
        });
        // La redimensionare bala se repoziționează doar dacă e vizibilă.
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('resize', function () {
                var tip = document.getElementById('battlesPeriodValue');
                if (tip && tip.classList && tip.classList.contains('visible')) positionPeriodTip();
            });
        }
    }

    // ── Etichete ancorate static deasupra fiecărei raze ──
    var LABEL_GAP = 8; // distanța etichetei față de marginea de sus a cercului (px)

    // Raza cercului exprimată în pixeli (în sistemul de coordonate al hărții).
    function circlePixelRadius(map, latlng, radiusMeters) {
        if (typeof map.latLngToContainerPoint !== 'function' ||
            typeof map.containerPointToLatLng !== 'function' ||
            typeof map.distance !== 'function' || !radiusMeters) return 0;
        var pt = map.latLngToContainerPoint(latlng);
        var mpp = map.distance(latlng, map.containerPointToLatLng([pt.x, pt.y - 1]));
        return mpp > 0 ? radiusMeters / mpp : 0;
    }

    // Fiecare etichetă rămâne centrată pe axa verticală a propriului cerc și
    // lipită de marginea lui de sus. Nu mai alegem o altă latură în funcție de
    // vecini, eliminând astfel salturile vizibile la fiecare nivel de zoom.
    function relayoutLabels() {
        var map = getMap();
        if (!map || typeof map.latLngToLayerPoint !== 'function') return;

        Object.keys(_labelById).forEach(function (id) {
            var rec = _labelById[id];
            var circle = rec.circle;
            var el = rec.el;
            var latlng = (typeof circle.getLatLng === 'function') ? circle.getLatLng() : null;
            if (!latlng) return;

            var w = el.offsetWidth || 0;
            var h = el.offsetHeight || 0;
            if (!w || !h) return; // se reia după încărcarea fonturilor / resize

            var center = map.latLngToLayerPoint(latlng);
            var rMeters = (typeof circle.getRadius === 'function') ? circle.getRadius() : 0;
            var rPx = circlePixelRadius(map, latlng, rMeters);
            var x = center.x - w / 2;
            var y = center.y - rPx - LABEL_GAP - h;

            el.style.transform = 'translate3d(' +
                Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
        });
    }

    // Varianta pentru evenimentul „zoomanim” (zoom animat cu rotița /
    // dublu-click): calculăm poziția FINALĂ a etichetei în coordonatele noului
    // nivel de zoom (Leaflet expune _latLngToNewLayerPoint, la fel ca pentru
    // markere). Clasa .leaflet-zoom-animated de pe etichetă + clasa
    // .leaflet-zoom-anim pusă de Leaflet pe conținător în timpul animației
    // produc tranziția CSS lin spre poziția finală; fără aceasta, etichetele
    // rămâneau înghețate pe durata animației și săreau abia la „zoomend”.
    function relayoutLabelsZoomAnim(e) {
        var map = getMap();
        if (!map || typeof map._latLngToNewLayerPoint !== 'function') return;

        var fromZoom = (typeof map.getZoom === 'function') ? map.getZoom() : e.zoom;
        var scale = (typeof map.getZoomScale === 'function')
            ? map.getZoomScale(e.zoom, fromZoom)
            : Math.pow(2, e.zoom - fromZoom);

        Object.keys(_labelById).forEach(function (id) {
            var rec = _labelById[id];
            var circle = rec.circle;
            var el = rec.el;
            var latlng = (typeof circle.getLatLng === 'function') ? circle.getLatLng() : null;
            if (!latlng) return;

            var w = el.offsetWidth || 0;
            var h = el.offsetHeight || 0;
            if (!w || !h) return;

            var center = map._latLngToNewLayerPoint(latlng, e.zoom, e.center);
            var rMeters = (typeof circle.getRadius === 'function') ? circle.getRadius() : 0;
            // raza în pixeli la noul nivel de zoom = raza curentă × factorul de zoom
            var rPx = circlePixelRadius(map, latlng, rMeters) * scale;
            var x = center.x - w / 2;
            var y = center.y - rPx - LABEL_GAP - h;

            el.style.transform = 'translate3d(' +
                Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
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
        var pm = popupMetrics();   // plafoanele ferestrei de informații, pe ecranul curent

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
            // Popup COMPACT: lățime/înălțime plafonate din JS (maxWidth /
            // maxHeight) și din CSS (vezi .battles-popup în styles.css, unde
            // plafoanele scad pe ecrane mici). Descrierea lungă este strânsă
            // implicit în câteva rânduri → fereastra nu mai acoperă ecranul.
            circle.bindPopup(buildPopupContent(ev), {
                maxWidth: pm.maxW,
                minWidth: pm.minW,
                maxHeight: pm.maxH,
                className: 'battles-popup',
                autoPan: true,
                autoPanPadding: [16, 16],
                keepInView: true,
                closeButton: true
            });

            // La deschidere verificăm dacă descrierea chiar depășește rândurile
            // strânse; dacă nu, butonul „Detalii” dispare și textul rămâne întreg.
            if (circle.on) {
                circle.on('popupopen', function (e) {
                    var p = (e && e.popup) || (circle.getPopup && circle.getPopup());
                    var el = p && p.getElement ? p.getElement() : null;
                    if (el) fitDescToggle(el);
                });
            }

            // Eticheta permanentă — centrată mereu deasupra marginii de sus
            // a cercului (poziția e calculată în relayoutLabels).
            var txt = ev[mapL] || ev.ro;
            circle._labelText = txt.titlu; // expus pentru teste
            var el = document.createElement('div');
            // „leaflet-zoom-animated”: tranziția CSS de zoom (activă doar pe
            // durata .leaflet-zoom-anim) mișcă liniar eticheta la schimbarea
            // transform-ului din handlerul „zoomanim”, ca la markere.
            el.className = 'battles-label leaflet-zoom-animated';
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
            // Popup deschis? Re-evaluăm strângerea descrierii pe noul text.
            var pop = c.getPopup ? c.getPopup() : null;
            if (pop && pop.isOpen && pop.isOpen() && pop.getElement) {
                var popEl = pop.getElement();
                if (popEl) fitDescToggle(popEl);
            }
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

    // API-ul popup-ului: butonul „Detalii / Ascunde” din descriere este HTML
    // generat (inserat de Leaflet în DOM), deci apelează direct această funcție.
    window.DetectLabBattlesPopup = {
        toggleDesc: toggleDesc,
        metrics: popupMetrics
    };

    // Descriptor pentru oglinda verticală de pe hartă (vertical-opacity-control.js):
    // sliderul de perioadă al straturilor „Bătălii” se comportă ca sliderele de
    // opacitate ale celorlalte straturi, dar afișează secole în loc de procente.
    window.DetectLabBattlesPeriod = {
        format: function (val) { return centuryLabel(parseInt(val, 10)); },
        caption: function () {
            var t = T();
            var raw = (t && t.battles_period_label) ? t.battles_period_label : null;
            if (!raw) raw = (lang() === 'ro') ? 'Perioadă' : 'Period';
            return String(raw).toUpperCase();
        }
    };

    // Sincronizare inițială a etichetei de secol + evenimentele sliderului
    function initPanel() {
        updatePanel();
        hookPeriodSlider();
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initPanel();
    } else {
        document.addEventListener('DOMContentLoaded', initPanel);
    }
})();
