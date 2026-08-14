#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/map-app.js', 'utf8');
const parserMatch = source.match(
    /function parseCoordinateQuery\(value\) \{[\s\S]*?\n            \}/
);
assert(parserMatch, 'coordinate parser should exist in map-app.js');

const sandbox = { result: null };
vm.runInNewContext(
    parserMatch[0] + '\nresult = parseCoordinateQuery;',
    sandbox
);
const parse = sandbox.result;

assert.deepStrictEqual(
    JSON.parse(JSON.stringify(parse('45.123456, 24.654321'))),
    { lat: 45.123456, lon: 24.654321, valid: true },
    'parser accepts the exact latitude, longitude format copied from pins'
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(parse('  -45.5, +124.25  '))),
    { lat: -45.5, lon: 124.25, valid: true },
    'parser accepts signed decimal coordinates and surrounding whitespace'
);
assert.strictEqual(parse('90.000001, 24.000000').valid, false, 'latitude above 90 is rejected');
assert.strictEqual(parse('45.000000, -180.000001').valid, false, 'longitude below -180 is rejected');
assert.strictEqual(parse('Brașov'), null, 'place names are not mistaken for coordinates');
assert.strictEqual(parse('45.123456 24.654321'), null, 'the pin-format comma separator is required');
assert.strictEqual(parse('45,123, 24,654'), null, 'locale decimal commas are not confused with the pin format');

assert(
    /var coordinateItem = coordinateSearchItem\(searchTerm\);[\s\S]*?displaySearchResults\(\[coordinateItem\]/.test(source),
    'coordinate results should bypass the remote place-name data source'
);
assert(
    /A pasted pin coordinate should work immediately on Enter/.test(source) &&
    /selectResult\(coordinateItem\)/.test(source),
    'pressing Enter should immediately select a valid coordinate'
);
assert(
    /if \(parseCoordinateQuery\(val\)\) \{\s*doSearch\(val\);/.test(source),
    'pasting coordinates should render a result without the place-search debounce'
);

const html = fs.readFileSync('index.html', 'utf8');
assert(
    /id="mapSearchInput"[^>]+placeholder="Search place or coordinates…"/.test(html),
    'the search input should advertise coordinate search'
);

console.log('✓ Coordinate search tests passed');
