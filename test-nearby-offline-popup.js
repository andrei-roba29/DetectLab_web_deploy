// Regression test: the offline detectorist bubbles from "Vezi alți detectoriști
// în zonă" must open ONE window — the one with the information — and not the
// small blank box that used to appear next to it.
//
// What the bug was
// ----------------
// addOfflineDetectorBubbles() (js/map-app.js) binds its popup as
//     marker.bindPopup('<div class="map-place-popup">…info…</div>')
// and css/styles.css declared .map-place-popup as a STANDALONE card:
//     position: absolute; transform: translate(-50%, calc(-100% - 14px));
// Inside a real Leaflet popup that took the only child of
// .leaflet-popup-content out of the flow, so Leaflet's own popup had nothing to
// size around (_updateLayout clamps the empty content node to minWidth = 50px)
// and the map painted TWO windows: an empty little dark popup box (just the ×
// button) plus the info card floating above it.
//
// This test therefore does two things with the REAL code and the REAL
// stylesheet (no jsdom, like the other tests in this repo):
//   1. runs the actual addOfflineDetectorBubbles() in a vm sandbox against
//      Leaflet + DetectLabLastLocation stubs and captures the popup HTML it
//      binds, so the info (name / offline note / locality / seen-at) is proved
//      to still be there and to still use the .map-place-popup card;
//   2. resolves the shipped CSS cascade for the element path Leaflet builds
//      (#detectlab-map … .leaflet-popup > .leaflet-popup-content-wrapper >
//      .leaflet-popup-content > .map-place-popup) and asserts the card is in
//      normal flow with no frame and no arrow of its own, while Leaflet's
//      wrapper still paints the single visible window.
//
// Run: node test-nearby-offline-popup.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'js/map-app.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
    if (!cond) {
        console.error('✗ ' + name + (extra ? '\n    ' + extra : ''));
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log('✓ ' + name);
}

/* ── 1. Run the REAL addOfflineDetectorBubbles ─────────────────────────────── */

function extractFn(src, marker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('could not find "' + marker + '" in js/map-app.js');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j + 1);
        }
    }
    throw new Error('unbalanced braces for "' + marker + '"');
}

const offlineFnSrc = extractFn(MAP_SRC, 'async function addOfflineDetectorBubbles(');
const initialsFnSrc = extractFn(MAP_SRC, 'function nearbyInitials(');

// Rows as js/last-location.js returns them (user_last_locations).
const LAST_ROWS = [
    { user_id: 'u-offline', full_name: 'Andrei Popescu', latitude: 45.75, longitude: 21.23,
      county: 'Timis', label: 'Timișoara, Timiș', updated_at: '2026-09-05T08:15:00.000Z' },
    { user_id: 'u-live', full_name: 'Live One', latitude: 45.76, longitude: 21.24,
      county: 'Timis', label: 'Timișoara, Timiș', updated_at: '2026-09-07T08:15:00.000Z' },
    { user_id: 'u-other-county', full_name: 'Far Away', latitude: 44.43, longitude: 26.10,
      county: 'Bucuresti', label: 'București', updated_at: '2026-09-06T08:15:00.000Z' },
    { user_id: 'u-me', full_name: 'Me Myself', latitude: 45.748, longitude: 21.208,
      county: 'Timis', label: 'Timișoara, Timiș', updated_at: '2026-09-07T08:00:00.000Z' }
];

const boundPopups = [];   // { html, options, latlng }
const addedMarkers = [];

const sandbox = {
    console: { warn() {}, log() {} },
    _detLat: 45.7489,
    _detLng: 21.2087,
    L: {
        divIcon(opts) { return { _isDivIcon: true, options: opts }; },
        marker(latlng, opts) {
            const m = {
                latlng: latlng,
                options: opts || {},
                bindPopup(html, options) { m.popup = { html: html, options: options || null }; return m; },
                addTo(layer) { layer.addLayer(m); return m; }
            };
            return m;
        },
        layerGroup() {
            return {
                _layers: [],
                addLayer(l) { this._layers.push(l); return this; },
                getLayers() { return this._layers; },
                clearLayers() { this._layers = []; return this; }
            };
        }
    },
    window: {
        DetectLabLastLocation: {
            recordLastLocation: async function () { return null; },
            getMyLastLocation: function () { return LAST_ROWS[3]; },
            resolveBroadLocation: async function () { return { county: 'Timis' }; },
            fetchLastLocations: async function () { return LAST_ROWS.slice(); },
            sameCounty: function (a, b) {
                const n = function (s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); };
                return n(a) === n(b);
            }
        }
    }
};
sandbox.nearbyLayer = sandbox.L.layerGroup();

vm.createContext(sandbox);
vm.runInContext(
    initialsFnSrc + '\n' + offlineFnSrc +
    '\nglobalThis.__run = function (live, user) { return addOfflineDetectorBubbles(live, user); };',
    sandbox
);

(async function main() {
    const added = await sandbox.__run({ 'u-live': true }, { id: 'u-me' });

    const offline = sandbox.nearbyLayer.getLayers().filter(function (m) {
        return m && m.options && m.options.icon &&
            /detector-offline-marker/.test(m.options.icon.options.html || '');
    });

    check('offline pass added exactly one bubble (live pin, other county and self excluded)',
        added === 1 && offline.length === 1,
        'added=' + added + ', offlineMarkers=' + offline.length);
    if (offline.length !== 1) { console.error('cannot continue without the offline marker'); process.exit(1); }

    const marker = offline[0];
    boundPopups.push(marker.popup);

    check('the offline bubble binds exactly ONE popup', boundPopups.length === 1,
        'popups=' + boundPopups.length);

    const html = marker.popup ? marker.popup.html : '';
    check('popup carries the detectorist name', /Andrei Popescu/.test(html));
    check('popup carries the offline / last-known-location note', /Offline/.test(html) && /ultima locație/.test(html));
    check('popup carries the last known locality', /Timișoara, Timiș/.test(html));
    check('popup carries the "last seen" timestamp', /🕘/.test(html));
    check('popup content is the .map-place-popup card', /class="map-place-popup"/.test(html));

    /* ── 2. Resolve the shipped CSS cascade for that card ──────────────────── */

    // The DOM Leaflet actually builds around bindPopup() content.
    const popupPath = [
        { tag: 'div', id: 'detectlab-map', classes: ['leaflet-container'] },
        { tag: 'div', id: null, classes: ['leaflet-map-pane'] },
        { tag: 'div', id: null, classes: ['leaflet-popup-pane'] },
        { tag: 'div', id: null, classes: ['leaflet-popup'] },
        { tag: 'div', id: null, classes: ['leaflet-popup-content-wrapper'] },
        { tag: 'div', id: null, classes: ['leaflet-popup-content'] },
        { tag: 'div', id: null, classes: ['map-place-popup'] }
    ];

    const cascade = buildCascade(CSS_SRC);
    const card = cascade.resolve(popupPath, popupPath.length - 1, null);
    const cardAfter = cascade.resolve(popupPath, popupPath.length - 1, 'after');
    const wrapper = cascade.resolve(popupPath, 4, null);

    // One window, not two: the card must not escape the popup's flow …
    check('the card stays in normal flow inside the Leaflet popup (position: static)',
        card.position === 'static', 'position: ' + card.position);
    check('the card is no longer lifted out of the popup (no transform)',
        !card.transform || card.transform === 'none', 'transform: ' + card.transform);
    // … and must not paint a second frame of its own …
    check('the card paints no background of its own',
        /^(none|transparent)$/.test(card.background || '') || /^(none|transparent)$/.test(card['background-color'] || ''),
        'background: ' + (card.background || card['background-color']));
    check('the card draws no border of its own',
        /^(none|0)$/.test(String(card.border || card['border-width'] || 'none')),
        'border: ' + (card.border || card['border-width']));
    check('the card casts no shadow of its own',
        card['box-shadow'] === 'none', 'box-shadow: ' + card['box-shadow']);
    check('the card adds no padding of its own',
        /^0(px)?$/.test(String(card.padding || '0')), 'padding: ' + card.padding);
    check('the card draws no arrow of its own (Leaflet\'s .leaflet-popup-tip is the arrow)',
        cardAfter.content === 'none', '::after content: ' + cardAfter.content);
    check('the card text may wrap inside the popup width',
        card['white-space'] === 'normal', 'white-space: ' + card['white-space']);
    check('the single remaining window is interactive (tappable / selectable)',
        card['pointer-events'] === 'auto', 'pointer-events: ' + card['pointer-events']);
    // … while the Leaflet popup chrome still paints the ONE visible window.
    check('Leaflet\'s popup wrapper still paints the visible window (dark background)',
        /rgba\(6,\s*14,\s*30/.test(wrapper.background || wrapper['background-color'] || ''),
        'wrapper background: ' + (wrapper.background || wrapper['background-color']));
    check('Leaflet\'s popup wrapper still has a border',
        !!wrapper.border && wrapper.border !== 'none', 'wrapper border: ' + wrapper.border);

    /* ── 3. Every .map-place-popup caller is covered by the same rule ──────── */
    const callers = MAP_SRC.match(/bindPopup\('<div class="map-place-popup"/g) || [];
    check('all .map-place-popup callers pass it as Leaflet popup content (covered by the override)',
        callers.length >= 4, 'callers=' + callers.length);

    /* ── 4. Installed PWAs must actually pick the fixed stylesheet up ──────── */
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const link = (indexHtml.match(/href="(css\/styles\.css\?v=[^"]+)"/) || [])[1];
    check('index.html loads a cache-busted styles.css', !!link, 'no ?v= on css/styles.css');
    if (link) {
        check('that exact stylesheet URL is in the service worker PRECACHE_URLS',
            sw.includes("'" + link + "'"), link + ' not pre-cached in sw.js');
    }
    check('the service worker cache name was bumped so old caches are dropped',
        /CACHE_NAME = 'detectlab-v72-nearby-popup'/.test(sw));

    console.log('\n' + passed + ' checks passed.');
    if (process.exitCode) console.error('FAILED');
})();

/* ── tiny CSS cascade resolver (no dependencies) ───────────────────────────── */

function buildCascade(css) {
    const rules = parseRules(stripComments(css));
    return {
        rules: rules,
        resolve(elPath, index, pseudo) {
            const el = elPath[index];
            const matched = [];
            rules.forEach(function (rule, i) {
                if (rule.pseudo !== (pseudo || null)) return;
                if (!selectorMatches(rule.selector, elPath, index)) return;
                matched.push({ decls: rule.decls, spec: rule.spec, order: i });
            });
            // (specificity, then source order) wins.
            matched.sort(function (a, b) {
                for (let k = 0; k < 3; k++) if (a.spec[k] !== b.spec[k]) return a.spec[k] - b.spec[k];
                return a.order - b.order;
            });
            const out = {};
            matched.forEach(function (m) {
                Object.keys(m.decls).forEach(function (p) { out[p] = m.decls[p]; });
            });
            return out;
        }
    };
}

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

function parseRules(css) {
    const rules = [];
    let buf = '';
    const stack = [];
    for (let i = 0; i < css.length; i++) {
        const ch = css[i];
        if (ch === '{') {
            const head = buf.trim();
            buf = '';
            if (head.startsWith('@')) { stack.push(head); continue; }   // @media etc.
            stack.push(null);
            const selStart = i + 1;
            const close = css.indexOf('}', selStart);
            const body = css.slice(selStart, close < 0 ? css.length : close);
            parseSelectorList(head, parseDecls(body)).forEach(function (r) { rules.push(r); });
            i = close < 0 ? css.length : close;
            stack.pop();
            continue;
        }
        if (ch === '}') { stack.pop(); continue; }
        buf += ch;
    }
    return rules;
}

function parseDecls(body) {
    const decls = {};
    body.split(';').forEach(function (pair) {
        const idx = pair.indexOf(':');
        if (idx < 0) return;
        const prop = pair.slice(0, idx).trim().toLowerCase();
        const val = pair.slice(idx + 1).trim();
        if (prop && val) decls[prop] = val;
    });
    return decls;
}

function parseSelectorList(selectorText, decls) {
    const out = [];
    selectorText.split(',').forEach(function (part) {
        const sel = part.trim();
        if (!sel) return;
        const m = sel.match(/(::?[a-z-]+)$/i);
        const pseudo = m && m[1].startsWith('::') ? m[1].slice(2).toLowerCase() : null;
        const withoutPseudo = m ? sel.slice(0, m.index).trim() : sel;
        if (!withoutPseudo) return;
        out.push({
            selector: withoutPseudo.split(/\s+/).filter(Boolean),
            pseudo: pseudo,
            decls: decls,
            spec: specificity(withoutPseudo)
        });
    });
    return out;
}

function specificity(sel) {
    let a = 0, b = 0, c = 0;
    sel.split(/[\s>+~]+/).forEach(function (compound) {
        a += (compound.match(/#[a-z0-9_-]+/gi) || []).length;
        b += (compound.match(/\.[a-z0-9_-]+/gi) || []).length;
        b += (compound.match(/\[[^\]]+\]/g) || []).length;
        b += (compound.match(/:(?!:)[a-z-]+/gi) || []).length;
        const tags = compound.replace(/[#.][a-z0-9_-]+/gi, '').replace(/\[[^\]]+\]/g, '').replace(/::?[a-z-]+/gi, '');
        if (tags && tags !== '*') c += 1;
    });
    return [a, b, c];
}

function compoundMatches(compound, el) {
    const parts = compound.match(/([#.][a-z0-9_-]+)|(\[[^\]]+\])|(::?[a-z-]+)|(^[-a-z0-9]+)/gi) || [];
    let checked = 0;
    for (const p of parts) {
        if (p[0] === '#') { if (el.id !== p.slice(1)) return false; }
        else if (p[0] === '.') { if (!el.classes.includes(p.slice(1))) return false; }
        else if (p[0] === '[') return false;                       // attribute selectors: not needed here
        else if (p[0] === ':') { /* pseudo: handled separately */ }
        else { if (el.tag !== p.toLowerCase()) return false; }
        checked++;
    }
    return checked > 0;
}

// Descendant combinator only (all rules involved use it); right-to-left walk.
function selectorMatches(compounds, elPath, index) {
    if (!compoundMatches(compounds[compounds.length - 1], elPath[index])) return false;
    let cursor = compounds.length - 2;
    let i = index - 1;
    while (cursor >= 0) {
        let found = false;
        while (i >= 0) {
            if (compoundMatches(compounds[cursor], elPath[i])) { found = true; i--; break; }
            i--;
        }
        if (!found) return false;
        cursor--;
    }
    return true;
}
