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
        battlesPeriodSlider: 'Battles / Bătălii'
    };

    var control;
    var verticalSlider;
    var valueOutput;
    var layerLabel;
    var captionEl;
    var closeButton;
    var activeSource = null;
    var activeOwner = null;
    var activeFormatter = percentageText;
    var syncTimer = null;

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
        return percentageText;
    }

    function sourceCaption(source) {
        if (source.id === 'battlesPeriodSlider') {
            if (window.DetectLabBattlesPeriod && typeof window.DetectLabBattlesPeriod.caption === 'function') {
                return window.DetectLabBattlesPeriod.caption();
            }
            return 'PERIOD';
        }
        return 'OPACITY';
    }

    function sourceKind(source) {
        return source.id === 'battlesPeriodSlider' ? 'period' : 'opacity';
    }

    function syncFromSource() {
        if (!activeSource || !verticalSlider) return;
        if (String(verticalSlider.value) !== String(activeSource.value)) {
            verticalSlider.value = activeSource.value;
        }
        valueOutput.textContent = activeFormatter(activeSource.value);
        verticalSlider.setAttribute('aria-valuetext', valueOutput.textContent);
    }

    function startProgrammaticSync() {
        if (syncTimer !== null) window.clearInterval(syncTimer);
        /* Some existing layer toggles restore a range by assigning .value
           directly (without an input event). This light poll keeps the mirror
           correct for those programmatic updates as well. */
        syncTimer = window.setInterval(syncFromSource, 250);
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

    function selectSource(source, closePanel) {
        if (!source || !source.parentElement) return;

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

    function init() {
        control = document.getElementById('verticalOpacityControl');
        verticalSlider = document.getElementById('verticalOpacitySlider');
        valueOutput = document.getElementById('verticalOpacityValue');
        layerLabel = document.getElementById('verticalOpacityLayer');
        captionEl = document.getElementById('verticalOpacityCaption');
        closeButton = document.getElementById('verticalOpacityClose');
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

        verticalSlider.addEventListener('input', function () {
            emitSourceEvent('input');
        });
        verticalSlider.addEventListener('change', function () {
            emitSourceEvent('change');
        });
        closeButton.addEventListener('click', hideControl);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && control.classList.contains('visible')) {
                hideControl();
            }
        });

        /* Bilingual mirrors: the layer name, the caption (OPACITY ↔ PERIOADĂ)
           and the formatted value follow the live language. */
        document.addEventListener('detectlab:langchange', function () {
            if (!activeSource || !activeOwner) return;
            var name = getLayerName(activeSource, activeOwner);
            layerLabel.textContent = name;
            layerLabel.title = name;
            if (captionEl) captionEl.textContent = sourceCaption(activeSource);
            syncFromSource();
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
