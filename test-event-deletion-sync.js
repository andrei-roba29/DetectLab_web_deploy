// Regression test for the event deletion sync issue.
//
// A browser caches remotely downloaded events in `detectlab_events`. Before this
// fix, when the server removed an event, another user's stale cache was merged
// back in and automatically upserted — effectively resurrecting the event.
//
// Run: node test-event-deletion-sync.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeLocalStorage() {
    const data = Object.create(null);
    return {
        getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
        setItem(key, value) { data[key] = String(value); },
        removeItem(key) { delete data[key]; }
    };
}

function makeSupabase(server) {
    function chain(table) {
        const query = { table, filters: {}, mode: 'select', payload: null };
        const api = {
            select() { query.mode = 'select'; return api; },
            upsert(rows) { query.mode = 'upsert'; query.payload = rows; return api; },
            eq(column, value) { query.filters[column] = value; return api; },
            in() { return api; },
            gt() { return api; },
            lte() { return api; },
            order() { return api; },
            limit() { return api; },
            then(resolve, reject) {
                try {
                    if (query.mode === 'upsert') {
                        server.upserts.push(query.payload[0]);
                        server.events.push(query.payload[0]);
                        resolve({ data: query.payload, error: null });
                        return;
                    }
                    let rows = table === 'events' ? server.events.slice() : [];
                    Object.keys(query.filters).forEach(function (column) {
                        rows = rows.filter(function (row) { return row[column] === query.filters[column]; });
                    });
                    resolve({ data: rows, error: null });
                } catch (err) { reject(err); }
            }
        };
        return api;
    }
    return { from(table) { return chain(table); } };
}

function loadEvents(server, storage) {
    const win = {
        crypto: { randomUUID: function () { return 'test-id'; } },
        _authUser: function () { return { id: 'user-1', name: 'User' }; },
        _currentLang: function () { return 'en'; },
        supabaseClient: makeSupabase(server),
        addEventListener: function () {}
    };
    const document = {
        addEventListener: function () {},
        getElementById: function () { return null; },
        querySelectorAll: function () { return []; },
        querySelector: function () { return null; },
        createElement: function () { return { style: {}, addEventListener: function () {}, appendChild: function () {} }; },
        body: { appendChild: function () {} }
    };
    const sandbox = {
        window: win,
        document,
        localStorage: storage,
        console,
        Date,
        Math,
        JSON,
        Promise,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Error,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        alert: function () {}
    };
    sandbox.crypto = win.crypto;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/events.js'), 'utf8'), sandbox);
    return win;
}

(async function () {
    const storage = makeLocalStorage();
    const server = { events: [], upserts: [] };
    const app = loadEvents(server, storage);
    const staleRemoteEvent = {
        id: 'remote-deleted-event', creator_id: 'other-user', creator_name: 'Other',
        title: 'Deleted remotely', latitude: 47, longitude: 23,
        event_date: new Date(Date.now() + 86400000).toISOString()
    };

    // 1) A stale cached event is removed when the remote event has gone.
    storage.setItem('detectlab_events', JSON.stringify([staleRemoteEvent]));
    let events = await app._fetchEvents();
    assert.deepStrictEqual(events, [], 'a deleted remote event must not survive only in another browser cache');
    assert.strictEqual(server.upserts.length, 0, 'a stale cached event must never be uploaded again');

    // 2) An explicitly pending, offline creation is preserved and retried.
    const offlineEvent = Object.assign({}, staleRemoteEvent, { id: 'offline-event', creator_id: 'user-1', title: 'Offline creation' });
    storage.setItem('detectlab_events', JSON.stringify([offlineEvent]));
    storage.setItem('detectlab_pending_event_sync', JSON.stringify([offlineEvent.id]));
    events = await app._fetchEvents();
    assert.strictEqual(events.length, 1, 'an explicitly pending offline creation should stay visible locally');
    assert.strictEqual(events[0].id, offlineEvent.id);

    // 3) Once a pending event is present remotely it is no longer pending. If
    // that remote row is later deleted, it cannot be resurrected by this cache.
    server.events = [offlineEvent];
    await app._fetchEvents();
    assert.deepStrictEqual(JSON.parse(storage.getItem('detectlab_pending_event_sync')), [], 'a synced event must be cleared from the pending-only list');
    server.events = [];
    server.upserts = [];
    events = await app._fetchEvents();
    assert.deepStrictEqual(events, [], 'a subsequently deleted event must be removed from the cached list');
    assert.strictEqual(server.upserts.length, 0, 'a subsequently deleted event must not be resurrected');

    console.log('✅ test-event-deletion-sync.js passed: stale caches cannot resurrect deleted events.');
})().catch(function (err) {
    console.error('❌ test-event-deletion-sync.js failed:', err.stack || err.message);
    process.exit(1);
});
