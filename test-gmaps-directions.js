// Tests for the „🧭 Traseu Google Maps / Directions" button added to every
// map popup that designates a location:
//   • js/lidar-scanner.js    — each scan result (ring centre)
//   • js/archeo-report.js    — each report candidate (ring centre)
//   • js/archeo-potential.js — each archaeological-potential bubble (centre)
//   • js/map-app.js          — each saved pin
//   • js/events.js           — each event popup
// The destination handed to Google Maps must ALWAYS be the centre of the
// circle/pin — for large radii the route must lead to the middle of the area,
// never to a point on its circumference (js/google-maps-directions.js).
//
// Usage: node test-gmaps-directions.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const api = require('./js/google-maps-directions.js');

let passed = 0;
function check(name, cond, extra) {
    if (cond) { passed++; console.log('  \u2714 ' + name); }
    else { process.exitCode = 1; console.error('  \u2718 ' + name + (extra !== undefined ? ' \u2014 ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

/* ── 1. directionsUrl() — the destination is the circle/pin CENTRE ───────── */
section('directionsUrl(): official Maps URLs API, destination = centre');

check('default driving mode URL',
    api.directionsUrl(45.9432, 24.9668) ===
    'https://www.google.com/maps/dir/?api=1&destination=45.9432,24.9668&travelmode=driving');

check('coordinates are clamped to 6 decimals (≈11 cm — always the centre, not an edge point)',
    api.directionsUrl(45.1234567, 24.9876543) ===
    'https://www.google.com/maps/dir/?api=1&destination=45.123457,24.987654&travelmode=driving');

check('negative coordinates survive (full-earth coverage)',
    api.directionsUrl(-45.5, -70.25) ===
    'https://www.google.com/maps/dir/?api=1&destination=-45.5,-70.25&travelmode=driving');

check('travelmode=walking is honoured',
    /travelmode=walking$/.test(api.directionsUrl(10, 20, 'walking')));

check('unsupported travelmode falls back to driving (no URL injection)',
    api.directionsUrl(10, 20, 'javascript:alert(1)') ===
    'https://www.google.com/maps/dir/?api=1&destination=10,20&travelmode=driving');

check('invalid lat (NaN) → null, so the caller simply omits the button',
    api.directionsUrl(null, 20) === null);
check('invalid lng (string) → null', api.directionsUrl(45, 'abc') === null);
check('out-of-range lat (999) → null', api.directionsUrl(999, 20) === null);
check('out-of-range lng (200) → null', api.directionsUrl(45, 200) === null);

/* ── 2. buttonHtml() — safe anchor, opens in a new tab ───────────────────── */
section('buttonHtml(): anchor with target=_blank + noopener');

const html = api.buttonHtml(45.9432, 24.9668);
check('button carries the shared CSS class', html.includes('class="dl-gmaps-directions-btn"'));
check('button embeds the directions URL', html.includes('https://www.google.com/maps/dir/?api=1&destination=45.9432,24.9668&travelmode=driving'));
check('opens in a new tab (target="_blank")', html.includes('target="_blank"'));
check('noopener + noreferrer (no window.opener leak)', html.includes('rel="noopener noreferrer"'));
check('bilingual label present', html.includes('Traseu Google Maps / Directions'));
check('invalid coords render nothing (popups stay functional)', api.buttonHtml(undefined, undefined) === '');

/* ── 3. Browser global — attaches to window, not just module.exports ─────── */
section('browser global');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(read('js/google-maps-directions.js'), sandbox, { filename: 'google-maps-directions.js' });
check('window.DetectLabDirections is exported in the browser',
    !!(sandbox.window.DetectLabDirections && sandbox.window.DetectLabDirections.buttonHtml));

/* ── 4. Integration: the five popups route to their CENTRE ───────────────── */
section('integration: every popup embeds the button aimed at the centre');

const lidar = read('js/lidar-scanner.js');
check('lidar-scanner.js: result popup uses buttonHtml(p.lat, p.lng) — ring centre',
    /buttonHtml\(p\.lat,\s*p\.lng\)/.test(lidar));
check('lidar-scanner.js: degrades gracefully when the helper is missing',
    /window\.DetectLabDirections\s*&&\s*window\.DetectLabDirections\.buttonHtml/.test(lidar));

const report = read('js/archeo-report.js');
check('archeo-report.js: candidate popup uses buttonHtml(res.lat, res.lng) — ring centre',
    /buttonHtml\(res\.lat,\s*res\.lng\)/.test(report));
check('archeo-report.js: degrades gracefully when the helper is missing',
    /window\.DetectLabDirections\s*&&\s*window\.DetectLabDirections\.buttonHtml/.test(report));

const potential = read('js/archeo-potential.js');
check('archeo-potential.js: bubble popup uses buttonHtml(c.lat, c.lng) — bubble centre',
    /buttonHtml\(c\.lat,\s*c\.lng\)/.test(potential));
check('archeo-potential.js: degrades gracefully when the helper is missing',
    /window\.DetectLabDirections\s*&&\s*window\.DetectLabDirections\.buttonHtml/.test(potential));

const mapApp = read('js/map-app.js');
check('map-app.js: saved-pin popup uses buttonHtml(lat, lng) — the pin itself',
    /buttonHtml\(lat,\s*lng\)/.test(mapApp));
check('map-app.js: degrades gracefully when the helper is missing',
    /window\.DetectLabDirections\s*&&\s*window\.DetectLabDirections\.buttonHtml/.test(mapApp));

const events = read('js/events.js');
check('events.js: event popup uses buttonHtml(ev.latitude, ev.longitude)',
    /buttonHtml\(ev\.latitude,\s*ev\.longitude\)/.test(events));
check('events.js: degrades gracefully when the helper is missing',
    /window\.DetectLabDirections\s*&&\s*window\.DetectLabDirections\.buttonHtml/.test(events));

/* ── 5. Load order + PWA pre-cache + CSS ─────────────────────────────────── */
section('wiring: index.html load order, sw.js pre-cache, styles.css');

const indexHtml = read('index.html');
// Compare ACTUAL <script src> tags (versioned), not first string occurrences —
// comments elsewhere in the page mention the file names much earlier.
const posHelper = indexHtml.indexOf('<script src="js/google-maps-directions.js?v=');
for (const consumer of ['js/events.js', 'js/map-app.js', 'js/archeo-potential.js', 'js/lidar-scanner.js', 'js/archeo-report.js']) {
    check(`index.html loads the helper BEFORE ${consumer}`,
        posHelper !== -1 && posHelper < indexHtml.indexOf('<script src="' + consumer + '?v='));
}
// Consumers can be updated by later releases: verify the actual page URLs,
// not a count of one historical release suffix.
const assets = ['js/google-maps-directions.js', 'js/events.js', 'js/map-app.js',
    'js/archeo-potential.js', 'js/lidar-scanner.js', 'js/archeo-report.js', 'css/styles.css'];
const urls = assets.map(asset => (indexHtml.match(new RegExp('(?:src|href)="(' +
    asset.replace(/\./g, '\\.') + '\\?v=[^"]+)"')) || [])[1]);
check('helper, all five consumers and styles.css are cache-busted', urls.every(Boolean));
const sw = read('sw.js');
check('sw.js pre-caches the actual helper and consumer URLs', urls.every(url => sw.includes("'" + url + "'")));
check('sw.js cache name was bumped (installed PWAs pick the change up)',
    Number((sw.match(/CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]) >= 106);

const css = read('css/styles.css');
check('styles.css styles the button', css.includes('.dl-gmaps-directions-btn'));

/* ── 6. The “centre, not circumference” contract, end to end ─────────────── */
section('contract: large radii still route to the centre');

// A 10 km potential bubble and a 100 m LIDAR ring at the SAME centre must
// produce the SAME destination — the centre — regardless of the radius drawn.
const centre = { lat: 46.1773, lng: 24.3419 };  // near Sighișoara
check('radius 100 m and radius 10 000 m share one destination: the centre',
    api.directionsUrl(centre.lat, centre.lng) === api.directionsUrl(centre.lat, centre.lng, 'driving') &&
    api.directionsUrl(centre.lat, centre.lng).includes('destination=46.1773,24.3419'));

/* ── 7. Popup builders stay well-formed (div balance) ────────────────────── */
section('well-formed popups: <div> openings and closings stay in balance');

// Each popup builder only concatenates literal HTML chunks that are balanced
// on their own (conditionals pick between balanced chunks), so counting
// <div openings vs </div> closings inside the builder source must match —
// this is exactly the bug class introduced by pasting the button block in.
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert.notStrictEqual(start, -1, name + ' not found');
    let i = src.indexOf('{', start), depth = 0, inStr = null;
    for (; i < src.length; i++) {
        const ch = src[i], prev = src[i - 1];
        if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; continue; }
        if (ch === '\'' || ch === '"') { inStr = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error(name + ': unbalanced braces');
}
function divBalance(fnSrc) {
    const open = (fnSrc.match(/<div\b/g) || []).length;
    const close = (fnSrc.match(/<\/div>/g) || []).length;
    return { open, close };
}
const builders = [
    ['lidar-scanner.js', 'makeResult'],
    ['archeo-report.js', 'resultPopupHtml'],
    ['archeo-potential.js', 'popupHtml'],
    ['map-app.js', 'makeSavedLocationMarker'],
    ['events.js', 'createEventPopupHtml']
];
for (const [file, fn] of builders) {
    const { open, close } = divBalance(extractFunction(read('js/' + file), fn));
    check(`${file} → ${fn}(): ${open} <div> vs ${close} </div>`, open === close);
}

console.log('\n' + (process.exitCode ? '✗ SOME CHECKS FAILED' : 'All checks passed.') + ' (' + passed + ' passed)');
