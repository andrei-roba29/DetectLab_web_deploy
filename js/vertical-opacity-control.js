/* ============================================================
   DetectLab — selected-layer vertical opacity control
   Mirrors every layer opacity range from the side panel into a
   compact vertical control over the right side of the map.
   ============================================================ */
(function () {
    'use strict';

    /* Fallback names are also used by entries (notably LIDAR) whose title is
       not translated through a data-key. Whenever a translated layer title is
       present in the row, the live DOM text takes precedence. */
    var LAYER_NAMES = {
        apmOpacitySlider: 'APM Layer',
        apm20OpacitySlider: 'APM 2.0',
        satOpacitySlider: 'Satellite',
        osmPlacesOpacitySlider: 'OSM Places',
        uatOpacitySlider: 'UAT',
        patrimoniuOpacitySlider: 'Heritage Sites',
        iosfreeOpacitySlider: 'Harta Iosefină',
        austrianMapOpacitySlider: 'Austrian Map 1910',
        firingPlansOpacitySlider: 'Planuri de Tragere',
        sovietMapOpacitySlider: 'Harta Sovietică 1970',
        lidarHdOpacitySlider: 'HD · Hunedoara',
        lidarArOpacitySlider: 'AR · Arad',
        lidarAbOpacitySlider: 'AB · Alba',
        lidarBhOpacitySlider: 'BH · Bihor',
        lidarCsOpacitySlider: 'CS · Caraș-Severin',
        lidarRo2mOpacitySlider: 'Romania 2–5 m/pixel',
        lidarRo1mOpacitySlider: 'Romania 1 m/pixel',
        lidarCs917OpacitySlider: 'CS · LAKI III',
        lidarDj917OpacitySlider: 'DJ · LAKI III',
        lidarGj917OpacitySlider: 'GJ · LAKI III',
        lidarMh917OpacitySlider: 'MH · LAKI III',
        romanOpacitySlider: 'Roman Empire',
        josephineOpacitySlider: 'Josephine Map +',
        bucovinaMapOpacitySlider: 'Bucovina 1861–1864',
        austrohuMapOpacitySlider: 'Austro-Hungarian Map',
        moldova1868MapOpacitySlider: 'Moldova 1868',
        moldovaWwiiMapOpacitySlider: 'Moldova WWII',
        polishTactical1933MapOpacitySlider: 'Tactical Polish Map 1933',
        ww1MapOpacitySlider: 'WWI',
        ww2MapOpacitySlider: 'WWII',
        moldova1771MapOpacitySlider: 'Moldova 1771',
        banatMapOpacitySlider: 'Banat 1769–1772',
        satellite60sMapOpacitySlider: "Satellite imagery 60's",
        battlesPeriodSlider: 'Battles / Bătălii',
        satPeriodSlider: 'Satellite',
        lidarScannerDistance: 'LIDAR Scanner',
        archeoPotDistance: 'Archeological Potential Sites',
        archReportDistance: 'Archeological Report'
    };

    /* ── OGLINZI DE DISTANȚĂ / RAZĂ + DOCK DE ACȚIUNE ──
       Straturile de analiză (LIDAR Scanner, Zone cu potențial arheologic,
       Raport arheologic) au un slider de distanță/rază în panou. Când stratul
       e apăsat — clic pe rând sau comutatorul pornit — sliderul e oglindit
       vertical pe hartă exact ca opacitatea, iar butonul de acțiune al
       stratului (Scan / Detectează / Generează raport) e mutat în dock-ul
       centrat în partea de jos a ecranului principal. Înregistrarea e pe id
       (nu după șablonul „Opacity”), ca unitatea, eticheta și acțiunile să
       poată fi specifice fiecărui strat. */
    var DISTANCE_SOURCES = [
        { id: 'lidarScannerDistance', toggle: 'lidarScannerToggle', actions: ['lidarScannerRun'], caption: 'distance' },
        { id: 'archeoPotDistance', toggle: 'archeoPotToggle', actions: ['archeoPotRunBtn'], caption: 'radius' },
        { id: 'archReportDistance', toggle: 'archReportToggle', actions: ['archReportRunBtn'], caption: 'radius' }
    ];

    function distanceDef(sliderId) {
        for (var i = 0; i < DISTANCE_SOURCES.length; i++) {
            if (DISTANCE_SOURCES[i].id === sliderId) return DISTANCE_SOURCES[i];
        }
        return null;
    }

    function isDistanceId(sliderId) {
        return !!distanceDef(sliderId);
    }

    /* The Satellite layer owns TWO ranges: its opacity and the „Istoric”
       period selector (2016 / 2025 — the 2018 orthophoto was dropped from
       the base layer). Selecting either one shows both vertical mirrors on the
       map at the same time — each permanently bound to its own panel slider. */
    var SATELLITE_PAIR_IDS = ['satOpacitySlider', 'satPeriodSlider'];
    /* Only a last-resort fallback for when the panel ticks are not in the DOM
       (unit tests / pre-render). The live ticks win, so the mirror follows
       whatever stop list the panel actually ships. */
    var SAT_PERIOD_LABELS_FALLBACK = ['2016', '2025'];

    function isSatellitePairId(id) {
        return SATELLITE_PAIR_IDS.indexOf(id) !== -1;
    }

    function satPeriodTickLabel(idx) {
        var ticks = document.querySelectorAll('#satPeriodTicks span');
        if (!ticks || !ticks[idx]) return '';
        return String(ticks[idx].textContent || '').replace(/\s+/g, ' ').trim();
    }

    function satPeriodLastTickLabel() {
        /* „2025” follows the translated last tick of the panel slider. */
        var tick = document.querySelector('#satPeriodTicks span:last-child');
        return tick ? String(tick.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    function satPeriodLabel(value) {
        var ticks = document.querySelectorAll('#satPeriodTicks span');
        var lastIdx = (ticks && ticks.length ? ticks.length : SAT_PERIOD_LABELS_FALLBACK.length) - 1;
        if (lastIdx < 0) lastIdx = 0;
        var idx = Math.round(Number(value));
        if (!isFinite(idx)) idx = lastIdx;
        idx = Math.max(0, Math.min(lastIdx, idx));
        if (idx === lastIdx) {
            var present = satPeriodLastTickLabel();
            if (present) return present;
        }
        return satPeriodTickLabel(idx) || SAT_PERIOD_LABELS_FALLBACK[idx] || String(value);
    }

    var control;
    var verticalSlider;
    var valueOutput;
    var layerLabel;
    var captionEl;
    var closeButton;
    var periodControl;
    var periodSlider;
    var periodOutput;
    var periodCaptionEl;
    var periodLayerLabel;
    var actionsEl = null;
    var activeSource = null;
    var activeOwner = null;
    var activeFormatter = percentageText;
    var syncTimer = null;
    var periodTipTimer = null;
    var periodTipPinned = false;
    var PERIOD_THUMB_SIZE = 20;
    var PERIOD_TIP_HIDE_DELAY = 900;

    /* Acțiuni rapide ancorate sub sliderul vertical: butonul „Ajutor de
       căutare” (APM 2.0) și cele trei butoane Iosefină Premium (căutare
       clădiri dispărute / setări / sugerează). Fiecare apare ca iconiță
       minimalistă (același design ca restul iconițelor de pe hartă),
       fără text, doar cât timp stratul său e selectat în oglinda
       verticală — eticheta devine bulă de informații la hover / focus / tap.
       Cheia e id-ul slider-ului de opacitate din panoul lateral. */
    var LAYER_ACTION_MAP = {
        apm20OpacitySlider: ['apm20SearchHelpBtn'],
        josephineOpacitySlider: ['iosBldSearchHelpBtn', 'iosBldSettingsBtn', 'iosBldSuggestBtn']
    };
    var actionHome = {};
    var tipTimers = {};
    var TIP_TAP_MS = 2500;

    function managedActionIds() {
        var ids = [];
        var keys = Object.keys(LAYER_ACTION_MAP);
        for (var i = 0; i < keys.length; i++) {
            var list = LAYER_ACTION_MAP[keys[i]];
            for (var j = 0; j < list.length; j++) {
                if (ids.indexOf(list[j]) === -1) ids.push(list[j]);
            }
        }
        return ids;
    }

    function refreshLayerActionVisibility() {
        if (typeof window === 'undefined') return;
        try {
            if (typeof window._refreshApm20SearchHelpBtnVisibility === 'function') {
                window._refreshApm20SearchHelpBtnVisibility();
            }
        } catch (e) { /* map module not initialised yet */ }
        try {
            if (typeof window._refreshIosBldBtnVisibility === 'function') {
                window._refreshIosBldBtnVisibility();
            }
        } catch (e) { /* map module not initialised yet */ }
    }

    function syncActionAriaLabels() {
        var ids = managedActionIds();
        for (var i = 0; i < ids.length; i++) {
            var btn = document.getElementById(ids[i]);
            if (!btn || !btn.querySelector) continue;
            var tip = btn.querySelector('.vo-action-tip');
            if (!tip) continue;
            var txt = compactText(tip.textContent);
            if (txt && typeof btn.setAttribute === 'function') {
                btn.setAttribute('aria-label', txt);
            }
        }
    }

    /* Mută butoanele stratului activ în #verticalOpacityActions (sub slider) și
       le readuce pe celelalte la locul lor din .map-wrapper. Ordinea din
       LAYER_ACTION_MAP e păstrată la fiecare sincronizare. */
    function syncLayerActions() {
        if (!control) return;
        if (!actionsEl) {
            try { actionsEl = document.getElementById('verticalOpacityActions'); } catch (e) { actionsEl = null; }
        }
        var activeId = activeSource ? activeSource.id : null;
        var wanted = (activeId && LAYER_ACTION_MAP[activeId]) ? LAYER_ACTION_MAP[activeId] : [];
        var wantedSet = {};
        for (var w = 0; w < wanted.length; w++) wantedSet[wanted[w]] = true;
        var controlVisible = false;
        try { controlVisible = control.classList.contains('visible'); } catch (e) { controlVisible = false; }

        var ids = managedActionIds();
        for (var i = 0; i < ids.length; i++) {
            var btn = null;
            try { btn = document.getElementById(ids[i]); } catch (e) { btn = null; }
            if (!btn) continue;
            if (!actionHome[ids[i]]) {
                actionHome[ids[i]] = { parent: btn.parentElement, next: btn.nextSibling };
            }
            var shouldDock = !!wantedSet[ids[i]] && controlVisible && !!actionsEl;
            if (shouldDock) {
                if (btn.parentElement !== actionsEl) {
                    try { actionsEl.appendChild(btn); } catch (e) { /* DOM-only tests */ }
                }
                if (btn.classList) btn.classList.add('vo-docked');
            } else {
                var home = actionHome[ids[i]];
                if (home && home.parent && btn.parentElement !== home.parent) {
                    try {
                        if (home.next && home.next.parentElement === home.parent) {
                            home.parent.insertBefore(btn, home.next);
                        } else {
                            home.parent.appendChild(btn);
                        }
                    } catch (e) { /* DOM-only tests */ }
                }
                if (btn.classList) btn.classList.remove('vo-docked', 'show-tip');
            }
        }
        /* Păstrează ordinea declarată a iconițelor sub slider. */
        if (actionsEl) {
            for (var k = 0; k < wanted.length; k++) {
                var docked = null;
                try { docked = document.getElementById(wanted[k]); } catch (e) { docked = null; }
                if (docked && docked.parentElement === actionsEl) {
                    try { actionsEl.appendChild(docked); } catch (e) { /* DOM-only tests */ }
                }
            }
        }
        /* Panoul „Setări detecție” se ancorează în stânga sliderului cât timp
           stratul Josephine Map + e selectat (vezi body.vo-josephine-docked);
           când ancora dispare (alt strat / oglindă închisă), panoul se închide
           ca să nu rămână orfan bottom-center. */
        var josephineDocked = activeId === 'josephineOpacitySlider' && controlVisible;
        try {
            if (document.body && document.body.classList) {
                document.body.classList.toggle('vo-josephine-docked', josephineDocked);
            }
        } catch (e) { /* DOM-only tests */ }
        if (!josephineDocked) {
            try {
                var settingsPanel = document.getElementById('iosBldSettingsPanel');
                if (settingsPanel && settingsPanel.classList) settingsPanel.classList.remove('open');
            } catch (e) { /* DOM-only tests */ }
        }
        /* map-app.js arată/ascunde iconițele în funcție de strat + zoom + oglinda activă. */
        refreshLayerActionVisibility();
        syncActionAriaLabels();
    }

    /* ── dock-ul centrat jos: butonul de acțiune al stratului de analiză ──
       Butonul e mutat fizic (nu clonat), deci își păstrează id-ul,
       listener-ele, starea disabled și spinner-ul; la dezactivare se întoarce
       exact în rândul lui din panou. Alături rămâne o etichetă cu raza curentă,
       sincronizată cu oglinda verticală și cu sliderul din panou. */
    var dock = null;
    var dockInner = null;
    var dockRadius = null;
    var dockActionHome = {};

    function ensureDock() {
        if (!dock) { try { dock = document.getElementById('layerActionDock'); } catch (e) { dock = null; } }
        if (!dockInner) { try { dockInner = document.getElementById('layerActionDockInner'); } catch (e) { dockInner = null; } }
        return !!(dock && dockInner);
    }

    function ensureDockRadius() {
        if (dockRadius || !dockInner) return null;
        dockRadius = document.createElement('span');
        dockRadius.className = 'layer-action-dock-radius';
        if (typeof dockInner.insertBefore === 'function' && dockInner.firstChild) {
            dockInner.insertBefore(dockRadius, dockInner.firstChild);
        } else {
            dockInner.appendChild(dockRadius);
        }
        return dockRadius;
    }

    function updateDockRadius() {
        if (!dockRadius || !activeSource || !isDistanceId(activeSource.id)) return;
        dockRadius.textContent = distanceText(activeSource.value);
    }

    function syncDistanceDock() {
        if (!ensureDock()) return;
        var activeId = activeSource ? activeSource.id : null;
        var def = activeId ? distanceDef(activeId) : null;
        var controlVisible = false;
        try { controlVisible = control.classList.contains('visible'); } catch (e) { controlVisible = false; }
        var visible = !!def && controlVisible;
        var wanted = visible ? def.actions : [];

        var hasVisibleAction = false;
        for (var i = 0; i < DISTANCE_SOURCES.length; i++) {
            var actions = DISTANCE_SOURCES[i].actions;
            for (var j = 0; j < actions.length; j++) {
                var id = actions[j];
                var btn = null;
                try { btn = document.getElementById(id); } catch (e) { btn = null; }
                if (!btn) continue;
                if (!dockActionHome[id]) {
                    dockActionHome[id] = { parent: btn.parentElement, next: btn.nextSibling };
                }
                if (wanted.indexOf(id) !== -1) {
                    if (btn.parentElement !== dockInner) {
                        try { dockInner.appendChild(btn); } catch (e) { /* DOM-only tests */ }
                    }
                    if (btn.classList) btn.classList.add('la-docked');
                    var isHidden = false;
                    if (btn.style && btn.style.display === 'none') isHidden = true;
                    if (btn.classList && typeof btn.classList.contains === 'function' && btn.classList.contains('is-hidden')) isHidden = true;
                    if (!isHidden) hasVisibleAction = true;
                } else {
                    var home = dockActionHome[id];
                    if (home && home.parent && btn.parentElement !== home.parent) {
                        try {
                            if (home.next && home.next.parentElement === home.parent &&
                                typeof home.parent.insertBefore === 'function') {
                                home.parent.insertBefore(btn, home.next);
                            } else {
                                home.parent.appendChild(btn);
                            }
                        } catch (e) {
                            try { home.parent.appendChild(btn); } catch (e2) { /* DOM-only tests */ }
                        }
                    }
                    if (btn.classList) btn.classList.remove('la-docked');
                }
            }
        }

        var showDock = visible && hasVisibleAction;

        if (showDock) {
            ensureDockRadius();
            updateDockRadius();
        } else if (dockRadius && dockRadius.parentElement) {
            try { dockRadius.parentElement.removeChild(dockRadius); } catch (e) { /* DOM-only tests */ }
            dockRadius = null;
        }

        if (dock.classList) dock.classList.toggle('visible', showDock);
        if (dock.setAttribute) dock.setAttribute('aria-hidden', showDock ? 'false' : 'true');
        // Ridică stack-ul de controale plutitoare centrate jos (ajutor APM20,
        // hint-uri de zoom) cât timp dock-ul e vizibil, ca să nu se suprapună.
        try {
            if (document.body && document.body.classList) {
                document.body.classList.toggle('layer-dock-open', showDock);
            }
        } catch (e) { /* DOM-only tests */ }
    }

    function isVerticalActiveFor(sliderId) {
        try {
            return !!(activeSource && activeSource.id === sliderId && control && control.classList.contains('visible'));
        } catch (e) {
            return false;
        }
    }

    function compactText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    /* Numele stratului e scris vertical (de jos în sus) pe laterala stângă a
       casetei de sticlă: maximum 15 caractere, iar restul devine „…”. Numele
       complet rămâne în atributul title al etichetei. */
    var LAYER_TITLE_MAX_CHARS = 15;

    function layerTitleText(name) {
        var text = compactText(name);
        if (text.length > LAYER_TITLE_MAX_CHARS) {
            return text.slice(0, LAYER_TITLE_MAX_CHARS) + '\u2026';
        }
        return text;
    }

    function getLayerName(source, owner) {
        /* A translated layer title is preferred, but never mistake the shared
           "Opacity" translation for the layer's actual name. */
        var translated = owner.querySelectorAll('[data-key^="layer_"]');
        for (var i = 0; i < translated.length; i++) {
            var key = translated[i].getAttribute('data-key') || '';
            if (key !== 'layer_opacity' && key !== 'layer_opacity_label') {
                var translatedText = compactText(translated[i].textContent);
                if (translatedText) return translatedText;
            }
        }

        return LAYER_NAMES[source.id] || source.getAttribute('aria-label') || 'Layer';
    }

    function percentageText(value) {
        var number = Number(value);
        if (!isFinite(number)) return String(value) + '%';
        return (Math.round(number * 100) / 100) + '%';
    }

    /* The Battles layer mirrors a period (century) range, not an opacity one.
       Its value formatter and caption come from battles-layer.js
       (window.DetectLabBattlesPeriod); percentage formatting stays the default
       for every other range. */
    function distanceText(value) {
        var number = Number(value);
        if (!isFinite(number)) return String(value) + ' km';
        return number + ' km';
    }

    function sourceFormatter(source) {
        if (isDistanceId(source.id)) return distanceText;
        if (source.id === 'battlesPeriodSlider') {
            if (window.DetectLabBattlesPeriod && typeof window.DetectLabBattlesPeriod.format === 'function') {
                return window.DetectLabBattlesPeriod.format;
            }
            return function (value) { return String(value); };
        }
        if (source.id === 'satPeriodSlider') {
            return satPeriodLabel;
        }
        return percentageText;
    }

    function sourceCaption(source) {
        if (isDistanceId(source.id)) {
            var def = distanceDef(source.id);
            var en = (window._currentLang && window._currentLang() === 'en');
            if (def && def.caption === 'radius') return en ? 'RADIUS' : 'RAZĂ';
            return en ? 'DISTANCE' : 'DISTANȚĂ';
        }
        if (source.id === 'battlesPeriodSlider') {
            if (window.DetectLabBattlesPeriod && typeof window.DetectLabBattlesPeriod.caption === 'function') {
                return window.DetectLabBattlesPeriod.caption();
            }
            return 'PERIOD';
        }
        if (source.id === 'satPeriodSlider') {
            return (window._currentLang && window._currentLang() === 'en') ? 'HISTORIC' : 'ISTORIC';
        }
        /* Plain opacity ranges carry NO caption: the word "OPACITY" used to sit
           above the map-side slider and only pushed the layer name down. The
           label stays empty (and is hidden by CSS), while the accessible name
           of the range still says what it controls. */
        return '';
    }

    function sourceKind(source) {
        if (isDistanceId(source.id)) return 'distance';
        if (source.id === 'battlesPeriodSlider') return 'period';
        if (source.id === 'satPeriodSlider') return 'satperiod';
        return 'opacity';
    }

    function positionPeriodTip() {
        if (!activeSource || sourceKind(activeSource) !== 'period' || !verticalSlider || !valueOutput) return;
        var min = Number(verticalSlider.min);
        var max = Number(verticalSlider.max);
        var value = Number(verticalSlider.value);
        if (!isFinite(min) || !isFinite(max) || !isFinite(value) || max <= min) return;

        var wrap = verticalSlider.parentElement;
        if (!wrap) return;
        var sliderLength = verticalSlider.offsetWidth || 0;
        if (!sliderLength && typeof verticalSlider.getBoundingClientRect === 'function') {
            sliderLength = verticalSlider.getBoundingClientRect().height || 0;
        }
        if (!sliderLength) return; // no layout (e.g. DOM-only integration tests)

        var fraction = Math.max(0, Math.min(1, (value - min) / (max - min)));
        var travel = Math.max(0, sliderLength - PERIOD_THUMB_SIZE);
        var centre = (wrap.offsetTop || 0) + (wrap.offsetHeight || 0) / 2;
        var y = centre + (0.5 - fraction) * travel; // rotated range: max is at the top
        var tipHalf = (valueOutput.offsetHeight || 0) / 2;
        var controlHeight = control.clientHeight || control.offsetHeight || 0;
        if (controlHeight && tipHalf) y = Math.max(tipHalf + 4, Math.min(controlHeight - tipHalf - 4, y));
        valueOutput.style.top = Math.round(y) + 'px';
    }

    function showPeriodTip() {
        if (!activeSource || sourceKind(activeSource) !== 'period') return;
        if (periodTipTimer !== null) {
            window.clearTimeout(periodTipTimer);
            periodTipTimer = null;
        }
        positionPeriodTip();
        valueOutput.classList.add('visible');
    }

    function hidePeriodTip(delay) {
        if (!activeSource || sourceKind(activeSource) !== 'period') {
            if (valueOutput) valueOutput.classList.remove('visible');
            return;
        }
        if (periodTipTimer !== null) window.clearTimeout(periodTipTimer);
        periodTipTimer = window.setTimeout(function () {
            periodTipTimer = null;
            if (valueOutput) valueOutput.classList.remove('visible');
        }, delay || 0);
    }

    function resetPeriodTip() {
        if (periodTipTimer !== null) {
            window.clearTimeout(periodTipTimer);
            periodTipTimer = null;
        }
        if (valueTipTimer !== null) {
            window.clearTimeout(valueTipTimer);
            valueTipTimer = null;
        }
        periodTipPinned = false;
        if (valueOutput) {
            valueOutput.classList.remove('visible');
            valueOutput.style.top = '';
        }
    }

    /* ── PERCENTAGE ONLY WHILE CHANGING (opacity mirrors) ──
       The opacity mirror's value chip is hidden by default and lights up only
       while the user is actually changing the opacity (drag / keyboard / the
       panel slider), fading away shortly after the last change. Distance and
       ISTORIC mirrors keep their chips permanently visible (not percentages). */
    var VALUE_TIP_HIDE_DELAY = 1100;
    var valueTipTimer = null;

    function showValueTip() {
        if (valueTipTimer !== null) {
            window.clearTimeout(valueTipTimer);
            valueTipTimer = null;
        }
        if (valueOutput) valueOutput.classList.add('visible');
    }

    function hideValueTip(delay) {
        if (valueTipTimer !== null) window.clearTimeout(valueTipTimer);
        valueTipTimer = window.setTimeout(function () {
            valueTipTimer = null;
            if (valueOutput) valueOutput.classList.remove('visible');
        }, typeof delay === 'number' ? delay : VALUE_TIP_HIDE_DELAY);
    }

    function opacityTipShow() {
        if (activeSource && sourceKind(activeSource) === 'opacity') showValueTip();
    }

    function opacityTipHide(delay) {
        if (activeSource && sourceKind(activeSource) === 'opacity') hideValueTip(delay);
    }

    function syncFromSource() {
        if (!activeSource || !verticalSlider) return;
        if (String(verticalSlider.value) !== String(activeSource.value)) {
            verticalSlider.value = activeSource.value;
        }
        valueOutput.textContent = activeFormatter(activeSource.value);
        verticalSlider.setAttribute('aria-valuetext', valueOutput.textContent);
        updateDockRadius();
        if (valueOutput.classList.contains('visible')) positionPeriodTip();
    }

    function startProgrammaticSync() {
        if (syncTimer !== null) window.clearInterval(syncTimer);
        /* Some existing layer toggles restore a range by assigning .value
           directly (without an input event). This light poll keeps the mirror
           correct for those programmatic updates as well. */
        syncTimer = window.setInterval(function () {
            syncFromSource();
            if (pairActive) syncPeriodFromSource();
        }, 250);
    }

    function closeLayerPanel() {
        var panel = document.getElementById('transpPanel');
        var tab = document.getElementById('transpTab');
        if (panel && panel.classList.contains('open') && tab) {
            /* Go through the existing button so map-app.js's private open-state
               flag and arrow direction stay in sync. */
            tab.click();
        }
    }

    var pairActive = false;

    function updatePeriodOutput() {
        if (!periodSlider || !periodOutput) return;
        periodOutput.textContent = satPeriodLabel(periodSlider.value);
        periodSlider.setAttribute('aria-valuetext', periodOutput.textContent);
    }

    function syncPeriodFromSource() {
        var periodSource = document.getElementById('satPeriodSlider');
        if (!periodSource || !periodSlider) return;
        /* Follow the panel range's own geometry, so a stop list that shrinks
           (2016 / 2025 after the 2018 orthophoto was dropped) can never
           leave the mirror pointing at a period the panel cannot reach. */
        if (periodSource.max && periodSlider.max !== periodSource.max) periodSlider.max = periodSource.max;
        if (periodSource.min && periodSlider.min !== periodSource.min) periodSlider.min = periodSource.min;
        if (periodSource.step && periodSlider.step !== periodSource.step) periodSlider.step = periodSource.step;
        if (String(periodSlider.value) !== String(periodSource.value)) {
            periodSlider.value = periodSource.value;
        }
        updatePeriodOutput();
    }

    function hideSatellitePair() {
        pairActive = false;
        if (periodControl) {
            periodControl.classList.remove('visible', 'pair-shown');
            periodControl.setAttribute('aria-hidden', 'true');
        }
        if (control) control.classList.remove('pair-shown');
    }

    /* Satellite pair: the main control mirrors the Satellite opacity range and
       the second control mirrors the „Istoric” period range. Both stay visible
       together, whichever of the two the user touched. */
    function showSatellitePair(closePanel) {
        var opacitySource = document.getElementById('satOpacitySlider');
        var periodSource = document.getElementById('satPeriodSlider');
        if (!opacitySource || !periodSource || !periodControl || !periodSlider) return false;

        resetPeriodTip();
        if (activeOwner) activeOwner.classList.remove('opacity-layer-selected');

        pairActive = true;
        activeSource = opacitySource;
        activeOwner = opacitySource.parentElement;
        if (activeOwner) activeOwner.classList.add('opacity-layer-selected');

        var name = getLayerName(opacitySource, activeOwner);
        layerLabel.textContent = layerTitleText(name);
        layerLabel.title = name;
        if (captionEl) captionEl.textContent = ''; // no "OPACITY" strip above the mirror
        control.setAttribute('data-kind', 'opacity');

        verticalSlider.min = opacitySource.min || '0';
        verticalSlider.max = opacitySource.max || '100';
        verticalSlider.step = opacitySource.step || '1';
        verticalSlider.value = opacitySource.value;
        verticalSlider.setAttribute('aria-label', name + ' opacity');
        control.setAttribute('aria-label', name + ' opacity');
        activeFormatter = percentageText;

        syncFromSource();
        control.classList.add('visible', 'pair-shown');
        control.setAttribute('aria-hidden', 'false');
        /* The current percentage peeks briefly when the mirror opens, then
           fades — it only stays up while the value is actually changed. */
        showValueTip();
        hideValueTip();

        if (periodLayerLabel) {
            periodLayerLabel.textContent = layerTitleText(name);
            periodLayerLabel.title = name;
        }
        if (periodCaptionEl) periodCaptionEl.textContent = sourceCaption(periodSource);
        syncPeriodFromSource();
        periodControl.classList.add('visible', 'pair-shown');
        periodControl.setAttribute('aria-hidden', 'false');

        startProgrammaticSync();
        if (closePanel) closeLayerPanel();
        syncLayerActions();
        return true;
    }

    function selectSource(source, closePanel) {
        if (!source || !source.parentElement) return;

        /* The Satellite layer shows both of its vertical mirrors at once. */
        if (isSatellitePairId(source.id) && showSatellitePair(closePanel)) return;

        resetPeriodTip();
        hideSatellitePair();
        if (activeOwner) activeOwner.classList.remove('opacity-layer-selected');

        activeSource = source;
        activeOwner = source.parentElement;
        activeOwner.classList.add('opacity-layer-selected');

        var kind = sourceKind(source);
        var name = getLayerName(source, activeOwner);
        layerLabel.textContent = layerTitleText(name);
        layerLabel.title = name;
        if (captionEl) captionEl.textContent = sourceCaption(source);
        control.setAttribute('data-kind', kind);
        control.setAttribute('data-owner', source.id);

        verticalSlider.min = source.min || '0';
        verticalSlider.max = source.max || '100';
        verticalSlider.step = source.step || '1';
        verticalSlider.value = source.value;
        verticalSlider.setAttribute('aria-label', name + ' ' + kind);
        control.setAttribute('aria-label', name + ' ' + kind);
        activeFormatter = sourceFormatter(source);

        syncFromSource();
        control.classList.add('visible');
        control.setAttribute('aria-hidden', 'false');
        /* Opacity only: peek the current percentage when the mirror opens,
           then fade it — it stays up only while the value is changed. */
        if (kind === 'opacity') {
            showValueTip();
            hideValueTip();
        }
        startProgrammaticSync();

        if (closePanel) closeLayerPanel();
        syncLayerActions();
        syncDistanceDock();
    }

    function hideControl() {
        resetPeriodTip();
        hideSatellitePair();
        control.classList.remove('visible');
        control.setAttribute('aria-hidden', 'true');
        if (activeOwner) activeOwner.classList.remove('opacity-layer-selected');
        activeOwner = null;
        activeSource = null;
        if (syncTimer !== null) {
            window.clearInterval(syncTimer);
            syncTimer = null;
        }
        syncLayerActions();
        syncDistanceDock();
    }

    function isInteractiveTarget(target) {
        return !!(target && target.closest && target.closest(
            'input, button, label, a, select, textarea, [role="button"], .heritage-legend-icon, .heritage-legend-tooltip'
        ));
    }

    function registerSource(source) {
        var owner = source.parentElement;
        if (!owner) return;

        owner.classList.add('opacity-layer-selectable');
        owner.setAttribute('tabindex', '0');
        owner.setAttribute('role', 'group');
        owner.setAttribute('aria-label', 'Select ' + getLayerName(source, owner) + ' ' + sourceKind(source) + ' control');

        owner.addEventListener('click', function (event) {
            /* Sliders/toggles retain their normal behaviour. Touching the
               original horizontal range still selects it, but waits for the
               user to close the panel before revealing the map-side mirror. */
            if (isInteractiveTarget(event.target)) {
                if (event.target === source) selectSource(source, false);
                return;
            }
            selectSource(source, true);
        });

        owner.addEventListener('keydown', function (event) {
            if (event.target !== owner) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectSource(source, true);
                verticalSlider.focus();
            }
        });

        source.addEventListener('pointerdown', function () {
            selectSource(source, false);
        });
        source.addEventListener('focus', function () {
            selectSource(source, false);
        });
        source.addEventListener('input', function () {
            if (source === activeSource) { syncFromSource(); opacityTipShow(); }
        });
        source.addEventListener('change', function () {
            if (source === activeSource) { syncFromSource(); opacityTipHide(); }
        });
    }

    /* Înregistrarea unui slider de distanță/rază: aceeași interacțiune ca la
       opacitate (clic pe rând → oglindă + închiderea panoului), plus comutatorul
       stratului, care porneste/oprește și el oglinda. Rândul proprietar e
       `.transp-layer-row` (sliderul de distanță e copil direct al rândului, spre
       deosebire de cele de opacitate, care stau în eticheta rândului). */
    function registerDistanceSource(def) {
        var source = null;
        try { source = document.getElementById(def.id); } catch (e) { source = null; }
        if (!source) return;

        var owner = source.parentElement;
        if (owner && typeof owner.closest === 'function') {
            owner = owner.closest('.transp-layer-row') || owner;
        }
        if (!owner) return;

        if (owner.classList) owner.classList.add('opacity-layer-selectable');
        if (owner.setAttribute) {
            if (!owner.getAttribute('tabindex')) owner.setAttribute('tabindex', '0');
            owner.setAttribute('role', 'group');
            owner.setAttribute('aria-label', 'Select ' + getLayerName(source, owner) + ' distance control');
        }

        owner.addEventListener('click', function (event) {
            if (isInteractiveTarget(event.target)) {
                if (event.target === source) selectSource(source, false);
                return;
            }
            selectSource(source, true);
        });

        owner.addEventListener('keydown', function (event) {
            if (event.target !== owner) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectSource(source, true);
                verticalSlider.focus();
            }
        });

        source.addEventListener('pointerdown', function () { selectSource(source, false); });
        source.addEventListener('focus', function () { selectSource(source, false); });
        source.addEventListener('input', function () {
            if (source === activeSource) syncFromSource();
        });
        source.addEventListener('change', function () {
            if (source === activeSource) syncFromSource();
        });

        // Comutatorul stratului (LIDAR Scanner / pin potențial / raport):
        // pornit → oglinda + dock-ul apar; oprit → se ascund, dacă erau pe el.
        var toggle = null;
        try { toggle = def.toggle ? document.getElementById(def.toggle) : null; } catch (e) { toggle = null; }
        if (toggle && toggle.addEventListener && !toggle.dataset.voDistanceWired) {
            toggle.dataset.voDistanceWired = '1';
            toggle.addEventListener('change', function () {
                if (this.checked) selectSource(source, false);
                else if (activeSource === source) hideControl();
            });
        }
    }

    function emitSourceEvent(type) {
        if (!activeSource) return;
        activeSource.value = verticalSlider.value;
        activeSource.dispatchEvent(new Event(type, { bubbles: true }));
        syncFromSource();
    }

    /* Registration for a range that shares its row with an already registered
       range (the Satellite „Istoric” slider sits in the Satellite card next to
       the opacity slider). It must not add a second row-level click handler —
       only the source-level listeners that reveal and drive the mirror. */
    function registerPairedSource(source) {
        var owner = source.parentElement;
        if (!owner) return;

        owner.classList.add('opacity-layer-selectable');
        if (!owner.getAttribute('tabindex')) {
            owner.setAttribute('tabindex', '0');
            owner.setAttribute('role', 'group');
            owner.setAttribute('aria-label', 'Select ' + getLayerName(source, owner) + ' ' + sourceKind(source) + ' control');
        }

        source.addEventListener('pointerdown', function () {
            selectSource(source, false);
        });
        source.addEventListener('focus', function () {
            selectSource(source, false);
        });
        source.addEventListener('input', function () {
            if (pairActive) syncPeriodFromSource();
        });
        source.addEventListener('change', function () {
            if (pairActive) syncPeriodFromSource();
        });
    }

    function init() {
        control = document.getElementById('verticalOpacityControl');
        verticalSlider = document.getElementById('verticalOpacitySlider');
        valueOutput = document.getElementById('verticalOpacityValue');
        layerLabel = document.getElementById('verticalOpacityLayer');
        captionEl = document.getElementById('verticalOpacityCaption');
        closeButton = document.getElementById('verticalOpacityClose');
        periodControl = document.getElementById('verticalSatPeriodControl');
        periodSlider = document.getElementById('verticalSatPeriodSlider');
        periodOutput = document.getElementById('verticalSatPeriodValue');
        periodCaptionEl = document.getElementById('verticalSatPeriodCaption');
        periodLayerLabel = document.getElementById('verticalSatPeriodLayer');
        if (!control || !verticalSlider || !valueOutput || !layerLabel || !closeButton) return;

        /* Opacity in the id intentionally excludes the LIDAR Scanner distance
           range, which shares the panel's visual .transp-slider class. The
           Battles century range is the one deliberate non-opacity mirror: it
           is registered explicitly and renders century labels, not %. */
        var sources = document.querySelectorAll(
            '#transpPanel input.transp-slider[type="range"][id*="Opacity"],' +
            '#transpPanel input.transp-slider[type="range"]#battlesPeriodSlider'
        );
        for (var i = 0; i < sources.length; i++) registerSource(sources[i]);

        /* The Satellite „Istoric” range shares its row with the opacity range,
           so it gets the paired registration (no duplicate row handlers). */
        var satPeriodSource = document.getElementById('satPeriodSlider');
        if (satPeriodSource) registerPairedSource(satPeriodSource);

        /* Sliderele de distanță/rază ale straturilor de analiză: înregistrate
           explicit (vezi DISTANCE_SOURCES), cu dock de acțiune centrat jos. */
        for (var d = 0; d < DISTANCE_SOURCES.length; d++) registerDistanceSource(DISTANCE_SOURCES[d]);

        verticalSlider.addEventListener('input', function () {
            emitSourceEvent('input');
            if (periodTipPinned || valueOutput.classList.contains('visible')) showPeriodTip();
            opacityTipShow();
        });
        verticalSlider.addEventListener('change', function () {
            emitSourceEvent('change');
            opacityTipHide();
        });

        /* The paired Satellite period mirror drives the panel's „Istoric”
           range, which owns the actual layer switching (setSatPeriod). */
        if (periodSlider && periodControl) {
            periodSlider.addEventListener('input', function () {
                var periodSource = document.getElementById('satPeriodSlider');
                if (!periodSource) return;
                periodSource.value = periodSlider.value;
                periodSource.dispatchEvent(new Event('input', { bubbles: true }));
                updatePeriodOutput();
            });
            periodSlider.addEventListener('change', function () {
                var periodSource = document.getElementById('satPeriodSlider');
                if (!periodSource) return;
                periodSource.value = periodSlider.value;
                periodSource.dispatchEvent(new Event('change', { bubbles: true }));
                updatePeriodOutput();
            });
        }

        // Just like the panel's horizontal Battles range, its map-side mirror
        // reveals the century only while hovered, dragged or keyboard-focused.
        verticalSlider.addEventListener('pointerenter', showPeriodTip);
        verticalSlider.addEventListener('pointerleave', function () {
            /* The opacity chip has its own fade-out timer; pulling it here
               would kill the brief readable moment after a drag ends. */
            if (!activeSource || sourceKind(activeSource) !== 'period') return;
            if (!periodTipPinned) hidePeriodTip(0);
        });
        verticalSlider.addEventListener('pointerdown', function () {
            if (activeSource && sourceKind(activeSource) === 'opacity') showValueTip();
            if (!activeSource || sourceKind(activeSource) !== 'period') return;
            periodTipPinned = true;
            showPeriodTip();
        });
        verticalSlider.addEventListener('pointerup', function () {
            opacityTipHide();
            if (!periodTipPinned) return;
            periodTipPinned = false;
            hidePeriodTip(PERIOD_TIP_HIDE_DELAY);
        });
        verticalSlider.addEventListener('pointercancel', function () {
            if (activeSource && sourceKind(activeSource) === 'opacity') hideValueTip(0);
            if (!activeSource || sourceKind(activeSource) !== 'period') return;
            periodTipPinned = false;
            hidePeriodTip(0);
        });
        verticalSlider.addEventListener('focus', function () {
            showPeriodTip();
            opacityTipShow();
        });
        verticalSlider.addEventListener('blur', function () {
            if (activeSource && sourceKind(activeSource) === 'period') hidePeriodTip(0);
            opacityTipHide(200);
        });
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('resize', function () {
                if (valueOutput.classList.contains('visible')) positionPeriodTip();
            });
        }

        closeButton.addEventListener('click', hideControl);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && control.classList.contains('visible')) {
                hideControl();
            }
        });

        /* Acțiuni rapide sub slider: pe touch, primul tap pe iconiță arată bula
           de informații (clasa .show-tip), iar tap-ul următor declanșează
           acțiunea — comportamentul nativ al butonului nu e blocat. */
        actionsEl = document.getElementById('verticalOpacityActions');
        if (actionsEl && actionsEl.addEventListener) {
            actionsEl.addEventListener('click', function (event) {
                var btn = event.target && event.target.closest
                    ? event.target.closest('button')
                    : null;
                if (!btn || !actionsEl.contains(btn)) return;
                if (btn.classList) btn.classList.add('show-tip');
                var id = btn.id || 'tip';
                if (tipTimers[id]) window.clearTimeout(tipTimers[id]);
                tipTimers[id] = window.setTimeout(function () {
                    tipTimers[id] = null;
                    if (btn.classList) btn.classList.remove('show-tip');
                }, TIP_TAP_MS);
            });
        }

        /* Bilingual mirrors: the layer name, the caption that mirrors still carry
           (PERIOADĂ / ISTORIC) and the formatted value follow the live language.
           Plain opacity mirrors have no caption any more. */
        document.addEventListener('detectlab:langchange', function () {
            syncDistanceDock();
            if (!activeSource || !activeOwner) {
                /* Chiar și fără strat activ, etichetele/aria butoanelor mutate
                   trebuie să urmeze limba curentă. */
                refreshLayerActionVisibility();
                syncActionAriaLabels();
                return;
            }
            var name = getLayerName(activeSource, activeOwner);
            layerLabel.textContent = layerTitleText(name);
            layerLabel.title = name;
            if (captionEl) captionEl.textContent = sourceCaption(activeSource);
            syncFromSource();
            if (pairActive) {
                if (periodLayerLabel) {
                    periodLayerLabel.textContent = layerTitleText(name);
                    periodLayerLabel.title = name;
                }
                var periodSource = document.getElementById('satPeriodSlider');
                if (periodCaptionEl && periodSource) {
                    periodCaptionEl.textContent = sourceCaption(periodSource);
                }
                updatePeriodOutput();
            }
            refreshLayerActionVisibility();
            syncActionAriaLabels();
        });

        /* Small public surface for integration tests and for any map module
           that needs to focus a layer without synthesising a card click. */
        window.DetectLabVerticalOpacity = {
            select: function (sliderId) {
                var source = document.getElementById(sliderId);
                if (source) selectSource(source, false);
            },
            close: hideControl,
            getActiveSliderId: function () {
                return activeSource ? activeSource.id : null;
            },
            /* map-app.js arată iconițele APM 2.0 / Iosefină doar când stratul
               lor e selectat în oglinda verticală vizibilă. */
            isActiveFor: isVerticalActiveFor,
            refreshActions: refreshLayerActionVisibility,
            refreshDock: syncDistanceDock
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
