/*
 * test-sat60-layers.js
 * ──────────────────────────────────────────────────────────────────────────
 * Guards the bug that made the "Satellite imagery 60's" layer show nothing:
 * the CORONA layer names it requested did not exist on the CAST GeoServer.
 *
 * Reported failing request (returned HTTP 400, not a PNG):
 *
 *   …/geoserver/gwc/service/wms?…&LAYERS=corona%3A1107-1074Fore&…
 *     → "400: Unknown layer corona:1107-1074Fore.
 *        Check the logfiles, it may not have loaded properly."
 *
 * Root cause: the layer list had been written from the CORONA naming pattern
 * (corona:<mission>-<pass><Fore|Aft>) rather than from the server's actual
 * catalogue. Verified live against geoserve.cast.uark.edu on 2026-08-12:
 *
 *   corona:1107-1074Fore  → 400 Unknown layer      (does not exist)
 *   corona:1103-2155Fore  → "Could not find layer" (does not exist)
 *   corona:1110-2289Aft   → 400 Unknown layer      (does not exist)
 *   corona:1107-1074Aft   → exists, but images GREECE   (22.09E, 38.76N)
 *   corona:1110-2289Fore  → exists, but images PERU     (-75.67E, -13.02N)
 *   corona:1105-2235Fore  → exists, but images the Middle East (31.7E, 24.6N)
 *
 * …so every request the layer sent over Romania either errored or fell
 * outside the pass footprint. Nothing could ever be drawn.
 *
 * The replacement list is verified: each pass exists AND returns real pixels
 * over Romania (WMS GetFeatureInfo, non-zero GRAY_INDEX), e.g.
 *
 *   corona:1104-2155Fore  → GRAY_INDEX 255 at 22.90E/46.58N (Transylvania)
 *   corona:1036-2139Fore  → GRAY_INDEX  88 at 26.10E/44.43N (Bucharest)
 *   corona:1103-1058Aft   → GRAY_INDEX 105 at 25.42E/44.42N (Muntenia)
 *
 * Run:  node test-sat60-layers.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
    checks++;
    if (cond) {
        console.log('  \u2713 ' + name);
    } else {
        failures++;
        console.error('  \u2717 ' + name + (detail ? ' — ' + detail : ''));
    }
}

/* Extract the Sat60 layer block so the checks look only at the real config. */
const sat60Start = mapApp.indexOf('var SAT60_PASS_LAYERS');
const sat60End = mapApp.indexOf('function ensureSat60Layers');
const sat60Block = mapApp.slice(sat60Start, sat60End);
check('Sat60 layer configuration block found', sat60Start !== -1 && sat60End > sat60Start);

/* Every corona:… name mentioned in the Sat60 configuration. */
const declared = (sat60Block.match(/corona:[0-9]{4}-[0-9]{4}(?:Fore|Aft|d[fa][0-9]{3})/g) || []);
const uniqueDeclared = Array.from(new Set(declared));

/* ══════════════════════════════════════════════════════════════════════════
 * 1. The layer names that broke the map must be gone
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Non-existent / wrong-continent CORONA layers are not requested');

// Confirmed 400 "Unknown layer" or "Could not find layer" on the CAST server.
const NONEXISTENT = [
    'corona:1107-1074Fore',   // the exact layer from the bug report
    'corona:1103-2155Fore',
    'corona:1110-2289Aft',
    'corona:1103-2139Aft',
    'corona:1106-1042Aft',
    'corona:1105-2235Aft'
];
NONEXISTENT.forEach(function (name) {
    check('does not request non-existent layer ' + name,
        uniqueDeclared.indexOf(name) === -1);
});

// These exist on the server but image other parts of the world, so they can
// never draw anything over Romania.
const WRONG_REGION = [
    'corona:1107-1074Aft',    // Greece      (22.09E, 38.76N)
    'corona:1110-2289Fore',   // Peru        (-75.67E, -13.02N)
    'corona:1105-2235Fore',   // Middle East (31.74E, 24.62N)
    'corona:1022-2104Aft',    // N. Macedonia/Serbia (21.85E, 42.55N)
    'corona:1025-1025Fore',   // Middle East (37.35E, 18.54N)
    'corona:1103-2167df101'   // China       (117.57E, 35.73N)
];
WRONG_REGION.forEach(function (name) {
    check('does not request out-of-Romania layer ' + name,
        uniqueDeclared.indexOf(name) === -1);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Only server-verified layers remain
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] Only layers verified to exist AND cover Romania are requested');

// Verified live: layer exists and GetFeatureInfo returns real (non-zero)
// pixel values inside Romania.
const VERIFIED = [
    'corona:1104-2155Fore',
    'corona:1104-2155Aft',
    'corona:1036-2139Fore',
    'corona:1103-1058Aft',
    'corona:1103-1058Fore',
    'corona:1026-2088Aft',
    'corona:1104-2155df004',
    'corona:1104-2155df007',
    'corona:1104-2155df011'
];

check('at least one CORONA layer is configured', uniqueDeclared.length > 0);
uniqueDeclared.forEach(function (name) {
    check('configured layer is server-verified: ' + name,
        VERIFIED.indexOf(name) !== -1);
});
check('the Transylvania pass that really covers Romania is present',
    uniqueDeclared.indexOf('corona:1104-2155Fore') !== -1);
check('the Bucharest/Muntenia pass is present',
    uniqueDeclared.indexOf('corona:1036-2139Fore') !== -1);

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Each layer is gated to its own verified footprint
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] Each layer carries its own footprint bounds (no blind requests)');

const entryRe = /\{\s*name:\s*"(corona:[^"]+)"\s*,\s*bounds:\s*\[\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*,\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*\]\s*\}/g;
const entries = [];
let m;
while ((m = entryRe.exec(sat60Block)) !== null) {
    entries.push({
        name: m[1],
        south: parseFloat(m[2]), west: parseFloat(m[3]),
        north: parseFloat(m[4]), east: parseFloat(m[5])
    });
}

check('every configured layer is a {name, bounds} entry',
    entries.length === uniqueDeclared.length,
    entries.length + ' entries vs ' + uniqueDeclared.length + ' names');

// Romania's extent, as used by the map (ROMANIA_BOUNDS).
const RO = { south: 43.5, west: 19.5, north: 48.5, east: 30.5 };
entries.forEach(function (e) {
    check(e.name + ': bounds are a valid, non-empty box',
        e.north > e.south && e.east > e.west,
        JSON.stringify(e));
    check(e.name + ': bounds intersect Romania',
        e.south < RO.north && e.north > RO.south &&
        e.west < RO.east && e.east > RO.west,
        JSON.stringify(e));
    check(e.name + ': bounds stay within the Romania view box',
        e.south >= RO.south - 0.01 && e.north <= RO.north + 0.01 &&
        e.west >= RO.west - 0.01 && e.east <= RO.east + 0.01,
        JSON.stringify(e));
});

check('layers are constructed from their own bounds (not a blanket box)',
    /bounds:\s*layerBounds/.test(mapApp));
check('a {name, bounds} descriptor is understood by _sat60MakeLayer',
    /entry\.bounds/.test(mapApp) && /L\.latLngBounds\(entry\.bounds\)/.test(mapApp));

/* ══════════════════════════════════════════════════════════════════════════
 * 4. A refused tile cannot leave a broken image on the map
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] Tile errors are handled instead of showing broken tiles');

check('a tileerror handler is attached', /\.on\(\s*["']tileerror["']/.test(mapApp));
check('the failing tile element is hidden', /e\.tile\.style\.display\s*=\s*"none"/.test(mapApp));
check('the unavailable layer name is logged once',
    /_sat60ErrorLogged/.test(mapApp) && /CORONA layer unavailable/.test(mapApp));

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All satellite-60s layer-validity checks passed.');
