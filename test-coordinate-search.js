#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/map-app.js', 'utf8');
const blockMatch = source.match(
    /\/\/ <dl-coordinate-parser>\n([\s\S]*?)\n            \/\/ <\/dl-coordinate-parser>/
);
assert(blockMatch, 'the coordinate parser block should exist in map-app.js');

// The parser block is self-contained (no DOM/Leaflet globals); `map` is only
// consulted for short Plus Codes, so a minimal stub is enough here.
const sandbox = {
    window: {},
    map: { getCenter: function () { return { lat: 44.43225, lng: 26.10626 }; } },
    result: null
};
vm.runInNewContext(
    blockMatch[1] + '\nresult = { parseCoordinateQuery: parseCoordinateQuery, olcEncode: olcEncode };',
    sandbox
);
const parse = sandbox.result.parseCoordinateQuery;
// Objects created inside the vm sandbox have the sandbox's prototypes, so
// deep comparisons go through a JSON round-trip first.
function plainParse(v) {
    var r = parse(v);
    return r === null || r === undefined ? null : JSON.parse(JSON.stringify(r));
}

function approx(actual, expected, tol, msg) {
    assert(typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= tol,
        msg + ' (got ' + actual + ', want ' + expected + ' ±' + tol + ')');
}

// ————— decimal degrees, the exact format DetectLab pins show and copy —————
assert.deepStrictEqual(
    plainParse('45.123456, 24.654321'),
    { lat: 45.123456, lon: 24.654321, valid: true },
    'parser accepts the exact latitude, longitude format copied from pins'
);
assert.deepStrictEqual(
    plainParse('  -45.5, +124.25  '),
    { lat: -45.5, lon: 124.25, valid: true },
    'parser accepts signed decimal coordinates and surrounding whitespace'
);
assert.strictEqual(parse('90.000001, 24.000000').valid, false, 'latitude above 90 is rejected');
assert.strictEqual(parse('45.000000, -180.000001').valid, false, 'longitude below -180 is rejected');
assert.strictEqual(parse('Brașov'), null, 'place names are not mistaken for coordinates');
assert.strictEqual(parse('45'), null, 'one bare number is not a coordinate');
assert.strictEqual(parse('45°34\'12"'), null, 'a lone half of a DMS pair is not a coordinate');

// ————— any separator the user may paste —————
['45.123456 24.654321', '45.123456; 24.654321', '45.123456 | 24.654321',
 '[45.123456, 24.654321]', '(45.123456, 24.654321)', '"45.123456, 24.654321"',
 '45.123456,\n24.654321'].forEach(function (s) {
    assert.deepStrictEqual(plainParse(s), { lat: 45.123456, lon: 24.654321, valid: true },
        'any separator/punctuation wrapper works: ' + JSON.stringify(s));
});
// Trailing altitudes (GPS apps, geo-URLs) are tolerated and ignored.
assert.deepStrictEqual(plainParse('45.123456, 24.654321, 220'),
    { lat: 45.123456, lon: 24.654321, valid: true }, 'trailing altitude is ignored');

// ————— Romanian locale decimal comma (45,123456) —————
assert.deepStrictEqual(plainParse('45,123, 24,654'), { lat: 45.123, lon: 24.654, valid: true },
    'decimal commas are understood in the Romanian locale format');
assert.deepStrictEqual(plainParse('45,123456 24,654321'), { lat: 45.123456, lon: 24.654321, valid: true },
    'space-separated decimal commas are understood too');

// ————— hemisphere letters (in any position) —————
assert.deepStrictEqual(plainParse('45.123456N, 24.654321E'),
    { lat: 45.123456, lon: 24.654321, valid: true }, 'trailing hemisphere letters');
assert.deepStrictEqual(plainParse('N 45.123456, E 24.654321'),
    { lat: 45.123456, lon: 24.654321, valid: true }, 'leading hemisphere letters');
assert.deepStrictEqual(plainParse('45.5° S, 124.25° W'),
    { lat: -45.5, lon: -124.25, valid: true }, 'degree sign + hemisphere letters');
assert.deepStrictEqual(plainParse('45.123456s, 24.654321e'),
    { lat: -45.123456, lon: 24.654321, valid: true }, 'lowercase hemisphere letters');
assert.deepStrictEqual(plainParse('24.654321E, 45.123456N'),
    { lat: 45.123456, lon: 24.654321, valid: true },
    'hemisphere letters fix a lon-first paste automatically');
assert.deepStrictEqual(plainParse('45.123456, -24.654321'),
    { lat: 45.123456, lon: -24.654321, valid: true }, 'signed longitude without hemisphere');

// ————— degrees / minutes / seconds and degrees decimal minutes —————
const DMS_LAT = 45 + 34 / 60 + 12 / 3600;
const DMS_LON = 24 + 40 / 60 + 15 / 3600;
['45°34\'12"N 24°40\'15"E',
 '45°34\'12"N, 24°40\'15"E',
 '45:34:12N 24:40:15E',
 '45 34 12 N 24 40 15 E',
 '45 34 12 N, 24 40 15 E',
 '45-34-12N 24-40-15E',
 '45°34′12″N 24°40′15″E',
 '45 degrees 34 minutes 12 seconds N, 24 degrees 40 minutes 15 seconds E'
].forEach(function (s) {
    const r = parse(s);
    assert(r && r.valid === true, 'DMS in any punctuation works: ' + JSON.stringify(s));
    approx(r.lat, DMS_LAT, 1e-9, 'DMS latitude of ' + JSON.stringify(s));
    approx(r.lon, DMS_LON, 1e-9, 'DMS longitude of ' + JSON.stringify(s));
});
approx(parse('45°34\'12.5"N 24°40\'15.5"E').lat, DMS_LAT + 0.5 / 3600, 1e-9,
    'fractional seconds are supported');
const DDM_LAT = 45 + 34.2 / 60, DDM_LON = 24 + 40.25 / 60;
['45°34.2\'N 24°40.25\'E', '45 34.2 N 24 40.25 E', 'N 45°34.2\' E 024°40.25\'']
    .forEach(function (s) {
        const r = parse(s);
        assert(r && r.valid === true, 'DDM works: ' + JSON.stringify(s));
        approx(r.lat, DDM_LAT, 1e-6, 'DDM latitude of ' + JSON.stringify(s));
        approx(r.lon, DDM_LON, 1e-6, 'DDM longitude of ' + JSON.stringify(s));
    });
assert.strictEqual(parse('45°70\'N, 24°10\'E').valid, false, 'minutes of 60 or more are rejected');

// ————— GPS / NMEA compact forms (ddmm.mmmm and ddmmss) —————
const nmea = parse('4534.2222N 02440.2222E');
assert(nmea && nmea.valid, 'raw GPS ddmm.mmmm is accepted');
approx(nmea.lat, 45 + 34.2222 / 60, 1e-9, 'NMEA latitude');
approx(nmea.lon, 24 + 40.2222 / 60, 1e-9, 'NMEA longitude');
const nmea2 = parse('453412 0244015');
assert(nmea2 && nmea2.valid, 'GPS ddmmss compact form is accepted');
approx(nmea2.lat, DMS_LAT, 1e-9, 'ddmmss latitude');
approx(nmea2.lon, DMS_LON, 1e-9, 'ddmmss longitude');

// ————— labeled pairs, either order —————
assert.deepStrictEqual(plainParse('lat 45.123456, lon 24.654321'),
    { lat: 45.123456, lon: 24.654321, valid: true }, 'lat/lon labels');
assert.deepStrictEqual(plainParse('longitude: 24.654321 latitude: 45.123456'),
    { lat: 45.123456, lon: 24.654321, valid: true },
    'labels fix the order even when longitude is pasted first');
assert.deepStrictEqual(plainParse('latitude = 45.123456, longitude = 24.654321'),
    { lat: 45.123456, lon: 24.654321, valid: true }, 'full label words with =');

// ————— UTM (WGS 84), cross-checked against independently published values —————
const utm = parse('35T 428867 4920272');
assert(utm && utm.valid === true, 'UTM zone/band + easting + northing is accepted');
approx(utm.lat, 44.43225, 3e-4, 'UTM Bucharest latitude');
approx(utm.lon, 26.10626, 3e-4, 'UTM Bucharest longitude');
const utm2 = parse('UTM 18T 585631.73 4511326.93');
assert(utm2 && utm2.valid, 'UTM with label and decimals works');
approx(utm2.lat, 40.748441, 3e-4, 'UTM Empire State Building latitude');
approx(utm2.lon, -73.985664, 3e-4, 'UTM Empire State Building longitude');
assert.strictEqual(parse('61T 428867 4920272').valid, false, 'UTM zone above 60 is rejected');
assert.strictEqual(parse('35Z 428867 4920272'), null, 'a nonexistent UTM band letter is not UTM');

// ————— Plus Codes (Open Location Code), decoded offline —————
// The reference anchor from the Open Location Code documentation:
// encode(47.000000, 8.000000) === "8FVC2222+22", whose area is centred on
// (47.0000625, 8.0000625).
assert.strictEqual(sandbox.result.olcEncode(47.0, 8.0), '8FVC2222+22',
    'plus-code encoder matches the reference example');
const olc = parse('8FVC2222+22');
assert(olc && olc.valid === true, 'a full plus code is accepted');
approx(olc.lat, 47.0000625, 1e-9, 'plus-code center latitude');
approx(olc.lon, 8.0000625, 1e-9, 'plus-code center longitude');
// Bucharest plus code as published by an external coordinate lookup; the
// decoded cell center may sit up to half a cell (~7 m) away from the point.
const olc2 = parse('8GP8C4J4+WG');
assert(olc2 && olc2.valid, 'plus code without surrounding text is accepted');
approx(olc2.lat, 44.43225, 1.5e-4, 'plus-code Bucharest latitude');
approx(olc2.lon, 26.10626, 1.5e-4, 'plus-code Bucharest longitude');
// A short code is completed relative to the current map center (the sandbox
// stub above is parked on Bucharest), mirroring Google Maps behaviour.
const olcShort = parse('C4J4+WG');
assert(olcShort && olcShort.valid, 'short plus code is recovered from the map center');
approx(olcShort.lat, 44.43225, 1.5e-4, 'recovered short-code latitude');
approx(olcShort.lon, 26.10626, 1.5e-4, 'recovered short-code longitude');

// ————— place names and junk keep falling through to the place search —————
assert.strictEqual(parse('Cluj-Napoca'), null, 'hyphenated place names stay searches');
assert.strictEqual(parse('Sibiu'), null, 'hemisphere letters inside a word do not count');
assert.strictEqual(parse('45 High Street'), null, 'addresses stay searches');
assert.strictEqual(parse('45.123456, 24.654321, 400 m'), null, 'units still look textual');
assert.strictEqual(parse('8VR7+XYZ'), null, 'non-alphabet characters are not plus codes');
assert.deepStrictEqual(plainParse('45.123456N, 24.654321E, 220'),
    { lat: 45.123456, lon: 24.654321, valid: true },
    'a trailing altitude is ignored even next to hemisphere letters');

// ————— wiring inside map-app.js —————
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
assert(
    /Invalid coordinates\. Latitude must be −90 to 90, longitude −180 to 180, minutes\/seconds below 60\./.test(source),
    'the invalid-coordinates message should explain the ranges and sexagesimal rule'
);

const html = fs.readFileSync('index.html', 'utf8');
assert(
    /id="mapSearchInput"[^>]+placeholder="Search place or coordinates…"/.test(html),
    'the search input should advertise coordinate search'
);
assert(
    /id="mapSearchInput"[^>]+aria-label="[^"]*degrees-minutes-seconds[^"]*"/.test(html),
    'the search input should advertise the supported coordinate formats for assistive tech'
);

console.log('✓ Coordinate search tests passed');
