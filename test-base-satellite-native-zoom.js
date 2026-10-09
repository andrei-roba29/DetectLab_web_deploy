/*
 * Regression tests for the Esri imagery source used by the 3D globe basemap.
 * The MapLibre source must never request Esri's placeholder levels above the
 * last complete native zoom, and the app must keep a graceful Leaflet fallback.
 * Run: node test-base-satellite-native-zoom.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const globeBase = fs.readFileSync(path.join(__dirname, 'js/globe-base-layer.js'), 'utf8');
const archeoReport = fs.readFileSync(path.join(__dirname, 'js/archeo-report.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
    checks++;
    if (cond) console.log('  \u2713 ' + name);
    else {
        failures++;
        console.error('  \u2717 ' + name + (detail ? ' — ' + detail : ''));
    }
}

console.log('[1] MapLibre style: 3D globe + one Esri imagery raster source');
check('the working-map style requests the native globe projection',
    /projection:\s*\{\s*type:\s*'globe'\s*\}/.test(globeBase));
check('the style uses the existing Esri World Imagery tile endpoint',
    /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/.test(globeBase));
check('the Esri source is a raster source with 256 px tiles',
    /type:\s*'raster'[\s\S]*?tileSize:\s*256/.test(globeBase));
check('source maxzoom is controlled by the native satellite zoom setting',
    /maxzoom:\s*maxzoom/.test(globeBase) && /maxNativeZoom:\s*SATELLITE_LAST_NATIVE_Z/.test(mapApp));
check('the raster layer applies opacity through MapLibre paint properties',
    /setPaintProperty\(RASTER_LAYER_ID, 'raster-opacity', opacity\)/.test(globeBase));
check('the style is inline/local, not loaded from a remote style host',
    !/style:\s*['"]https?:\/\//.test(globeBase));

console.log('[2] Map integration and WebGL fallback');
check('native zoom remains configurable via window.SATELLITE_MAX_NATIVE_Z',
    /var SATELLITE_LAST_NATIVE_Z\s*=\s*\n?\s*\(window\.SATELLITE_MAX_NATIVE_Z !== undefined\) \? window\.SATELLITE_MAX_NATIVE_Z : 18/.test(mapApp));
check('the 3D globe is created as the normal basemap',
    /DetectLabGlobeBase\.create\(map,[\s\S]*?maxNativeZoom:\s*SATELLITE_LAST_NATIVE_Z/.test(mapApp));
check('Leaflet has a non-WebGL fallback using the same imagery and native zoom cap',
    /if \(!satelliteLayer\)[\s\S]*?L\.tileLayer\(SATELLITE_IMAGERY_URL,[\s\S]*?maxNativeZoom:\s*SATELLITE_LAST_NATIVE_Z/.test(mapApp));
check('the base layer remains addressable to existing app modules',
    /window\._satLayer\s*=\s*satelliteLayer/.test(mapApp));
check('the globe base is below Leaflet data overlays',
    /getPane\('pane_satellite'\)\.style\.zIndex\s*=\s*398/.test(mapApp));
check('changing historical imagery never removes or replaces the permanent globe',
    /Globul 3D rămâne singura bază/.test(mapApp) && !/map\.removeLayer\(satelliteLayer\)/.test(mapApp));

console.log('[3] The archaeological report still avoids placeholder tiles');
check('report figure sampling falls back to z18, not z19',
    /source\.maxNativeZoom\s*\|\|\s*18/.test(archeoReport));
check('satellite figure sources are capped at 18',
    (archeoReport.match(/maxNativeZoom: 18/g) || []).length >= 3 &&
    !/maxNativeZoom: 19/.test(archeoReport));

console.log('[4] Page + service-worker wiring');
[
    'css/maplibre-gl.css?v=5.24.0',
    'css/globe-base-layer.css?v=20261009-3d-globe',
    'js/maplibre-gl.js?v=5.24.0',
    'js/leaflet-maplibre-gl.js?v=0.1.4',
    'js/globe-base-layer.js?v=20261009-globe-raster-twin',
    'js/map-app.js?v=20261009-3d-globe'
].forEach(function (asset) {
    check('index.html loads ' + asset, indexHtml.includes(asset));
    check('sw.js precaches ' + asset, swJs.includes("'" + asset + "'"));
});
const cacheVersion = Number((swJs.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1] || 0);
check('the PWA shell was bumped for the new globe assets', cacheVersion >= 174, 'v' + cacheVersion);

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All 3D globe imagery-native-zoom checks passed.');
