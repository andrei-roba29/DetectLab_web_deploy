#!/usr/bin/env node
'use strict';

// Behavioural checks for the physical-distance Patrimoniu clustering helper.
// Run with: node test-patrimoniu-clustering.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console, Math, Number, String, Object, Array, isFinite };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/patrimoniu-clustering.js'), 'utf8'), sandbox);

const C = sandbox.DetectLabPatrimoniuClustering;
assert.ok(C, 'the clustering helper is exported');

const expectedDistances = { 5: 5, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1, 11: 0, 12: 0, 14: 0 };
for (const [zoom, distance] of Object.entries(expectedDistances)) {
    assert.strictEqual(C.getDistanceKm(Number(zoom)), distance, `z${zoom} distance`);
}

const index = new C.SpatialIndex(2500);
function add(lat, lng, id) {
    const record = { latlng: { lat, lng }, id };
    index.add(record);
    return record;
}

// About 2.2 km apart: together at z6, but not at z7's 4 km threshold?  The
// second pair is deliberately just over 4 km so the z7 result is meaningful.
const a = add(46.0000, 23.0000, 'a');
const b = add(46.0200, 23.0000, 'b');
const c = add(46.0600, 23.0000, 'c');
const records = index.records;

assert.strictEqual(C.clusterRecords(records, 6, index).filter(x => x.isCluster).length, 1,
    'z6 groups the close pair');
assert.strictEqual(C.clusterRecords(records, 6, index).find(x => x.isCluster).count, 3,
    'connected sites form one grouped pin at z6');
assert.strictEqual(C.clusterRecords(records, 11, index).length, 3,
    'z11 shows every site individually');

// A pair separated by approximately 4.45 km must be separate at z9 (2 km)
// and grouped at z7 (4 km) only if its actual projected distance is <= 4 km;
// use a fresh exact 3 km pair for the latter assertion.
const closeAtZ7 = new C.SpatialIndex(2500);
closeAtZ7.add({ latlng: { lat: 46, lng: 24 }, id: 'd' });
closeAtZ7.add({ latlng: { lat: 46.027, lng: 24 }, id: 'e' });
assert.strictEqual(C.clusterRecords(closeAtZ7.records, 7, closeAtZ7).length, 1,
    'z7 groups sites within 4 km');
assert.strictEqual(C.clusterRecords(closeAtZ7.records, 9, closeAtZ7).length, 2,
    'z9 separates sites beyond 2 km');

console.log('✓ Patrimoniu physical-distance clustering tests passed');
