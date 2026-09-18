/* ============================================================
   DetectLab — PWA bottom-band probe (temporary diagnostic)
   ============================================================

   WHY THIS EXISTS
   ---------------
   In the installed PWA (iPhone) an empty, dark navy band appears at the very
   bottom of the screen, directly BELOW the "© Leafleet" tag. The tag is
   `.leaflet-container::after { bottom:4px; right:6px }`, i.e. anchored to the
   bottom edge of the map container — so anything visible under it is outside
   the map container, and the only question that matters is:

       How far down does the page actually own the screen?

   That cannot be answered from a desktop browser and the reporter cannot send
   screenshots, so this module prints the geometry on the device itself and can
   hand the whole readout back in one tap.

   WHAT IT MEASURES
   ----------------
   · `position:fixed; bottom:0` probe  → where the initial containing block
     (ICB) really ends. Every stretched box on the page resolves against this,
     so it is the single most informative number.
   · 100vh / 100dvh / 100svh probes    → which unit WebKit resolves to the
     full physical screen in standalone.
   · innerHeight, visualViewport.height, screen.height, <html>.clientHeight.
   · env(safe-area-inset-*) resolved to px.
   · getBoundingClientRect() of #map-section, .map-frame, .map-wrapper,
     #detectlab-map and of a probe span standing in for the ::after tag.
   · Leaflet's own map.getSize().
   · A verdict line, in Romanian and English, saying which hypothesis the
     numbers support.

   COLOUR-BAND MODE
   ----------------
   Paints each candidate layer a different colour so the reporter can simply
   say what colour the band is — that names the painter in one round trip:

       red      html            (page canvas)
       lime     body
       yellow   #map-section
       cyan     .map-frame
       magenta  .map-wrapper
       orange   #detectlab-map
       navy     none of the above → the pixels are NOT owned by the page
                (iOS paints them with the manifest background_color), which no
                amount of CSS can remove.

   HOW IT IS SWITCHED ON  (nothing is visible otherwise)
   -----------------------------------------------------
   · `?pwaDebug=1`      numbers overlay            (also persists the flag)
   · `?pwaDebug=colors` numbers overlay + colour bands
   · `?pwaDebug=0`      off, and clears the flag
   · FIVE TAPS within 2.5 s on the "© Leafleet" tag toggle it from inside the
     installed app. That path exists because iOS gives an Add-to-Home-Screen
     web app its OWN storage container: localStorage set in Safari is not
     visible to the installed PWA, so a query-string flag alone could never be
     turned on from the device that shows the bug. The gesture adds no element
     and no listener that can affect layout — it only reads pointer
     coordinates against the tag's own rect.

   GATING
   ------
   Off by default. When off this module injects no DOM, no style and registers
   a single passive capture-phase pointer listener used for the tap gesture.
   It must be removed (or left gated) before merge; it changes no layout, no
   offset and no control position in either state.
   ============================================================ */

(function () {
    'use strict';

    var FLAG_KEY = 'dlPwaDebug';
    var TAP_COUNT = 5;
    var TAP_WINDOW_MS = 2500;
    var AUTO_HIDE_MS = 10000;

    /* ── state ────────────────────────────────────────────────────────── */
    var mode = 'off';            // 'off' | 'numbers' | 'colors'
    var overlay = null;
    var pill = null;
    var styleEl = null;
    var probeHost = null;
    var tagProbe = null;
    var refreshTimer = null;
    var hideTimer = null;
    var tapTimes = [];
    var collapsed = false;

    function qs() {
        try { return window.location.search || ''; } catch (e) { return ''; }
    }

    function readFlag() {
        try { return window.localStorage.getItem(FLAG_KEY) || ''; } catch (e) { return ''; }
    }

    function writeFlag(v) {
        try {
            if (v) { window.localStorage.setItem(FLAG_KEY, v); }
            else { window.localStorage.removeItem(FLAG_KEY); }
        } catch (e) { /* private mode / blocked storage — the session still works */ }
    }

    function normalise(v) {
        v = String(v || '').toLowerCase();
        if (v === 'colors' || v === 'color' || v === 'colour' || v === '2') return 'colors';
        if (v === '1' || v === 'on' || v === 'true' || v === 'numbers') return 'numbers';
        return 'off';
    }

    /* ── measurement ──────────────────────────────────────────────────── */
    function px(n) {
        if (n === null || n === undefined || !isFinite(n)) return '—';
        return (Math.round(n * 10) / 10) + '';
    }

    function ensureProbes() {
        if (probeHost) return;
        probeHost = document.createElement('div');
        probeHost.id = 'dlPwaDebugProbes';
        probeHost.setAttribute('aria-hidden', 'true');
        // Off-screen but still laid out, so every unit/env probe resolves for
        // real. Nothing here can affect the page: it is fixed, 1px wide, has no
        // children in flow and is parked outside the viewport.
        probeHost.style.cssText =
            'position:fixed;left:-9999px;top:0;width:1px;height:1px;' +
            'pointer-events:none;opacity:0;z-index:-1;visibility:hidden;';
        var defs = [
            ['fixedBottom0', 'position:fixed;left:-9999px;bottom:0;width:1px;height:1px;'],
            ['vh100', 'position:fixed;left:-9999px;top:0;width:1px;height:100vh;'],
            ['dvh100', 'position:fixed;left:-9999px;top:0;width:1px;height:100dvh;'],
            ['svh100', 'position:fixed;left:-9999px;top:0;width:1px;height:100svh;'],
            ['envTop', 'position:fixed;left:-9999px;top:0;width:1px;height:env(safe-area-inset-top,0px);'],
            ['envBottom', 'position:fixed;left:-9999px;top:0;width:1px;height:env(safe-area-inset-bottom,0px);'],
            ['envLeft', 'position:fixed;left:-9999px;top:0;width:1px;height:env(safe-area-inset-left,0px);'],
            ['envRight', 'position:fixed;left:-9999px;top:0;width:1px;height:env(safe-area-inset-right,0px);']
        ];
        defs.forEach(function (d) {
            var el = document.createElement('div');
            el.setAttribute('data-probe', d[0]);
            el.style.cssText = d[1];
            probeHost.appendChild(el);
        });
        document.documentElement.appendChild(probeHost);
    }

    function probe(name) {
        if (!probeHost) return null;
        return probeHost.querySelector('[data-probe="' + name + '"]');
    }

    function probeRect(name) {
        var el = probe(name);
        return el ? el.getBoundingClientRect() : null;
    }

    function ensureTagProbe() {
        var map = document.getElementById('detectlab-map');
        if (!map) return null;
        if (tagProbe && tagProbe.parentNode === map) return tagProbe;
        tagProbe = document.createElement('span');
        tagProbe.id = 'dlPwaDebugTagProbe';
        // Same anchoring as `.leaflet-container::after` (bottom:4px; right:6px)
        // so its rect reports where the "© Leafleet" tag really sits. Invisible
        // and click-through: it cannot move or block anything.
        tagProbe.style.cssText =
            'position:absolute;bottom:4px;right:6px;width:72px;height:18px;' +
            'pointer-events:none;opacity:0;z-index:1000;';
        map.appendChild(tagProbe);
        return tagProbe;
    }

    function rectOf(sel) {
        var el = typeof sel === 'string' ? document.querySelector(sel) : sel;
        return el ? el.getBoundingClientRect() : null;
    }

    function collect() {
        ensureProbes();
        ensureTagProbe();

        var out = {};
        out.isPwa = !!(document.body && document.body.classList.contains('is-pwa'));
        try {
            out.displayMode = window.matchMedia('(display-mode: standalone)').matches ? 'standalone'
                : window.matchMedia('(display-mode: fullscreen)').matches ? 'fullscreen'
                    : window.matchMedia('(display-mode: browser)').matches ? 'browser' : 'other';
        } catch (e) { out.displayMode = '?'; }
        out.navigatorStandalone = !!window.navigator.standalone;

        out.innerWidth = window.innerWidth;
        out.innerHeight = window.innerHeight;
        out.vvHeight = window.visualViewport ? window.visualViewport.height : null;
        out.vvOffsetTop = window.visualViewport ? window.visualViewport.offsetTop : null;
        out.vvScale = window.visualViewport ? window.visualViewport.scale : null;
        out.screenH = window.screen ? window.screen.height : null;
        out.screenW = window.screen ? window.screen.width : null;
        out.availH = window.screen ? window.screen.availHeight : null;
        out.htmlClientH = document.documentElement.clientHeight;
        out.dpr = window.devicePixelRatio;

        var fb = probeRect('fixedBottom0');
        out.icbBottom = fb ? fb.bottom : null;            // where bottom:0 lands
        var vh = probeRect('vh100');
        out.vh100 = vh ? vh.height : null;
        var dvh = probeRect('dvh100');
        out.dvh100 = dvh ? dvh.height : null;
        var svh = probeRect('svh100');
        out.svh100 = svh ? svh.height : null;

        out.envTop = probeRect('envTop') ? probeRect('envTop').height : null;
        out.envBottom = probeRect('envBottom') ? probeRect('envBottom').height : null;
        out.envLeft = probeRect('envLeft') ? probeRect('envLeft').height : null;
        out.envRight = probeRect('envRight') ? probeRect('envRight').height : null;

        out.section = rectOf('#map-section');
        out.frame = rectOf('#map-section .map-frame');
        out.wrapper = rectOf('#map-section .map-wrapper');
        out.map = rectOf('#detectlab-map');
        out.tag = tagProbe ? tagProbe.getBoundingClientRect() : null;

        var m = window._dlMap || window.map;
        out.leafletSize = (m && typeof m.getSize === 'function') ? m.getSize() : null;

        /* ── derived ── */
        // The physical bottom edge we can reach for, from the two readings that
        // disagree when iOS hands the page a short ICB.
        out.screenRef = Math.max(
            out.vh100 || 0, out.innerHeight || 0, out.icbBottom || 0,
            (out.vvHeight || 0) + (out.vvOffsetTop || 0)
        );
        out.icbShortBy = (out.vh100 !== null && out.icbBottom !== null)
            ? out.vh100 - out.icbBottom : null;
        out.sectionShortBy = (out.section && out.screenRef)
            ? out.screenRef - out.section.bottom : null;
        out.mapShortBy = (out.map && out.screenRef) ? out.screenRef - out.map.bottom : null;

        return out;
    }

    /* ── verdict ──────────────────────────────────────────────────────── */
    function verdict(d) {
        var lines = [];
        var icbShort = d.icbShortBy;
        var mapShort = d.mapShortBy;

        if (icbShort !== null && icbShort > 8) {
            lines.push('ICB SHORT by ' + px(icbShort) + 'px  →  bottom:0 lands ' +
                px(icbShort) + 'px above 100vh.');
            lines.push('Aceasta este cauza: viewport-fit=cover + black-translucent. ' +
                'min-height:100vh pe #map-section închide banda.');
            lines.push('That is the cause. The min-height:100vh floor on ' +
                '#map-section closes the band.');
        } else if (mapShort !== null && mapShort > 8) {
            lines.push('MAP SHORT by ' + px(mapShort) + 'px while the ICB is full ' +
                '→ a layout rule still shortens the chain (H1).');
            lines.push('Harta e mai scurtă decât ecranul deși ICB e întreg — ' +
                'o regulă de layout scurtează lanțul.');
        } else if (mapShort !== null && mapShort <= 8) {
            lines.push('PAGE REACHES THE BOTTOM (gap ' + px(mapShort) + 'px).');
            lines.push('Dacă banda se vede încă, pixelii NU sunt ai paginii: ' +
                'iOS îi pictează cu background_color din manifest (H2). ' +
                'Trece pe modul CULORI ca să confirmi — banda rămâne bleumarin.');
            lines.push('If the band is still visible it is painted by iOS, not by ' +
                'the page (H2). Switch to COLOURS to confirm: it stays navy.');
        } else {
            lines.push('Could not derive a verdict — read the numbers out.');
        }
        return lines;
    }

    /* ── rendering ────────────────────────────────────────────────────── */
    function asText(d) {
        var L = [];
        function row(label, v) { L.push(label + ': ' + v); }
        function rect(label, r) {
            if (!r) { row(label, 'missing'); return; }
            row(label, 'top=' + px(r.top) + ' bottom=' + px(r.bottom) + ' h=' + px(r.height));
        }
        L.push('DetectLab PWA bottom-band probe');
        row('is-pwa', d.isPwa);
        row('display-mode', d.displayMode);
        row('navigator.standalone', d.navigatorStandalone);
        row('devicePixelRatio', d.dpr);
        L.push('');
        row('window.innerHeight', px(d.innerHeight));
        row('window.innerWidth', px(d.innerWidth));
        row('visualViewport.height', px(d.vvHeight));
        row('visualViewport.offsetTop', px(d.vvOffsetTop));
        row('visualViewport.scale', px(d.vvScale));
        row('screen.height', px(d.screenH));
        row('screen.availHeight', px(d.availH));
        row('html.clientHeight', px(d.htmlClientH));
        L.push('');
        row('probe fixed bottom:0 → .bottom', px(d.icbBottom));
        row('probe 100vh', px(d.vh100));
        row('probe 100dvh', px(d.dvh100));
        row('probe 100svh', px(d.svh100));
        row('100vh − ICB bottom', px(d.icbShortBy));
        L.push('');
        row('env(safe-area-inset-top)', px(d.envTop));
        row('env(safe-area-inset-bottom)', px(d.envBottom));
        row('env(safe-area-inset-left)', px(d.envLeft));
        row('env(safe-area-inset-right)', px(d.envRight));
        L.push('');
        rect('#map-section', d.section);
        rect('.map-frame', d.frame);
        rect('.map-wrapper', d.wrapper);
        rect('#detectlab-map (.leaflet-container)', d.map);
        rect('© Leafleet tag probe', d.tag);
        row('Leaflet map.getSize()', d.leafletSize
            ? d.leafletSize.x + '×' + d.leafletSize.y : 'no map');
        L.push('');
        row('screen reference', px(d.screenRef));
        row('map bottom gap', px(d.mapShortBy));
        L.push('');
        L.push('VERDICT');
        verdict(d).forEach(function (s) { L.push('  ' + s); });
        return L.join('\n');
    }

    function buildOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'dlPwaDebugOverlay';
        overlay.style.cssText = [
            'position:fixed',
            'left:6px',
            'right:6px',
            'top:calc(6px + env(safe-area-inset-top,0px))',
            'max-height:70vh',
            'overflow:auto',
            '-webkit-overflow-scrolling:touch',
            'z-index:2147483000',
            'background:rgba(3,8,18,0.96)',
            'color:#8ef58e',
            'border:1px solid #2f6f3f',
            'border-radius:8px',
            'padding:8px 10px',
            'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
            'white-space:pre-wrap',
            'word-break:break-word',
            'pointer-events:auto',
            'text-align:left',
            'direction:ltr'
        ].join(';') + ';';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;';

        function btn(label, fn) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.style.cssText =
                'flex:0 0 auto;padding:6px 10px;border-radius:6px;border:1px solid #4a7;' +
                'background:#0d2b1a;color:#8ef58e;font:600 11px/1 system-ui,sans-serif;' +
                'min-height:32px;';
            b.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                fn();
            });
            bar.appendChild(b);
            return b;
        }

        btn('📋 COPY', function () {
            var txt = asText(collect());
            var done = function () { flash(copyBtn, '✓ COPIAT'); };
            var copyBtn = bar.querySelector('button');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).then(done, function () { selectText(); });
            } else { selectText(); }
            function selectText() {
                try {
                    var ta = document.createElement('textarea');
                    ta.value = txt;
                    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    done();
                } catch (e) { flash(copyBtn, 'selectează textul'); }
            }
        });
        var colorBtn = btn('🎨 CULORI', function () {
            setMode(mode === 'colors' ? 'numbers' : 'colors', true);
        });
        btn('👁 ASCUNDE', function () { collapse(); });
        btn('✕ OPRIRI', function () { setMode('off', true); });

        var pre = document.createElement('div');
        pre.id = 'dlPwaDebugText';
        overlay.appendChild(bar);
        overlay.appendChild(pre);

        var legend = document.createElement('div');
        legend.id = 'dlPwaDebugLegend';
        legend.style.cssText = 'margin-top:6px;display:none;';
        legend.textContent =
            'Banda de jos e: roșu=html · lime=body · galben=#map-section · ' +
            'cyan=.map-frame · magenta=.map-wrapper · portocaliu=#detectlab-map · ' +
            'bleumarin(#060E1E)=NU e a paginii, o pictează iOS.';
        overlay.appendChild(legend);

        document.documentElement.appendChild(overlay);
    }

    function flash(b, msg) {
        if (!b) return;
        var old = b.textContent;
        b.textContent = msg;
        setTimeout(function () { b.textContent = old; }, 1600);
    }

    function buildPill() {
        if (pill) return;
        pill = document.createElement('div');
        pill.id = 'dlPwaDebugPill';
        pill.textContent = 'DBG';
        pill.style.cssText = [
            'position:fixed',
            'left:6px',
            'top:calc(6px + env(safe-area-inset-top,0px))',
            'z-index:2147483000',
            'background:#0d2b1a',
            'color:#8ef58e',
            'border:1px solid #2f6f3f',
            'border-radius:999px',
            'padding:5px 9px',
            'font:600 10px/1 system-ui,sans-serif',
            'pointer-events:auto',
            'display:none'
        ].join(';') + ';';
        pill.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            expand();
        });
        document.documentElement.appendChild(pill);
    }

    function collapse() {
        collapsed = true;
        if (overlay) overlay.style.display = 'none';
        if (pill) pill.style.display = 'block';
        stopRefresh();
    }

    function expand() {
        collapsed = false;
        if (overlay) overlay.style.display = 'block';
        if (pill) pill.style.display = 'none';
        render();
        startRefresh();
        armAutoHide();
    }

    function render() {
        if (!overlay || mode === 'off') return;
        var d = collect();
        var pre = overlay.querySelector('#dlPwaDebugText');
        if (pre) pre.textContent = asText(d);
        var legend = overlay.querySelector('#dlPwaDebugLegend');
        if (legend) legend.style.display = mode === 'colors' ? 'block' : 'none';
    }

    function startRefresh() {
        stopRefresh();
        refreshTimer = setInterval(render, 700);
    }

    function stopRefresh() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }

    function armAutoHide() {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            if (mode !== 'off' && !collapsed) collapse();
        }, AUTO_HIDE_MS);
    }

    /* ── colour bands ─────────────────────────────────────────────────── */
    var COLOR_CSS = [
        'html.dl-pwa-debug-colors { background:#ff0000 !important; }',
        'html.dl-pwa-debug-colors body { background:#00ff00 !important; }',
        'html.dl-pwa-debug-colors #map-section { background:#ffff00 !important; }',
        'html.dl-pwa-debug-colors #map-section .map-frame { background:#00ffff !important; }',
        'html.dl-pwa-debug-colors #map-section .map-wrapper { background:#ff00ff !important; }',
        'html.dl-pwa-debug-colors #detectlab-map { background:#ff8000 !important; }'
    ].join('\n');

    function applyColors(on) {
        if (on && !styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'dlPwaDebugColors';
            styleEl.textContent = COLOR_CSS;
            document.head.appendChild(styleEl);
        }
        document.documentElement.classList.toggle('dl-pwa-debug-colors', !!on);
        if (!on && styleEl && styleEl.parentNode) {
            styleEl.parentNode.removeChild(styleEl);
            styleEl = null;
        }
    }

    /* ── teardown ─────────────────────────────────────────────────────── */
    function teardown() {
        stopRefresh();
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        applyColors(false);
        [overlay, pill, probeHost, tagProbe].forEach(function (el) {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        overlay = pill = probeHost = tagProbe = null;
    }

    function setMode(next, persist) {
        next = normalise(next);
        if (next === mode) {
            if (next !== 'off' && collapsed) expand();
            return;
        }
        mode = next;
        if (persist) writeFlag(mode === 'off' ? '' : mode);

        if (mode === 'off') { teardown(); return; }

        ensureProbes();
        buildOverlay();
        buildPill();
        applyColors(mode === 'colors');
        // Re-measure the map after the probe DOM settles: the probes are fixed
        // and off-screen so they cannot change the layout, but Leaflet should
        // still see a clean frame before we print its size.
        expand();
    }

    /* ── the tap gesture (the only always-on part) ────────────────────── */
    function inTagHotspot(x, y) {
        var r = rectOf('#detectlab-map');
        if (!r) return false;
        return x >= r.right - 84 && x <= r.right + 2 &&
               y >= r.bottom - 28 && y <= r.bottom + 2;
    }

    function onTap(x, y) {
        if (!inTagHotspot(x, y)) { tapTimes = []; return; }
        var now = Date.now();
        tapTimes.push(now);
        tapTimes = tapTimes.filter(function (t) { return now - t <= TAP_WINDOW_MS; });
        if (tapTimes.length < TAP_COUNT) return;
        tapTimes = [];
        // cycle off → numbers → colors → off
        setMode(mode === 'off' ? 'numbers' : (mode === 'numbers' ? 'colors' : 'off'), true);
    }

    function bindGesture() {
        var type = window.PointerEvent ? 'pointerup' : 'touchend';
        window.addEventListener(type, function (e) {
            var t = e.changedTouches && e.changedTouches[0];
            var x = t ? t.clientX : e.clientX;
            var y = t ? t.clientY : e.clientY;
            if (typeof x !== 'number' || typeof y !== 'number') return;
            onTap(x, y);
        }, { capture: true, passive: true });
    }

    /* ── boot ─────────────────────────────────────────────────────────── */
    function boot() {
        bindGesture();

        var m = /[?&]pwaDebug=([^&#]*)/i.exec(qs());
        var initial;
        if (m) {
            initial = normalise(decodeURIComponent(m[1]));
            writeFlag(initial === 'off' ? '' : initial);
        } else {
            initial = normalise(readFlag());
        }
        if (initial === 'off') return;

        // Show it after the map has had its settle passes, so the numbers are
        // the ones the reporter actually lives with — not the pre-layout ones.
        function show() { setMode(initial, false); }
        if (document.readyState === 'complete') { setTimeout(show, 1800); }
        else { window.addEventListener('load', function () { setTimeout(show, 1800); }); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Small handle so the readout can be pulled from the console too.
    window.DetectLabPwaDebug = {
        collect: collect,
        text: function () { return asText(collect()); },
        enable: function (m) { setMode(m || 'numbers', true); },
        colors: function () { setMode('colors', true); },
        disable: function () { setMode('off', true); }
    };
})();
