#!/usr/bin/env node
'use strict';

// Real-browser regression test for the Heritage canvases.
//
// Source-level tests cannot see the pixels: this one boots the real index.html
// in Chromium, turns "Patrimoniu" on with a stubbed layer API, then measures,
// for every animation frame of a real Leaflet zoom animation, how far the
// painted pin is from the geographic position of its site (a divIcon reference
// marker gives the pixel ground truth).
//
// It also asserts the invariant that fixes the residual slide: during a zoom
// animation the canvas transform must be `scale * anchor - newPixelOrigin`,
// where `anchor` is the exact project-space origin of bitmap pixel (0,0) the
// redraw recorded in window._patrimoniuCanvasState.
//
// Requirements: `puppeteer` (and a Chromium build) available to node.  When
// they are not, the test skips instead of failing, mirroring the other browser
// tests in this repository.  Point the loader at an installation with
// PUPPETEER_MODULE_DIR=/path/to/node_modules or PUPPETEER_EXECUTABLE_PATH=...
//
// Usage: node test-patrimoniu-zoom-animation-browser.js

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createRequire } = require('module');

const ROOT = __dirname;
const SITE = { lat: 46.77, lng: 23.60 };          // Cluj-Napoca (isolated)
const OTHER = { lat: 44.4268, lng: 26.1025 };     // Bucharest (>100 km away)

function loadPuppeteer() {
    const dirs = [process.env.PUPPETEER_MODULE_DIR, path.join(ROOT, 'node_modules'), '/home/user/pptr/node_modules'].filter(Boolean);
    for (const dir of dirs) {
        try {
            const req = createRequire(path.join(dir, 'index.js'));
            return { puppeteer: req('puppeteer-core'), chromium: req('@sparticuz/chromium') };
        } catch (e) { /* keep looking */ }
    }
    return null;
}

function contentType(file) {
    if (file.endsWith('.js')) return 'application/javascript';
    if (file.endsWith('.css')) return 'text/css';
    if (file.endsWith('.html')) return 'text/html';
    if (file.endsWith('.json')) return 'application/json';
    if (file.endsWith('.png')) return 'image/png';
    if (file.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}

function serve() {
    const server = http.createServer((req, res) => {
        const rel = decodeURIComponent(req.url.split('?')[0]);
        const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); res.end('nope'); return;
        }
        res.writeHead(200, { 'content-type': contentType(file) });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const FIXTURE = {
    type: 'FeatureCollection',
    features: [SITE, OTHER].map((p, i) => ({
        type: 'Feature', id: 101 + i,
        properties: { NUMESIT: 'TEST SITE ' + (i + 1), CODSIT: 'RAN-' + (i + 1) },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
    }))
};

// Capture the map instance the app builds.
const MAP_HOOK = `
(function(){
  var O = L.Map.prototype.initialize;
  L.Map.prototype.initialize = function (id, opts) {
    window.__testMap = this;
    return O.apply(this, arguments);
  };
})();
`;

const PIXEL_HELPERS = `
window.__blob = function (el, tx, ty) {
  var w = el.width, h = el.height;
  var d = el.getContext('2d').getImageData(0, 0, w, h).data;
  var sx = 0, sy = 0, n = 0;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      if (Math.hypot(x + 0.5 - tx, y + 0.5 - ty) > 14) continue;   // the site's own pin only
      sx += x + 0.5; sy += y + 0.5; n++;
    }
  }
  return n ? { x: sx / n, y: sy / n, n: n } : null;
};
window.__matrix = function (el) {
  var m = window.getComputedStyle(el).transform;
  if (!m || m === 'none') return { a: 1, e: 0, f: 0 };
  var p = m.match(/matrix(3d)?\\(([^)]+)\\)/);
  if (!p) return { a: 1, e: 0, f: 0 };
  var v = p[2].split(',').map(parseFloat);
  return p[1] ? { a: v[0], e: v[12], f: v[13] } : { a: v[0], e: v[4], f: v[5] };
};
window.__markerPos = function () {
  var cr = window.__testMap.getContainer().getBoundingClientRect();
  var rect = window.__refMarker.getElement().getBoundingClientRect();
  return { x: rect.left - cr.left + rect.width / 2, y: rect.top - cr.top + rect.height / 2 };
};
window.__siteCanvas = function () {
  return document.querySelector('.leaflet-map-pane > canvas[style*="z-index: 655"]');
};
window.__siteBitmap = function (c) {
  var map = window.__testMap, canvas = window.__siteCanvas();
  var ll = L.latLng(c.lat, c.lng);
  var topLeft = map.containerPointToLayerPoint([0, 0]);
  var p = map.project(ll, map.getZoom()).subtract(map.getPixelOrigin()).subtract(topLeft);
  var blob = window.__blob(canvas, p.x, p.y);
  return { bitmap: blob ? { x: blob.x, y: blob.y } : null, projectPixel: { x: p.x, y: p.y } };
};
window.__frame = function (bitmap) {
  var map = window.__testMap, canvas = window.__siteCanvas();
  var M = window.__matrix(canvas);
  var marker = window.__markerPos();
  var displayed = { x: M.e + M.a * bitmap.x, y: M.f + M.a * bitmap.y };
  var style = canvas.style.transform || '';
  var t = /translate3d\\(([-0-9.]+)px,\\s*([-0-9.]+)px/.exec(style);
  var sc = /scale\\(([-0-9.]+)\\)/.exec(style);
  var st = window._patrimoniuCanvasState || null;
  var origin1 = map._getNewPixelOrigin(map.getCenter(), map.getZoom());
  return {
    scale: M.a, animated: !!map._animatingZoom,
    displayed: displayed, marker: marker,
    err: Math.hypot(displayed.x - marker.x, displayed.y - marker.y),
    anchor: st && st.anchor ? { x: st.anchor.x, y: st.anchor.y } : null,
    targetOffset: t && sc ? { x: +t[1], y: +t[2] } : null,
    expectedOffset: st && st.anchor && sc ? {
      x: st.anchor.x * +sc[1] - origin1.x,
      y: st.anchor.y * +sc[1] - origin1.y
    } : null
  };
};
`;

(async () => {
    const loaded = loadPuppeteer();
    if (!loaded) {
        console.log('⚠ SKIP: puppeteer/@sparticuz-chromium not installed (set PUPPETEER_MODULE_DIR)');
        process.exit(0);
    }
    const { puppeteer, chromium } = loaded;
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;
    let args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
    let env = Object.assign({}, process.env);
    if (!executablePath) {
        try {
            const mod = chromium.default || chromium;
            executablePath = await mod.executablePath();
            args = args.concat(mod.args || []);
        } catch (e) {
            console.log('⚠ SKIP: no Chromium executable available (' + e.message + ')');
            process.exit(0);
        }
    }
    // Bundled Chromium builds for minimal containers ship their shared
    // libraries in a separate tarball; point the loader at them if they are
    // already unpacked (PUPPETEER_LIB_PATH overrides).
    const libCandidates = [process.env.PUPPETEER_LIB_PATH, '/tmp/dl-al2023-lib/lib', '/tmp/al2023x/lib'].filter(Boolean);
    const libDir = libCandidates.find((d) => { try { return fs.readdirSync(d).some((f) => f.startsWith('libnspr4')); } catch (e) { return false; } });
    if (libDir) env.LD_LIBRARY_PATH = [libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');

    const { server, port } = await serve();
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath, args, headless: 'shell', env,
            defaultViewport: { width: 1050, height: 558, deviceScaleFactor: 1 }
        });
    } catch (e) {
        server.close();
        if (/libnspr4|shared libraries|libnss3/.test(e.message)) {
            console.log('⚠ SKIP: Chromium shared libraries missing — set PUPPETEER_LIB_PATH ' +
                '(the @sparticuz/chromium al2023.tar.br lib dir).');
            process.exit(0);
        }
        throw e;
    }
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url();
        try {
            if (url.includes('/api/layers/')) {
                return req.respond({ status: 200, contentType: 'application/json',
                    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(FIXTURE) });
            }
            if (url.startsWith('http://127.0.0.1:' + port)) {
                if (url.includes('/js/map-app.js')) {
                    const body = MAP_HOOK + fs.readFileSync(path.join(ROOT, 'js', 'map-app.js'), 'utf8');
                    return req.respond({ status: 200, contentType: 'application/javascript', body });
                }
                return req.continue();
            }
            return req.abort();   // tiles/CDNs: stay offline
        } catch (e) { try { req.abort(); } catch (_) {} }
    });

    console.log('[Test] Heritage canvas zoom animation (real Chromium + real Leaflet)...');
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__testMap && window.__testMap._loaded', { timeout: 60000 });

    // Turn the Heritage layer on.  loadLocalLayerData() does not return its
    // promise on the first call, so the first toggle throws — retry, like a user
    // clicking the checkbox twice.
    await page.evaluate((c) => {
        window.__testMap.setView([c.lat, c.lng], 11, { animate: false });
        const t = document.getElementById('patrimoniuToggle');
        if (t) t.checked = true;
    }, SITE);
    let attached = false;
    for (let i = 0; i < 6 && !attached; i++) {
        await new Promise((r) => setTimeout(r, 200));
        attached = await page.evaluate(() => {
            try { window.togglePatrimoniuLayer(true); } catch (e) { /* first call throws */ }
            return !!(window._patrimoniuLayer && window._patrimoniuLayer._map);
        });
    }
    assert(attached, 'the Patrimoniu layer must attach to the map');
    await page.waitForFunction(() => {
        const l = window._localLayerData && window._localLayerData[0];
        return !!(l && l.features && l.features.length);
    }, { timeout: 30000 });

    await page.evaluate(PIXEL_HELPERS);
    const hook = await page.evaluate(() => !!(window._patrimoniuCanvasState && window._patrimoniuCanvasState.anchor));
    assert(hook, 'js/map-app.js must publish window._patrimoniuCanvasState.anchor ' +
        '(the project-space origin of bitmap pixel (0,0) that the zoom transform scales)');
    const results = [];

    for (const targetZoom of [12, 14]) {
        await page.evaluate((c, z) => window.__testMap.setView([c.lat, c.lng], z - 1, { animate: false }), SITE, targetZoom);
        await new Promise((r) => setTimeout(r, 400));
        await page.evaluate(() => window._scheduleRedraw && window._scheduleRedraw());
        await new Promise((r) => setTimeout(r, 250));

        const prep = await page.evaluate((c) => {
            const canvas = window.__siteCanvas();
            window.__refMarker = L.marker([c.lat, c.lng], { interactive: false, keyboard: false,
                icon: L.divIcon({ className: 'test-ref', html: '', iconSize: [10, 10], iconAnchor: [5, 5] }) }).addTo(window.__testMap);
            window.__bitmap = null;
            const r = window.__siteBitmap(c);
            window.__bitmap = r.bitmap;
            return { available: !!canvas, bitmap: r.bitmap, projectPixel: r.projectPixel };
        }, SITE);
        assert(prep.available, 'the site canvas must exist');
        assert(prep.bitmap, 'the app must paint a pin for the site');
        assert(Math.hypot(prep.bitmap.x - prep.projectPixel.x, prep.bitmap.y - prep.projectPixel.y) < 1.5,
            'at rest the pin must sit on the site (bitmap ' + JSON.stringify(prep.bitmap) + ')');

        await page.evaluate((z) => {
            window.__frames = [];
            const map = window.__testMap;
            let n = 0;
            const loop = () => {
                if (map._animatingZoom) window.__frames.push(window.__frame(window.__bitmap));
                if (++n < 120) requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
            map.setZoom(z);
        }, targetZoom);
        await page.waitForFunction('!window.__testMap._animatingZoom', { timeout: 15000 });
        await new Promise((r) => setTimeout(r, 500));

        const frames = await page.evaluate(() => window.__frames);
        const settled = await page.evaluate((c) => {
            const r = window.__siteBitmap(c);
            if (!r.bitmap) return { err: null };
            const m = window.__markerPos();
            const canvas = window.__siteCanvas();
            const M = window.__matrix(canvas);
            const d = { x: M.e + M.a * r.bitmap.x, y: M.f + M.a * r.bitmap.y };
            return { err: Math.hypot(d.x - m.x, d.y - m.y) };
        }, SITE);
        const animated = frames.filter((f) => f.scale > 1.01);
        assert(animated.length >= 3, 'the zoom must really animate (got ' + animated.length + ' frames)');
        const worst = Math.max(...animated.map((f) => f.err));
        const scale = Math.max(...animated.map((f) => f.scale));
        const invariant = Math.max(...animated.map((f) => (f.expectedOffset && f.targetOffset
            ? Math.hypot(f.expectedOffset.x - f.targetOffset.x, f.expectedOffset.y - f.targetOffset.y)
            : Infinity)));
        assert(invariant < 0.01,
            `during the animation the canvas transform must be scale*anchor - newPixelOrigin (found ${invariant} px difference)`);
        assert(worst < 1.5, `pin drift during the zoom animation must stay sub-pixel-ish, got ${worst.toFixed(2)} px at scale ${scale}`);
        assert(settled.err != null && settled.err < 1.5, `pin must stay on the site after the zoom, got ${settled.err}`);
        results.push({ targetZoom, frames: animated.length, scale, worst, settled: settled.err });
        await page.evaluate(() => { window.__testMap.removeLayer(window.__refMarker); });
    }

    // Hit testing after zoom: a click on the pin must open the heritage popup.
    const hit = await page.evaluate((c) => {
        const map = window.__testMap;
        const el = map.getContainer();
        const cr = el.getBoundingClientRect();
        const pt = map.latLngToContainerPoint(L.latLng(c.lat, c.lng));
        const opts = { bubbles: true, cancelable: true, clientX: cr.left + pt.x, clientY: cr.top + pt.y, view: window };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return pt;
    }, SITE);
    await new Promise((r) => setTimeout(r, 400));
    const popupText = await page.evaluate(() => {
        const p = document.querySelector('.patrimoniu-popup') || document.querySelector('.leaflet-popup');
        return p ? (p.textContent || '').trim().slice(0, 60) : null;
    });
    assert(popupText, `clicking the pin after zooming (container ${JSON.stringify(hit)}) must open the site popup`);

    results.forEach((r) => console.log(`    · z${r.targetZoom - 1}→z${r.targetZoom}: ${r.frames} animated frames, scale ${r.scale.toFixed(2)}, ` +
        `worst drift ${r.worst.toFixed(2)} px, settled ${r.settled.toFixed(2)} px`));
    console.log(`    · click on pin after zoom → popup ${JSON.stringify(popupText)}`);
    if (pageErrors.length) console.log('    · page errors: ' + pageErrors.slice(0, 3).join(' | '));

    await browser.close();
    server.close();
    console.log('✅ HERITAGE CANVAS ZOOM-ANIMATION BROWSER TEST PASSED');
})().catch((e) => {
    console.error('❌ ' + (e && e.message));
    process.exit(1);
});
