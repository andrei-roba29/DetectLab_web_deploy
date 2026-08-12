// Regression test for: "after accepting an inquiry, the inquiring user receives
// no notification and their inquiry status stays pending".
//
// Root cause: the notification system was one-directional. A notification row was
// created for the CREATOR when an inquiry arrived, but _acceptInquiry/_declineInquiry
// never created a notification addressed to the inquiring user — so the attendee
// never heard back, and their local UI kept showing "Request pending".
//
// This test loads the REAL js/events.js into a minimal browser sandbox (no jsdom
// dependency) and exercises the actual window._acceptInquiry / window._declineInquiry
// against a Supabase query-builder stub, then asserts that an outcome notification
// addressed to the attendee is produced.
//
// Run: node test-event-accept-notification.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ── Supabase-like query builder stub ──
// Records inserts/updates and serves select/single from in-memory tables so the
// accept/decline code paths run against realistic data.
function makeSupabaseStub() {
    const tables = {
        events: [],
        event_inquiries: [],
        event_attendees: [],
        event_notifications: [],
        event_chats: [],
        event_chat_messages: []
    };

    function matcher(q) {
        return function (row) {
            const okEq = Object.keys(q.filters).every(function (col) {
                return row[col] === q.filters[col];
            });
            const okIn = Object.keys(q.inFilters).every(function (col) {
                return q.inFilters[col](row[col]);
            });
            return okEq && okIn;
        };
    }

    function run(q) {
        if (q.mode === 'insert' || q.mode === 'upsert') {
            (q.payload || []).forEach(function (row) {
                if (Array.isArray(tables[q.table])) tables[q.table].push(row);
            });
            return { error: null, data: q.payload };
        }
        if (q.mode === 'update') {
            const m = matcher(q);
            (tables[q.table] || []).forEach(function (row) {
                if (m(row)) Object.assign(row, q.patch);
            });
            return { error: null, data: null };
        }
        if (q.mode === 'delete') {
            return { error: null, data: null };
        }
        // select
        let rows = (tables[q.table] || []).filter(matcher(q));
        if (q.singleMode) {
            const f = rows[0] || null;
            return { error: f ? null : { code: 'PGRST116', message: 'no rows' }, data: f };
        }
        if (q.limitN != null) rows = rows.slice(0, q.limitN);
        return { error: null, data: rows };
    }

    function buildChain(table) {
        const q = { table, filters: {}, inFilters: {}, mode: null, patch: null, payload: null, singleMode: false, limitN: null, returnSelect: false };
        const chain = {
            select() {
                if (q.mode === 'insert' || q.mode === 'upsert') q.returnSelect = true;
                else q.mode = 'select';
                return chain;
            },
            insert(rows) { q.mode = 'insert'; q.payload = rows; return chain; },
            upsert(rows) { q.mode = 'upsert'; q.payload = rows; return chain; },
            update(patch) { q.mode = 'update'; q.patch = patch; return chain; },
            delete() { q.mode = 'delete'; return chain; },
            eq(col, val) { q.filters[col] = val; return chain; },
            in(col, arr) { q.inFilters[col] = function (v) { return arr.indexOf(v) !== -1; }; return chain; },
            single() { q.singleMode = true; return chain; },
            limit(n) { q.limitN = n; return chain; },
            order() { return chain; },
            then(resolve, reject) { try { resolve(run(q)); } catch (e) { reject(e); } }
        };
        return chain;
    }

    const client = {
        from(table) { return buildChain(table); },
        rpc() { return Promise.resolve({ error: null }); }
    };
    return { client, tables };
}

// ── Minimal DOM / window / localStorage stubs ──
function fakeEl() {
    return {
        style: {},
        innerHTML: '',
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        setAttribute() {},
        getAttribute() { return null; },
        appendChild() {},
        remove() {}
    };
}
function makeDocStub() {
    return {
        addEventListener() {},
        removeEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return fakeEl(); },
        // events.js injects its badge/calendar stylesheet into document.head on
        // load, so the stub needs a head as well as a body.
        head: { appendChild() {} },
        body: { appendChild() {} }
    };
}
function makeLsStub() {
    const store = {};
    return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; }
    };
}

function loadEventsModule() {
    const ls = makeLsStub();
    const supa = makeSupabaseStub();
    let currentUserId = null;
    let idc = 0;
    const win = {};
    win.crypto = { randomUUID: function () { return 'uuid-' + (++idc); } };
    win._authUser = function () {
        return currentUserId ? { id: currentUserId, name: 'User ' + currentUserId, email: currentUserId + '@test.com' } : null;
    };
    win._currentLang = function () { return 'en'; };
    win.supabaseClient = supa.client;
    win._dlMap = undefined;
    win.map = undefined;
    win.addEventListener = function () {};

    const sandbox = {
        window: win,
        document: makeDocStub(),
        localStorage: ls,
        alert() {},
        setTimeout, setInterval, clearTimeout, clearInterval,
        console, Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, Error,
        isFinite, parseFloat, parseInt, isNaN
    };
    sandbox.crypto = win.crypto;
    vm.createContext(sandbox);
    const code = fs.readFileSync(path.join(__dirname, 'js', 'events.js'), 'utf8');
    vm.runInContext(code, sandbox);
    return { win, supa, setCurrentUser(id) { currentUserId = id; } };
}

// ── Pure-logic mirror of showNotificationModal's kind derivation (verbatim rules) ──
function deriveKind(inquiry, notif, currentUserId) {
    // If the related inquiry belongs to the current user and has an outcome status,
    // the notification is about THEIR request; otherwise it's an incoming request
    // to an event they own.
    if (inquiry && inquiry.user_id === currentUserId) {
        if (inquiry.status === 'accepted') return 'accepted';
        if (inquiry.status === 'declined') return 'declined';
    }
    return 'inquiry';
}

(async () => {
    const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
    const creatorId = 'creator-1';
    const attendeeId = 'attendee-1';
    const eventId = 'event-1';
    const inquiryId = 'inq-1';

    // ── 1) Accepting creates a notification addressed to the ATTENDEE ──
    const mod1 = loadEventsModule();
    mod1.supa.tables.events.push({
        id: eventId, creator_id: creatorId, creator_name: 'Creator', creator_email: 'creator@t.com',
        title: 'Forest Hunt', description: 'd', latitude: 47, longitude: 23, event_date: FUTURE
    });
    mod1.supa.tables.event_inquiries.push({
        id: inquiryId, event_id: eventId, user_id: attendeeId, user_name: 'Attendee',
        message: 'Hi', status: 'pending', created_at: new Date().toISOString()
    });
    await mod1.win._fetchEvents();
    await mod1.win._acceptInquiry(inquiryId, eventId);

    const notifs1 = mod1.supa.tables.event_notifications;
    assert.strictEqual(notifs1.length, 1, 'accept should create exactly one outcome notification');
    const outcome = notifs1[0];
    assert.strictEqual(outcome.user_id, attendeeId, 'outcome notification must be addressed to the inquiring user');
    assert.strictEqual(outcome.inquiry_id, inquiryId, 'notification must reference the inquiry');
    assert.strictEqual(outcome.event_id, eventId, 'notification must reference the event');
    assert.ok(/ACCEPTED/.test(outcome.message), 'notification message must mention ACCEPTED, got: ' + outcome.message);
    // The inquiry itself must be flipped to accepted in the DB.
    assert.strictEqual(mod1.supa.tables.event_inquiries[0].status, 'accepted', 'inquiry status must be updated to accepted');
    // And an attendee row must be created.
    assert.ok(mod1.supa.tables.event_attendees.some(function (a) { return a.user_id === attendeeId && a.event_id === eventId; }),
        'an attendee row must be created on accept');

    // ── 2) Double-accept must NOT spam a duplicate notification ──
    await mod1.win._acceptInquiry(inquiryId, eventId);
    assert.strictEqual(mod1.supa.tables.event_notifications.length, 1,
        'accepting an already-accepted inquiry must not create a second notification');

    // ── 3) Declining creates a notification addressed to the attendee ──
    const mod3 = loadEventsModule();
    const inquiryId2 = 'inq-2';
    mod3.supa.tables.events.push({
        id: eventId, creator_id: creatorId, creator_name: 'Creator', creator_email: 'creator@t.com',
        title: 'Beach Sweep', description: 'd', latitude: 47, longitude: 23, event_date: FUTURE
    });
    mod3.supa.tables.event_inquiries.push({
        id: inquiryId2, event_id: eventId, user_id: attendeeId, user_name: 'Attendee',
        message: 'Hi', status: 'pending', created_at: new Date().toISOString()
    });
    await mod3.win._fetchEvents();
    await mod3.win._declineInquiry(inquiryId2);

    const notifs3 = mod3.supa.tables.event_notifications;
    assert.strictEqual(notifs3.length, 1, 'decline should create exactly one outcome notification');
    assert.strictEqual(notifs3[0].user_id, attendeeId, 'decline notification must be addressed to the inquiring user');
    assert.ok(/DECLINED/.test(notifs3[0].message), 'decline message must mention DECLINED, got: ' + notifs3[0].message);
    assert.strictEqual(mod3.supa.tables.event_inquiries[0].status, 'declined', 'inquiry status must be updated to declined');

    // ── 4) Notification kind derivation (mirrors showNotificationModal branching) ──
    // Attendee viewing their own accepted request -> 'accepted'
    assert.strictEqual(
        deriveKind({ user_id: attendeeId, status: 'accepted' }, { inquiry_id: inquiryId, user_id: attendeeId }, attendeeId),
        'accepted',
        'attendee should derive an "accepted" notification kind'
    );
    // Creator viewing an incoming request (inquiry belongs to someone else) -> 'inquiry'
    assert.strictEqual(
        deriveKind({ user_id: attendeeId, status: 'pending' }, { inquiry_id: inquiryId, user_id: creatorId }, creatorId),
        'inquiry',
        'creator should derive an "inquiry" (request) notification kind'
    );
    // Attendee viewing their own declined request -> 'declined'
    assert.strictEqual(
        deriveKind({ user_id: attendeeId, status: 'declined' }, { inquiry_id: inquiryId, user_id: attendeeId }, attendeeId),
        'declined',
        'attendee should derive a "declined" notification kind'
    );

    console.log('✅ test-event-accept-notification.js passed: accept/decline notify the inquiring user; status flips; no duplicate spam.');
})().catch((err) => {
    console.error('❌ test-event-accept-notification.js failed:', err.message);
    process.exit(1);
});
