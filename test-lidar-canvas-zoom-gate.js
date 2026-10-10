// Regression checks for the zoom gate on canvas-drawn LIDAR sources.
// NL AHN, DK DHM, NO Hoydedata and the ArcGIS ImageServer grids draw their own
// tiles (a custom createTile), so they cannot become globe twins. On the live
// 3D globe they are shown only from zoom 11, and a localised "zoom in more"
// message appears while an enabled one is below that zoom. These checks read the
// source and the translation table. The behaviour (no zoom jump, no draws below
// the gate, message follows zoom, enablement and language) was checked in the
// browser harness: see GLOBE_COUNTRY_GATE.md, "Zoom gate for canvas LIDAR".
// Run: node test-lidar-canvas-zoom-gate.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const mapApp = fs.readFileSync(path.join(root, 'js/map-app.js'), 'utf8');
const translationsSource = fs.readFileSync(path.join(root, 'js/translations.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

// ── Translations: the message exists, and is not English, in every language ──
function translationTable(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /const translations = \{/.test(l));
  assert.ok(start >= 0, 'translations object found');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{8}\};\s*$/.test(lines[i])) { end = i; break; }
  }
  assert.ok(end > start, 'translations object closes');
  const literal = lines.slice(start, end + 1).join('\n').replace(/^\s*const translations = /, 'translations = ');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(literal.replace(/;\s*$/, '') + ';', ctx);
  return ctx.translations;
}

const table = translationTable(translationsSource);
const languages = Object.keys(table);
assert.equal(languages.length, 25, 'the app ships 25 language tables');
for (const lang of languages) {
  const text = table[lang] && table[lang].lidar_zoom_in_more;
  assert.equal(typeof text, 'string', lang + ' has lidar_zoom_in_more');
  assert.ok(text.trim().length > 0, lang + ' message is not empty');
  assert.ok(!/'/.test(text), lang + ' message has no quote that would break the literal');
  if (lang !== 'en') assert.notEqual(text, table.en.lidar_zoom_in_more, lang + ' message is translated, not English');
}
console.log('✓ lidar_zoom_in_more is translated in all ' + languages.length + ' languages');

// ── Gate: the threshold, the wrapper and the wiring ──
assert.match(mapApp, /var LIDAR_CANVAS_MIN_ZOOM = 11;/, 'gate threshold is zoom 11');

function functionText(name) {
  const re = new RegExp('\\n(\\s*)function ' + name + '\\(([^)]*)\\) \\{');
  const m = re.exec(mapApp);
  assert.ok(m, name + ' is defined in map-app.js');
  const indent = m[1];
  const rest = mapApp.slice(m.index + m[0].length);
  const close = rest.indexOf('\n' + indent + '}\n');
  assert.ok(close >= 0, name + ' closes at its own indentation');
  return mapApp.slice(m.index, m.index + m[0].length + close + indent.length + 2);
}

const gateFn = functionText('_lidarApplyCanvasZoomGate');
assert.ok(!/minZoom/.test(gateFn),
  'the gate must not touch options.minZoom: Leaflet raises the map to the smallest layer minZoom');
assert.match(gateFn, /layer\.createTile = function \(coords, done\)/, 'the gate wraps createTile');
assert.match(gateFn, /coords\.z < LIDAR_CANVAS_MIN_ZOOM/, 'below the gate a tile is a placeholder');
assert.match(gateFn, /_detectlabCanvasZoomGate = true/, 'the gated layer is marked');
assert.match(functionText('_lidarIsCanvasSource'), /layer\.createTile !== base/, 'canvas sources are those with a custom createTile');
assert.match(functionText('_globeIsLive'), /globe\._map === map/, 'the gate applies only with a live globe on this map');
console.log('✓ gate wraps createTile, leaves minZoom alone, and needs a live globe');

const twinFn = functionText('_lidarGlobeTwin');
assert.match(twinFn, /return _lidarApplyCanvasZoomGate\(layer\);/, 'every LIDAR build passes through the gate');
const buildCalls = mapApp.split('_lidarGlobeTwin(_buildLidarLeafletLayer(').length - 1;
assert.equal(buildCalls, 3, 'the three LIDAR build paths still go through _lidarGlobeTwin');
console.log('✓ the three LIDAR build paths pass through _lidarGlobeTwin');

// ── Message: one element, shown only below the gate, refreshed on zoom and toggles ──
assert.match(mapApp, /_lidarZoomMsgEl\.id = 'lidarZoomGateMsg';/, 'message element has a stable id');
assert.match(mapApp, /function _lidarZoomGateNeeded\(\) \{\s*\n\s*if \(!_lidarVisible \|\| _lidarCanvasZoomOpen\(\)\) return false;/,
  'message is needed only with the master switch on and below the gate');
assert.match(mapApp, /map\.on\('zoomend', _updateLidarZoomGateMessage\);/, 'message follows zoom');
const toggleHooks = mapApp.split('_updateLidarZoomGateMessage();').length - 1;
assert.ok(toggleHooks >= 2, 'message is refreshed by the master toggle and the sub-layer toggle (found ' + toggleHooks + ')');
assert.match(functionText('_hookLidarZoomGateLanguage'), /window\.setLang = function \(lang\) \{ _sl\.apply\(this, arguments\); _updateLidarZoomGateMessage\(\); \};/, 'message follows language changes');
assert.match(functionText('_updateLidarZoomGateMessage'), /^\s*_hookLidarZoomGateLanguage\(\);/m, 'the language hook is installed on first use');
assert.match(mapApp, /var tr = \(typeof translations !== 'undefined'\)/, 'text lookup is defensive when the table is absent');
console.log('✓ the message follows zoom, enablement and language');

// ── Shipping: the new map-app is loaded and precached ──
const mapAppTag = indexHtml.match(/js\/map-app\.js\?v=([0-9a-z-]+)/);
assert.ok(mapAppTag, 'index.html loads map-app.js with a version');
assert.ok(swJs.includes('js/map-app.js?v=' + mapAppTag[1]), 'the service worker precaches the loaded map-app version');
assert.match(swJs, /const CACHE_NAME = 'detectlab-v(1[7-9]\d|[2-9]\d\d)-/, 'cache name moved on with this change');
console.log('✓ index.html and sw.js ship this version of map-app.js');

console.log('All LIDAR canvas zoom-gate checks passed.');
