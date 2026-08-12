// Regression test: a creator-deleted event must NOT be resurrected for other users.
//
// Background: events are stored in a shared Supabase `events` table AND cached
// per-user in localStorage. When the creator deletes an event the row is removed
// from `events`, but another user who still has the event in their own local cache
// used to re-insert it (resurrect it) on their next fetch: the merge in
// js/events.js treated any local-only event as "not yet synced" and called
// ensureEventOnServer() on it.
//
// Fix: deletes are recorded as tombstones in the `event_deletions` table.
// fetchEvents() loads those tombstones and purges deleted ids from local caches,
// so a deleted event is neither shown nor re-synced by any other client.
//
// Run: node test-event-delete-sync.js

'use strict';

const assert = require('assert');

// ── Stub environment ──
// localStorage-backed event cache plus a scripted Supabase client that serves
// both the `events` rows and the `event_deletions` tombstones, and records any
// upsert made by ensureEventOnServer() so we can assert nothing was re-synced.
const store = {
    events: [],          // remote `events` table (shared)
    deletions: [],       // remote `event_deletions` table (tombstones)
    localEvents: [],     // this client's localStorage cache
    upserted: []         // events this client tried to re-sync to the server
};

let eventsData = [];

function getLocalEvents() { return store.localEvents; }
function saveLocalEvents(arr) { store.localEvents = arr; }
function refreshEventsMap() {}

function ensureEventOnServer(ev) {
    store.upserted.push(ev && ev.id);
    return Promise.resolve({ ok: true });
}

const window = {
    supabaseClient: {
        from(table) {
            if (table === 'events') {
                return {
                    select() { return this; },
                    order() { return Promise.resolve({ error: null, data: store.events.slice() }); }
                };
            }
            if (table === 'event_deletions') {
                return {
                    select() {
                        return Promise.resolve({
                            error: null,
                            data: store.deletions.slice()
                        });
                    }
                };
            }
            throw new Error('unexpected table: ' + table);
        }
    }
};

// ── Logic copied verbatim from js/events.js (adapted to stubs) ──
async function fetchDeletedEventIds() {
    var deletedIds = {};
    try {
        if (window.supabaseClient) {
            var res = await window.supabaseClient.from('event_deletions').select('event_id');
            if (!res.error && Array.isArray(res.data)) {
                res.data.forEach(function (r) {
                    if (r && r.event_id) deletedIds[r.event_id] = true;
                });
            } else if (res && res.error) {
                console.warn('Supabase fetchDeletedEventIds error:', res.error);
            }
        }
    } catch (err) {
        console.warn('Supabase fetchDeletedEventIds error, ignoring tombstones:', err);
    }
    return deletedIds;
}

async function fetchEvents() {
    var remote = null;
    try {
        if (window.supabaseClient) {
            var res = await window.supabaseClient.from('events').select('*').order('event_date', { ascending: true });
            if (!res.error && Array.isArray(res.data)) {
                remote = res.data;
            } else if (res && res.error) {
                console.warn('Supabase fetchEvents error:', res.error);
            }
        }
    } catch (err) {
        console.warn('Supabase fetchEvents error, using local:', err);
    }
    var deletedIds = await fetchDeletedEventIds();
    var local = getLocalEvents();
    if (remote !== null) {
        var remoteIds = {};
        remote.forEach(function(e){ remoteIds[e.id] = true; });
        var merged = remote.slice();
        local.forEach(function(e){
            if (!e || !e.id) return;
            if (deletedIds[e.id]) return;
            if (!remoteIds[e.id]) {
                merged.push(e);
                ensureEventOnServer(e);
            }
        });
        merged = merged.filter(function (e) { return !(e && e.id && deletedIds[e.id]); });
        eventsData = merged;
        saveLocalEvents(eventsData);
    } else {
        eventsData = local.filter(function (e) { return !(e && e.id && deletedIds[e.id]); });
    }
    refreshEventsMap();
    return eventsData;
}

(async () => {
    const deletedEventId = 'del-event-0001';
    const survivingEventId = 'local-offline-0001';

    // Remote: only the surviving (still-valid) event remains on the server after
    // the creator deleted `deletedEventId`.
    store.events = [{ id: 'other-event-9', title: 'Someone else event' }];
    // The deleted event's tombstone is present.
    store.deletions = [{ event_id: deletedEventId }];
    // This client still has BOTH events cached locally (stale copies).
    store.localEvents = [
        { id: deletedEventId, title: 'Deleted by creator' },
        { id: survivingEventId, title: 'Created offline, never synced' }
    ];
    store.upserted = [];

    const result = await fetchEvents();

    // 1) The deleted event must not be shown to this user anymore.
    assert.strictEqual(
        result.some(e => e.id === deletedEventId),
        false,
        'deleted event must not appear in fetched events'
    );

    // 2) The deleted event must be purged from the local cache too.
    assert.strictEqual(
        store.localEvents.some(e => e.id === deletedEventId),
        false,
        'deleted event must be purged from localStorage cache'
    );

    // 3) Crucially, the client must NOT re-sync the deleted event back to the server.
    assert.strictEqual(
        store.upserted.includes(deletedEventId),
        false,
        'deleted event must never be re-synced (resurrected) to the server'
    );

    // 4) A genuine offline-created event (never synced) is still merged and synced.
    assert.strictEqual(
        result.some(e => e.id === survivingEventId),
        true,
        'a genuinely local-only event must still be kept'
    );
    assert.strictEqual(
        store.upserted.includes(survivingEventId),
        true,
        'a genuinely local-only event must still be synced to the server'
    );

    console.log('✅ test-event-delete-sync.js passed: creator-deleted events are purged and never resurrected.');
})().catch((err) => {
    console.error('❌ test-event-delete-sync.js failed:', err.message);
    process.exit(1);
});
