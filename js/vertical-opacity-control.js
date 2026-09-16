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
        satPeriodSlider: 'Satellite'
    };

    /* The Satellite layer owns TWO ranges: its opacity and the „Istoric”
       period selector (2016 / Prezent — the 2018 orthophoto was dropped from
       the base layer). Selecting either one shows both vertical mirrors on the
       map at the same time — each permanently bound to its own panel slider. */
    var SATELLITE_PAIR_IDS = ['satOpacitySlider', 'satPeriodSlider'];
    /* Only a last-resort fallback for when the panel ticks are not in the DOM
       (unit tests / pre-render). The live ticks win, so the mirror follows
       whatever stop list the panel actually ships. */
    var SAT_PERIOD_LABELS_FALLBACK = ['2016', 'Prezent'];

    function isSatellitePairId(id) {
        return SATELLITE_PAIR_IDS.indexOf(id) !== -1;
    }

    function satPeriodTickLabel(idx) {
        var ticks = document.querySelectorAll('#satPeriodTicks span');
        if (!ticks || !ticks[idx]) return '';
        return String(ticks[idx].textContent || '').replace(/\s+/g, ' ').trim();
    }

    function satPeriodLastTickLabel() {
        /* „Prezent” follows the translated last tick of the panel slider. */
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
    var activeSource = null;
    var activeOwner = null;
    var activeFormatter = percentageText;
    var syncTimer = null;
    var periodTipTimer = null;
    var periodTipPinned = false;
    var PERIOD_THUMB_SIZE = 20;
    var PERIOD_TIP_HIDE_DELAY = 900;

    function compactText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
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
    function sourceFormatter(source) {
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
        periodTipPinned = false;
        if (valueOutput) {
            valueOutput.classList.remove('visible');
            valueOutput.style.top = '';
        }
    }

    function syncFromSource() {
        if (!activeSource || !verticalSlider) return;
        if (String(verticalSlider.value) !== String(activeSource.value)) {
            verticalSlider.value = activeSource.value;
        }
        valueOutput.textContent = activeFormatter(activeSource.value);
        verticalSlider.setAttribute('aria-valuetext', valueOutput.textContent);
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
           (2016 / Prezent after the 2018 orthophoto was dropped) can never
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
        layerLabel.textContent = name;
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

        if (periodLayerLabel) {
            periodLayerLabel.textContent = name;
            periodLayerLabel.title = name;
        }
        if (periodCaptionEl) periodCaptionEl.textContent = sourceCaption(periodSource);
        syncPeriodFromSource();
        periodControl.classList.add('visible', 'pair-shown');
        periodControl.setAttribute('aria-hidden', 'false');

        startProgrammaticSync();
        if (closePanel) closeLayerPanel();
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
        layerLabel.textContent = name;
        layerLabel.title = name;
        if (captionEl) captionEl.textContent = sourceCaption(source);
        control.setAttribute('data-kind', kind);

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
        startProgrammaticSync();

        if (closePanel) closeLayerPanel();
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
            if (source === activeSource) syncFromSource();
        });
        source.addEventListener('change', function () {
            if (source === activeSource) syncFromSource();
        });
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

        verticalSlider.addEventListener('input', function () {
            emitSourceEvent('input');
            if (periodTipPinned || valueOutput.classList.contains('visible')) showPeriodTip();
        });
        verticalSlider.addEventListener('change', function () {
            emitSourceEvent('change');
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
            if (!periodTipPinned) hidePeriodTip(0);
        });
        verticalSlider.addEventListener('pointerdown', function () {
            if (!activeSource || sourceKind(activeSource) !== 'period') return;
            periodTipPinned = true;
            showPeriodTip();
        });
        verticalSlider.addEventListener('pointerup', function () {
            if (!periodTipPinned) return;
            periodTipPinned = false;
            hidePeriodTip(PERIOD_TIP_HIDE_DELAY);
        });
        verticalSlider.addEventListener('pointercancel', function () {
            periodTipPinned = false;
            hidePeriodTip(0);
        });
        verticalSlider.addEventListener('focus', showPeriodTip);
        verticalSlider.addEventListener('blur', function () { hidePeriodTip(0); });
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

        /* Bilingual mirrors: the layer name, the caption that mirrors still carry
           (PERIOADĂ / ISTORIC) and the formatted value follow the live language.
           Plain opacity mirrors have no caption any more. */
        document.addEventListener('detectlab:langchange', function () {
            if (!activeSource || !activeOwner) return;
            var name = getLayerName(activeSource, activeOwner);
            layerLabel.textContent = name;
            layerLabel.title = name;
            if (captionEl) captionEl.textContent = sourceCaption(activeSource);
            syncFromSource();
            if (pairActive) {
                if (periodLayerLabel) {
                    periodLayerLabel.textContent = name;
                    periodLayerLabel.title = name;
                }
                var periodSource = document.getElementById('satPeriodSlider');
                if (periodCaptionEl && periodSource) {
                    periodCaptionEl.textContent = sourceCaption(periodSource);
                }
                updatePeriodOutput();
            }
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
            }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
