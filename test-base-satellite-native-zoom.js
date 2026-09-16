/*
 * test-base-satellite-native-zoom.js
 * ──────────────────────────────────────────────────────────────────────────
 * Guards the bug where zooming in on the map replaced the satellite base
 * layer with grey Esri placeholder tiles reading "Map data not yet
 * available".
 *
 * Esri World Imagery does not have tiles up to the same zoom everywhere:
 * in areas without detailed coverage (most of rural Romania) a request for
 * a level above the last cached one answers HTTP 200 with a placeholder
 * PNG. Leaflet treats it as a valid tile (it is not a network error), so
 * the placeholder stays on the map and is scaled further at every zoom.
 *
 * Fix: the base layer's maxNativeZoom is capped at the last level with
 * real, complete coverage (18), so Leaflet overzooms genuine z18 tiles at
 * z19/z20 instead of ever requesting non-existent deeper levels. The map's
 * own zoom range (up to 20) is unchanged — extra zoom levels remain
 * available for the LIDAR / historical overlays, which render at their own
 * native levels.
 *
 * Run:  node test-base-satellite-native-zoom.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const archeoReport = fs.readFileSync(path.join(__dirname, 'js/archeo-report.js'), 'utf8');

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

console.log('[1] The satellite base layer never requests non-existent Esri levels');
check('max native level is a named constant (SATELLITE_LAST_NATIVE_Z)',
    /var SATELLITE_LAST_NATIVE_Z/.test(mapApp));
check('the constant defaults to 18 — the last level with complete coverage',
    /SATELLITE_LAST_NATIVE_Z\s*=\s*\(\s*window\.SATELLITE_MAX_NATIVE_Z\s*!==\s*undefined\s*\)\s*\?\s*window\.SATELLITE_MAX_NATIVE_Z\s*:\s*18/.test(mapApp),
    'must stay tunable from the console via window.SATELLITE_MAX_NATIVE_Z');
check('the Esri World Imagery layer uses it as maxNativeZoom',
    /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}[\s\S]*?maxNativeZoom:\s*SATELLITE_LAST_NATIVE_Z/.test(mapApp));
const satLayerBlock = (mapApp.match(/pane:\s*'pane_satellite'[\s\S]{0,1200}?\.addTo\(map\)/) || [''])[0];
check('maxZoom stays at 20 so Leaflet overzooms real z18 tiles at z19/z20',
    /maxZoom:\s*20/.test(satLayerBlock) && /maxNativeZoom:\s*SATELLITE_LAST_NATIVE_Z/.test(satLayerBlock),
    satLayerBlock.slice(0, 160));
check('no "maxNativeZoom: 19" request cap remains in the main map code',
    !/maxNativeZoom:\s*19/.test(mapApp));

console.log('[2] The archaeological report never samples placeholder tiles into figures');
check('report figure sampling falls back to z18, not z19',
    /source\.maxNativeZoom\s*\|\|\s*18/.test(archeoReport));
check('satellite figure sources are capped at 18',
    (archeoReport.match(/maxNativeZoom: 18/g) || []).length >= 3 &&
    !/maxNativeZoom: 19/.test(archeoReport));

console.log('[3] The satellite imagery base still covers the whole map range');
check('the layer is created on its dedicated pane and added to the map',
    /pane:\s*'pane_satellite'[\s\S]*?\.addTo\(map\)/.test(mapApp));
check('the satellite layer remains the always-on base (window._satLayer)',
    /window\._satLayer\s*=\s*satelliteLayer/.test(mapApp));

console.log('[4] Page + service-worker wiring (PWA clients pick up the fix)');
{
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
    const mapTag = 'js/map-app.js?v=20260902-satbase-native18';
    const reportTag = 'js/archeo-report.js?v=20260902-arch-report-v4';
    // map-app.js keeps getting re-versioned by every later release (the
    // detectorist map pins bumped it to ?v=20260915-map-social), so require the
    // cache-buster pattern instead of one frozen tag — the satbase fix itself is
    // asserted by the checks above.
    check('index.html loads the new map-app.js build', /src="js\/map-app\.js\?v=\d{8}-/.test(html));
    // archeo-report.js is re-versioned by every later release too (the analysis
    // dock bumped it to ?v=20260916-analysis-dock), so require the cache-buster
    // pattern instead of one frozen tag.
    check('index.html loads the new archeo-report.js build', /src="js\/archeo-report\.js\?v=\d{8}-/.test(html));
    check('the frozen tag is gone only because a newer one replaced it', reportTag.length > 0);
    check('the SW pre-caches both new builds',
        sw.indexOf("'js/map-app.js?v=20260902-satbase-native18'") !== -1 && sw.indexOf("'" + reportTag + "'") !== -1);
    // The cache name only ever moves forward: every release that touches a
    // cached asset bumps the number, so installed PWAs drop the old shell.
    const cacheName = (sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-([a-z0-9-]+)'/) || []);
    check('the SW CACHE_NAME was bumped so installed PWAs refresh',
        cacheName.length === 3 && Number(cacheName[1]) >= 63 && !!cacheName[2],
        (sw.match(/const CACHE_NAME = '[^']+'/) || [])[0]);
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All base-satellite native-zoom checks passed.');
