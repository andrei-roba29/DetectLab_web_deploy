// Regression test for ANONYMOUS EVENTS.
//
// Requirements exercised against the REAL js/events.js:
//   1. An anonymous event NEVER renders on the map for users who are neither
//      the creator nor a joined attendee.
//   2. The creator sees the marker with the same helmet symbol, translucent.
//   3. Joining happens instantly through the event code (no inquiry/approval):
//      window._joinAnonymousEvent() adds the user straight to event_attendees.
//   4. The creator receives a notification about the join.
//   5. After joining, the participant sees the translucent marker too.
//   6. A wrong code fails with an error and adds no attendee row.
//   7. ensureEventOnServer never falls back to the base payload for anonymous
//      events on an old schema (that would leak the event publicly).
//
// Run: node test-anonymous-events.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const EVENTS_JS = fs.readFileSync(path.join(__dirname, 'js/events.js'), 'utf8');

/* ── Shared in-memory Supabase ─────────────────────────────────────────── */

function createServer() {
    return {
        tables: {
            events: [],
            event_attendees: [],
            event_inquiries: [],
            event_notifications: [],
            event_chats: [],
            event_chat_messages: [],
            event_deletions: []
        },
        // When true, upserts on `events` that carry is_anonymous fail like a
        // live table missing the new columns (PGRST204).
        missingAnonymousColumns: false
    };
}

function matches(row, filters) {
    return filters.every(f => {
        if (f.op === 'eq') return row[f.col] === f.val;
        if (f.op === 'in') return f.val.includes(row[f.col]);
        if (f.op === 'gt') return row[f.col] > f.val;
        if (f.op === 'lte') return row[f.col] <= f.val;
        return true;
    });
}

function createSupabaseClient(server) {
    function query(table) {
        const filters = [];
        let limitN = null;

        const api = {
            _mode: 'select',
            _payload: null,
            select() { return api; },
            insert(rows) { api._mode = 'insert'; api._payload = rows; return api; },
            upsert(rows, opts) { api._mode = 'upsert'; api._payload = rows; api._opts = opts; return api; },
            update(patch) { api._mode = 'update'; api._payload = patch; return api; },
            delete() { api._mode = 'delete'; return api; },
            eq(col, val) { filters.push({ op: 'eq', col, val }); return api; },
            in(col, val) { filters.push({ op: 'in', col, val }); return api; },
            gt(col, val) { filters.push({ op: 'gt', col, val }); return api; },
            lte(col, val) { filters.push({ op: 'lte', col, val }); return api; },
            order() { return api; },
            limit(n) { limitN = n; return api; },
            single() { return api._run(true); },

            _run(single) {
                const rows = server.tables[table];
                if (!rows) {
                    return Promise.resolve({
                        data: null,
                        error: { code: '42P01', message: 'unknown table ' + table }
                    });
                }

                if (api._mode === 'insert' || api._mode === 'upsert') {
                    if (table === 'events' && server.missingAnonymousColumns) {
                        const list0 = Array.isArray(api._payload) ? api._payload : [api._payload];
                        if (list0.some(r => 'is_anonymous' in r || 'event_code' in r)) {
                            return Promise.resolve({
                                data: null,
                                error: { code: 'PGRST204', message: "Could not find the 'is_anonymous' column of 'events' in the schema cache" }
                            });
                        }
                    }
                    const list = Array.isArray(api._payload) ? api._payload : [api._payload];
                    list.forEach(rec => {
                        const key = (table === 'event_deletions' || table === 'event_chats') ? 'event_id' : 'id';
                        const idx = rows.findIndex(r => r[key] === rec[key]);
                        if (idx !== -1 && api._mode === 'upsert') rows[idx] = { ...rows[idx], ...rec };
                        else if (idx === -1) rows.push({ ...rec });
                    });
                    return Promise.resolve({ data: list, error: null });
                }

                if (api._mode === 'update') {
                    rows.forEach((r, i) => {
                        if (matches(r, filters)) rows[i] = { ...r, ...api._payload };
                    });
                    return Promise.resolve({ data: [], error: null });
                }

                if (api._mode === 'delete') {
                    server.tables[table] = rows.filter(r => !matches(r, filters));
                    return Promise.resolve({ data: [], error: null });
                }

                let out = rows.filter(r => matches(r, filters)).map(r => ({ ...r }));
                if (limitN !== null) out = out.slice(0, limitN);
                if (single) {
                    return Promise.resolve(out.length
                        ? { data: out[0], error: null }
                        : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
                }
                return Promise.resolve({ data: out, error: null });
            },

            then(res, rej) { return api._run(false).then(res, rej); }
        };
        return api;
    }

    return {
        from: query,
        rpc() { return Promise.resolve({ data: null, error: { message: 'rpc unavailable' } }); }
    };
}

/* ── A simulated browser "device" running the real events.js ───────────── */

function createDevice(server, user) {
    const storage = {};
    const localStorage = {
        getItem: k => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: k => { delete storage[k]; }
    };

    function noopEl(tag) {
        const children = new Map();
        const handlers = {};
        const attrs = {};
        const el = {
            tagName: tag || 'div',
            style: {},
            classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
            appendChild() {}, removeChild() {}, remove() {}, insertBefore() {},
            scrollIntoView() {}, focus() {}, blur() {},
            setAttribute(k, v) { attrs[k] = String(v); },
            getAttribute: k => (k in attrs ? attrs[k] : null),
            querySelectorAll: () => [],
            querySelector(sel) {
                if (!children.has(sel)) children.set(sel, noopEl());
                return children.get(sel);
            },
            addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
            async fire(type, ev) {
                for (const fn of handlers[type] || []) await fn(ev || { target: el });
            },
            click() { return el.fire('click'); },
            cloneNode() { return noopEl(tag); },
            textContent: '',
            innerHTML: '',
            disabled: false,
            value: ''
        };
        return el;
    }

    // ids the join bar uses; getElementById hands out stable stubs for them.
    const byId = new Map();
    const document = {
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, noopEl());
            return byId.get(id);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement(tag) { return noopEl(tag); },
        head: noopEl(),
        body: Object.assign(noopEl(), { classList: { add() {}, remove() {}, contains: () => false } }),
        addEventListener() {},
        hidden: false
    };

    /* Minimal Leaflet stub that records the markers actually added. */
    const addedMarkers = [];
    const L = {
        layerGroup() {
            const group = {
                addTo() { return group; },
                clearLayers() { addedMarkers.length = 0; },
                addLayer(m) { addedMarkers.push(m); },
                removeLayer() {},
                eachLayer() {}
            };
            return group;
        },
        divIcon(opts) { return { _dl_html: opts.html, options: opts }; },
        marker(latlng, opts) {
            return {
                _latlng: latlng,
                options: opts,
                bindPopup(fn) { this._popupFn = fn; return this; }
            };
        },
        DomEvent: { stop() {} }
    };
    const fakeMap = { closePopup() {}, hasLayer: () => false, removeLayer() {} };

    const alerts = [];
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document,
        localStorage,
        alert: msg => alerts.push(String(msg)),
        confirm: () => true,
        setTimeout: (fn, ms) => 1,
        setInterval: (fn, ms) => 1,
        clearInterval() {},
        clearTimeout() {},
        fetch: () => Promise.reject(new Error('no network')),
        MutationObserver: function () { this.observe = () => {}; },
        crypto: {
            randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) + Date.now().toString(16),
            getRandomValues(arr) {
                for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 0xffffffff);
                return arr;
            }
        },
        Blob: function () {},
        FileReader: function () {},
        L
    };

    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.addEventListener = () => {};
    sandbox.dispatchEvent = () => true;
    sandbox.supabaseClient = createSupabaseClient(server);
    sandbox._authUser = () => user;
    sandbox._currentLang = () => 'en';
    sandbox._dlMap = fakeMap;

    vm.createContext(sandbox);
    vm.runInContext(EVENTS_JS, sandbox, { filename: 'js/events.js' });

    // Wire the map so refreshEventsMap actually renders markers.
    sandbox._initEventsLayer(fakeMap);

    return { sandbox, storage, alerts, byId, addedMarkers };
}

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const CREATOR = { id: 'user-creator', email: 'creator@example.com', name: 'Creator' };
const GUEST = { id: 'user-guest', email: 'guest@example.com', name: 'Guest' };

const futureIso = days => new Date(Date.now() + days * 86400000).toISOString();

function seedAnonymousEvent(server, id = 'anon-event-1', code = 'K7KQ4D') {
    server.tables.events.push({
        id,
        creator_id: CREATOR.id,
        creator_name: CREATOR.name,
        creator_email: CREATOR.email,
        title: 'Secret dig',
        description: 'Invite only',
        latitude: 45.1,
        longitude: 24.2,
        event_date: futureIso(10),
        is_anonymous: true,
        event_code: code,
        created_at: new Date().toISOString()
    });
    return id;
}

function seedPublicEvent(server, id = 'public-event-1') {
    server.tables.events.push({
        id,
        creator_id: CREATOR.id,
        creator_name: CREATOR.name,
        creator_email: CREATOR.email,
        title: 'Open dig',
        description: 'Everyone welcome',
        latitude: 46.0,
        longitude: 25.0,
        event_date: futureIso(9),
        is_anonymous: false,
        event_code: null,
        created_at: new Date().toISOString()
    });
    return id;
}

const markerIds = device => device.addedMarkers.map(m => m._dlEventId);

/* ── Tests ─────────────────────────────────────────────────────────────── */

async function testVisibility() {
    const server = createServer();
    const anonId = seedAnonymousEvent(server);
    const publicId = seedPublicEvent(server);

    // Guest (not joined): only the public event may render.
    const guest = createDevice(server, GUEST);
    await guest.sandbox._fetchEvents();
    assert.ok(markerIds(guest).includes(publicId), 'guest must see the public event');
    assert.ok(!markerIds(guest).includes(anonId), 'guest must NOT see the anonymous event before joining');

    // Creator: sees both, and the anonymous one is translucent (opacity in icon html).
    const creator = createDevice(server, CREATOR);
    await creator.sandbox._fetchEvents();
    assert.ok(markerIds(creator).includes(anonId), 'creator must see their anonymous event');
    const anonMarker = creator.addedMarkers.find(m => m._dlEventId === anonId);
    const publicMarker = creator.addedMarkers.find(m => m._dlEventId === publicId);
    assert.ok(/opacity:\s*0\.45/.test(anonMarker.options.icon._dl_html), 'anonymous marker must be translucent');
    assert.ok(!/opacity:\s*0\.45/.test(publicMarker.options.icon._dl_html), 'public marker must be fully opaque');

    console.log('  ✔ visibility: hidden for outsiders, translucent for the creator');
}

async function testJoinByCode() {
    const server = createServer();
    const anonId = seedAnonymousEvent(server, 'anon-event-1', 'K7KQ4D');

    const guest = createDevice(server, GUEST);
    await guest.sandbox._fetchEvents();

    // Type the code (lowercase + spaces to exercise normalisation) and JOIN.
    guest.sandbox.document.getElementById('anonJoinInput').value = '  k7kq4d ';
    await guest.sandbox._joinAnonymousEvent();

    // Instant attendee row, no inquiry.
    const att = server.tables.event_attendees.filter(a => a.event_id === anonId && a.user_id === GUEST.id);
    assert.strictEqual(att.length, 1, 'join by code must insert exactly one attendee row');
    assert.strictEqual(server.tables.event_inquiries.length, 0, 'join by code must NOT create an inquiry');

    // Creator got notified.
    const notifs = server.tables.event_notifications.filter(n => n.user_id === CREATOR.id);
    assert.strictEqual(notifs.length, 1, 'creator must receive exactly one join notification');
    assert.ok(/joined your anonymous event/.test(notifs[0].message), 'notification must describe the join');
    assert.strictEqual(notifs[0].inquiry_id, null, 'join notification must not reference an inquiry');

    // The participant now sees the translucent marker.
    assert.ok(markerIds(guest).includes(anonId), 'joined participant must see the anonymous event');
    const m = guest.addedMarkers.find(x => x._dlEventId === anonId);
    assert.ok(/opacity:\s*0\.45/.test(m.options.icon._dl_html), 'participant marker must be translucent');

    // Joining again is rejected without duplicating rows or notifications.
    guest.sandbox.document.getElementById('anonJoinInput').value = 'K7KQ4D';
    await guest.sandbox._joinAnonymousEvent();
    assert.strictEqual(
        server.tables.event_attendees.filter(a => a.event_id === anonId && a.user_id === GUEST.id).length,
        1, 'second join must not duplicate the attendee row');
    assert.strictEqual(server.tables.event_notifications.filter(n => n.user_id === CREATOR.id).length,
        1, 'second join must not send another notification');
    assert.ok(/already attending/i.test(guest.sandbox.document.getElementById('anonJoinError').textContent),
        'second join must show the already-attending error');

    console.log('  ✔ join by code: instant attendee, creator notified, no inquiry, no duplicates');
}

async function testWrongCodeAndCreatorSelfJoin() {
    const server = createServer();
    seedAnonymousEvent(server, 'anon-event-1', 'K7KQ4D');

    const guest = createDevice(server, GUEST);
    await guest.sandbox._fetchEvents();
    guest.sandbox.document.getElementById('anonJoinInput').value = 'WRONG9';
    await guest.sandbox._joinAnonymousEvent();
    assert.strictEqual(server.tables.event_attendees.length, 0, 'wrong code must add no attendee');
    assert.ok(/no event found/i.test(guest.sandbox.document.getElementById('anonJoinError').textContent),
        'wrong code must show the not-found error');

    const creator = createDevice(server, CREATOR);
    await creator.sandbox._fetchEvents();
    creator.sandbox.document.getElementById('anonJoinInput').value = 'K7KQ4D';
    await creator.sandbox._joinAnonymousEvent();
    assert.strictEqual(server.tables.event_attendees.length, 0, 'creator must not join their own event');
    assert.ok(/creator of this event/i.test(creator.sandbox.document.getElementById('anonJoinError').textContent),
        'creator self-join must show the creator error');

    console.log('  ✔ wrong code rejected; creator cannot join their own event');
}

async function testNoPublicLeakOnOldSchema() {
    // Old server schema (no is_anonymous column): syncing an anonymous event
    // must FAIL rather than fall back to the base payload, because the base
    // payload would create a PUBLIC event visible on everyone's map.
    const server = createServer();
    server.missingAnonymousColumns = true;

    const creator = createDevice(server, CREATOR);
    // Seed a locally-created anonymous event (as openCreateEventModal would).
    creator.storage['detectlab_events'] = JSON.stringify([{
        id: 'local-anon-1',
        creator_id: CREATOR.id,
        creator_name: CREATOR.name,
        creator_email: CREATOR.email,
        title: 'Secret dig',
        latitude: 45.1,
        longitude: 24.2,
        event_date: futureIso(5),
        is_anonymous: true,
        event_code: 'SECRET',
        created_at: new Date().toISOString()
    }]);

    await creator.sandbox._fetchEvents();
    // Give the fire-and-forget re-upload a tick to run.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    assert.strictEqual(server.tables.events.length, 0,
        'anonymous event must NOT be uploaded through the base payload on an old schema');

    console.log('  ✔ no public leak: anonymous events are never synced via the base payload');
}

(async function main() {
    console.log('Anonymous events regression tests');
    await testVisibility();
    await testJoinByCode();
    await testWrongCodeAndCreatorSelfJoin();
    await testNoPublicLeakOnOldSchema();
    console.log('All anonymous event tests passed ✔');
})().catch(err => {
    console.error('\n✘ TEST FAILED');
    console.error(err);
    process.exit(1);
});
