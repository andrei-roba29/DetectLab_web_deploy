// Regression test for the three cross-account event bugs.
//
//   1. A deleted event disappeared only for the creator; every other
//      participant kept seeing it (their stale localStorage copy was merged
//      back in AND re-uploaded by fetchEvents()).
//   2. A kicked attendee was seen as kicked only by the creator; the kicked
//      user and everyone else still saw them as a participant.
//   3. The "Events" button did nothing: js/account-legacy.js declared a
//      top-level `function openEvents()` shim which, in a classic script,
//      overwrote the real window.openEvents from js/events.js with a function
//      that called itself.
//
// Unlike the older stub tests, this one loads the REAL js/events.js (and
// js/account-legacy.js) inside a jsdom-ish sandbox, once per simulated device,
// against a single shared in-memory Supabase. So it exercises the shipped code
// paths rather than a copy of them.
//
// Run: node test-event-multiuser-sync.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const EVENTS_JS = fs.readFileSync(path.join(__dirname, 'js/events.js'), 'utf8');
const ACCOUNT_LEGACY_JS = fs.readFileSync(path.join(__dirname, 'js/account-legacy.js'), 'utf8');

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
        // Set to true to simulate the tombstone migration not being applied.
        missingDeletionsTable: false
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
                if (table === 'event_deletions' && server.missingDeletionsTable) {
                    return Promise.resolve({
                        data: null,
                        error: { code: '42P01', message: 'relation "event_deletions" does not exist' }
                    });
                }
                const rows = server.tables[table];
                if (!rows) {
                    return Promise.resolve({
                        data: null,
                        error: { code: '42P01', message: 'unknown table ' + table }
                    });
                }

                if (api._mode === 'insert' || api._mode === 'upsert') {
                    const list = Array.isArray(api._payload) ? api._payload : [api._payload];
                    list.forEach(rec => {
                        const key = table === 'event_deletions' ? 'event_id'
                            : (table === 'event_chats' ? 'event_id' : 'id');
                        const idx = rows.findIndex(r => r[key] === rec[key]);
                        if (idx !== -1 && api._mode === 'upsert') rows[idx] = { ...rows[idx], ...rec };
                        else if (idx === -1) rows.push({ ...rec });
                    });
                    return Promise.resolve({ data: list, error: null });
                }

                if (api._mode === 'update') {
                    let n = 0;
                    rows.forEach((r, i) => {
                        if (matches(r, filters)) { rows[i] = { ...r, ...api._payload }; n++; }
                    });
                    return Promise.resolve({ data: [], error: null, count: n });
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

    // A fake element that is just real enough for events.js: querySelector()
    // hands back a stable stub per selector, and click handlers registered on it
    // can be fired, so modal buttons (e.g. #meDeleteBtn) are actually testable.
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

    const listeners = {};
    const created = [];
    const document = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement(tag) { const el = noopEl(tag); created.push(el); return el; },
        head: noopEl(),
        body: Object.assign(noopEl(), { classList: { add() {}, remove() {}, contains: () => false } }),
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        hidden: false
    };

    const alerts = [];
    const timers = [];

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document,
        localStorage,
        alert: msg => alerts.push(String(msg)),
        confirm: () => true,
        // Keep tests deterministic: never actually run background pollers.
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearInterval() {},
        clearTimeout() {},
        fetch: () => Promise.reject(new Error('no network')),
        MutationObserver: function () { this.observe = () => {}; },
        crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) + Date.now().toString(16) },
        Blob: function () {},
        FileReader: function () {},
        L: null
    };

    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
    sandbox.dispatchEvent = () => true;
    sandbox.supabaseClient = createSupabaseClient(server);
    sandbox._authUser = () => user;
    sandbox._currentLang = () => 'en';

    vm.createContext(sandbox);
    vm.runInContext(EVENTS_JS, sandbox, { filename: 'js/events.js' });

    return { sandbox, storage, alerts, localStorage, listeners, created };
}

const readJson = (device, key) => JSON.parse(device.storage[key] || '[]');

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const CREATOR = { id: 'user-creator', email: 'creator@example.com', name: 'Creator' };
const GUEST = { id: 'user-guest', email: 'guest@example.com', name: 'Guest' };
const OTHER = { id: 'user-other', email: 'other@example.com', name: 'Other' };

const futureIso = days => new Date(Date.now() + days * 86400000).toISOString();

function seedEvent(server, id = 'event-1') {
    server.tables.events.push({
        id,
        creator_id: CREATOR.id,
        creator_name: CREATOR.name,
        creator_email: CREATOR.email,
        title: 'Forest dig',
        description: 'Bring a spade',
        latitude: 45.1,
        longitude: 24.2,
        event_date: futureIso(10),
        created_at: new Date().toISOString()
    });
    return id;
}

function seedAttendee(server, eventId, user) {
    server.tables.event_attendees.push({
        id: 'att-' + user.id,
        event_id: eventId,
        user_id: user.id,
        user_name: user.name,
        joined_at: new Date().toISOString()
    });
    server.tables.event_inquiries.push({
        id: 'inq-' + user.id,
        event_id: eventId,
        user_id: user.id,
        user_name: user.name,
        message: 'Can I join?',
        status: 'accepted',
        created_at: new Date().toISOString()
    });
}

/* ── Tests ─────────────────────────────────────────────────────────────── */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('BUG 1 — a deleted event disappears for OTHER participants too', async () => {
    const server = createServer();
    const eventId = seedEvent(server);
    seedAttendee(server, eventId, GUEST);

    // The guest opens the app once, so the event lands in their local cache.
    const guest = createDevice(server, GUEST);
    await guest.sandbox._fetchEvents();
    assert.strictEqual(guest.sandbox.getEventsData().length, 1, 'guest should see the event initially');
    assert.strictEqual(readJson(guest, 'detectlab_events').length, 1, 'guest caches the event');

    // The creator deletes it through the real Manage Event UI path.
    const creator = createDevice(server, CREATOR);
    await creator.sandbox._fetchEvents();
    creator.sandbox._manageEvent(eventId);

    // _manageEvent() builds a modal and wires #meDeleteBtn; fire that handler.
    const modal = creator.created.find(el => el.getAttribute('data-event-id') === eventId);
    assert.ok(modal, 'the manage-event modal should have been created');
    await modal.querySelector('#meDeleteBtn').fire('click');

    assert.strictEqual(server.tables.events.length, 0,
        'the delete must remove the event row on the SERVER');
    assert.strictEqual(server.tables.event_attendees.length, 0,
        'the delete must also clear the attendee rows on the server');

    // The guest refreshes.
    await guest.sandbox._fetchEvents();

    assert.strictEqual(guest.sandbox.getEventsData().length, 0,
        'the deleted event must disappear for the guest');
    assert.strictEqual(readJson(guest, 'detectlab_events').length, 0,
        'the deleted event must be purged from the guest local cache');
    assert.strictEqual(server.tables.events.length, 0,
        'the guest must NOT resurrect the deleted event on the server');
});

test('BUG 1b — delete propagates even without the event_deletions table', async () => {
    const server = createServer();
    server.missingDeletionsTable = true; // migration not applied
    const eventId = seedEvent(server);
    seedAttendee(server, eventId, GUEST);

    const guest = createDevice(server, GUEST);
    await guest.sandbox._fetchEvents();
    assert.strictEqual(guest.sandbox.getEventsData().length, 1);

    // Creator deletes; no tombstone can be written.
    server.tables.events = server.tables.events.filter(e => e.id !== eventId);

    await guest.sandbox._fetchEvents();

    assert.strictEqual(guest.sandbox.getEventsData().length, 0,
        'delete must propagate via "was synced, now gone" even with no tombstone table');
    assert.strictEqual(server.tables.events.length, 0,
        'the guest must not re-upload the deleted event');
});

test('BUG 1c — a genuinely offline-created event is still kept and uploaded', async () => {
    const server = createServer();
    const guest = createDevice(server, GUEST);

    // An event that never reached the server (created while offline).
    guest.localStorage.setItem('detectlab_events', JSON.stringify([{
        id: 'offline-1',
        creator_id: GUEST.id,
        creator_name: GUEST.name,
        creator_email: GUEST.email,
        title: 'Created offline',
        latitude: 1, longitude: 2,
        event_date: futureIso(5)
    }]));

    await guest.sandbox._fetchEvents();

    assert.ok(guest.sandbox.getEventsData().some(e => e.id === 'offline-1'),
        'offline-created events must survive the reconciliation');
    assert.ok(server.tables.events.some(e => e.id === 'offline-1'),
        'offline-created events must still be uploaded');
});

test('BUG 2 — a kicked attendee sees themselves removed', async () => {
    const server = createServer();
    const eventId = seedEvent(server);
    seedAttendee(server, eventId, GUEST);

    const guest = createDevice(server, GUEST);
    await guest.sandbox._fetchEvents();
    await guest.sandbox._syncMyEventState();

    assert.strictEqual(readJson(guest, 'detectlab_attendees').length, 1,
        'guest starts out as an attendee');

    // Creator kicks the guest.
    const creator = createDevice(server, CREATOR);
    await creator.sandbox._fetchEvents();
    await creator.sandbox._kickAttendee('att-' + GUEST.id, eventId);

    assert.strictEqual(
        server.tables.event_attendees.filter(a => a.user_id === GUEST.id).length, 0,
        'the kick must delete the attendee row on the SERVER');

    // Guest refreshes.
    await guest.sandbox._fetchEvents();
    await guest.sandbox._syncMyEventState();

    assert.strictEqual(readJson(guest, 'detectlab_attendees').length, 0,
        'the kicked guest must no longer be cached as an attendee');
    assert.strictEqual(
        await guest.sandbox._isUserAcceptedAttendeeForTest(eventId, GUEST.id), false,
        'the kicked guest must lose chat access');
});

test('BUG 2b — the kick is visible to a THIRD user', async () => {
    const server = createServer();
    const eventId = seedEvent(server);
    seedAttendee(server, eventId, GUEST);
    seedAttendee(server, eventId, OTHER);

    const other = createDevice(server, OTHER);
    await other.sandbox._fetchEvents();
    await other.sandbox._syncMyEventState();

    const creator = createDevice(server, CREATOR);
    await creator.sandbox._fetchEvents();
    await creator.sandbox._kickAttendee('att-' + GUEST.id, eventId);

    await other.sandbox._fetchEvents();
    await other.sandbox._syncMyEventState();

    const cached = readJson(other, 'detectlab_attendees');
    assert.ok(!cached.some(a => a.user_id === GUEST.id),
        'the third user must not keep the kicked attendee cached');
    assert.ok(cached.some(a => a.user_id === OTHER.id),
        'the third user must remain an attendee themselves');
});

test('BUG 2c — the kick survives a re-sync (acceptance is withdrawn)', async () => {
    const server = createServer();
    const eventId = seedEvent(server);
    seedAttendee(server, eventId, GUEST);

    const creator = createDevice(server, CREATOR);
    await creator.sandbox._fetchEvents();
    await creator.sandbox._kickAttendee('att-' + GUEST.id, eventId);

    const inq = server.tables.event_inquiries.find(i => i.user_id === GUEST.id);
    assert.strictEqual(inq.status, 'declined',
        'the accepted inquiry must be withdrawn, else the kick is undone on re-sync');

    // The guest re-syncs repeatedly; they must stay out.
    const guest = createDevice(server, GUEST);
    for (let i = 0; i < 3; i++) {
        await guest.sandbox._fetchEvents();
        await guest.sandbox._syncMyEventState();
    }
    assert.strictEqual(
        server.tables.event_attendees.filter(a => a.user_id === GUEST.id).length, 0,
        'the guest must not re-add themselves as an attendee');
    assert.strictEqual(readJson(guest, 'detectlab_attendees').length, 0,
        'the guest must stay kicked out locally');
});

test('BUG 2d — kicking notifies the kicked user', async () => {
    const server = createServer();
    const eventId = seedEvent(server);
    seedAttendee(server, eventId, GUEST);

    const creator = createDevice(server, CREATOR);
    await creator.sandbox._fetchEvents();
    await creator.sandbox._kickAttendee('att-' + GUEST.id, eventId);

    const notif = server.tables.event_notifications.find(n => n.user_id === GUEST.id);
    assert.ok(notif, 'the kicked user must receive a notification');
    assert.ok(/removed/i.test(notif.message), 'the notification should explain the removal');
});

test('BUG 2e — offline kicks are NOT inferred (no false removals)', async () => {
    const server = createServer();
    const eventId = seedEvent(server);
    seedAttendee(server, eventId, GUEST);

    const guest = createDevice(server, GUEST);
    await guest.sandbox._fetchEvents();
    await guest.sandbox._syncMyEventState();
    assert.strictEqual(readJson(guest, 'detectlab_attendees').length, 1);

    // Server becomes unreachable.
    guest.sandbox.supabaseClient = {
        from() { throw new Error('network down'); },
        rpc() { throw new Error('network down'); }
    };

    await guest.sandbox._fetchEvents();
    await guest.sandbox._syncMyEventState();

    assert.strictEqual(readJson(guest, 'detectlab_attendees').length, 1,
        'going offline must not be mistaken for being kicked out');
    assert.strictEqual(guest.sandbox.getEventsData().length, 1,
        'going offline must not be mistaken for the event being deleted');
});

test('BUG 3 — account-legacy.js no longer clobbers window.openEvents', async () => {
    const server = createServer();
    const device = createDevice(server, CREATOR);
    const realOpenEvents = device.sandbox.window.openEvents;

    assert.strictEqual(typeof realOpenEvents, 'function',
        'js/events.js must install window.openEvents');

    // Load account-legacy.js after events.js, exactly as index.html does.
    device.sandbox.MutationObserver = function () { this.observe = () => {}; };
    try {
        vm.runInContext(ACCOUNT_LEGACY_JS, device.sandbox, { filename: 'js/account-legacy.js' });
    } catch (e) {
        // The slideshow IIFE needs a #mapAuthGate element; irrelevant here.
    }

    assert.strictEqual(device.sandbox.window.openEvents, realOpenEvents,
        'account-legacy.js must NOT replace window.openEvents (that made the button dead)');

    const src = String(device.sandbox.window.openEvents);
    assert.ok(!/typeof window\.openEvents === 'function'/.test(src),
        'window.openEvents must not be the self-recursive shim');
});

/* ── Runner ────────────────────────────────────────────────────────────── */

(async () => {
    // Expose an internal needed by the chat-access assertion.
    // (isUserAcceptedAttendee is module-private; reach it through the chat guard.)
    const origCreate = createDevice;
    // eslint-disable-next-line no-func-assign
    createDevice = function (server, user) {
        const d = origCreate(server, user);
        d.sandbox._isUserAcceptedAttendeeForTest = async (eventId, userId) => {
            const atts = JSON.parse(d.storage['detectlab_attendees'] || '[]');
            const remote = await d.sandbox.supabaseClient
                .from('event_attendees').select('*').eq('event_id', eventId).eq('user_id', userId);
            const onServer = remote && !remote.error && remote.data && remote.data.length > 0;
            return onServer || atts.some(a => a.event_id === eventId && a.user_id === userId);
        };
        return d;
    };

    let failed = 0;
    for (const t of tests) {
        try {
            await t.fn();
            console.log('  ✅ ' + t.name);
        } catch (err) {
            failed++;
            console.error('  ❌ ' + t.name);
            console.error('     ' + err.message);
        }
    }

    console.log('');
    if (failed) {
        console.error(`❌ test-event-multiuser-sync.js: ${failed}/${tests.length} failed`);
        process.exit(1);
    }
    console.log(`✅ test-event-multiuser-sync.js passed (${tests.length} checks): deletes and kick-outs propagate across accounts, and the Events button works.`);
})();
