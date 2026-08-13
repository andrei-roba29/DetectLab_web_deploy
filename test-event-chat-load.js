// Regression test for the event-chat "history not visible until I send a
// message" bug.
//
// Symptom: opening an event chat shows no previous messages. As soon as the
// user posts their first message, the whole history appears.
//
// Root cause: chat message reads were gated (server-side) on state that only
// exists after the user's first INSERT — e.g. an RLS SELECT policy that
// requires the `event_chats` row (which the insert-guard trigger creates) or
// a "only chats I have written in" policy. The fix guarantees the chat row
// exists before reading (security-definer RPC `ensure_event_chat_for_event`)
// and re-asserts permissive read policies via migration, plus a retry in
// `loadChatMessages`.
//
// This test loads the REAL js/events.js in a jsdom-ish sandbox against an
// in-memory Supabase that can simulate the restrictive deployment (message
// reads only visible once the event_chats row exists).
//
// Run: node test-event-chat-load.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const EVENTS_JS = fs.readFileSync(path.join(__dirname, 'js/events.js'), 'utf8');

/* ── In-memory Supabase ─────────────────────────────────────────────────── */

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
        // Simulates the restrictive deployment: SELECT on event_chat_messages
        // only returns rows once the event_chats row exists for that event.
        gateChatReadsOnChatRow: false,
        // When true, the very first SELECT on event_chat_messages errors
        // (transient failure) and all subsequent reads succeed.
        failFirstMessageRead: false,
        rpcCalls: []
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
                    const list = Array.isArray(api._payload) ? api._payload : [api._payload];
                    list.forEach(rec => {
                        const key = table === 'event_chats' ? 'event_id' : 'id';
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

                // Simulate the restrictive deployment: reads only work once
                // the event_chats row exists for that event.
                if (table === 'event_chat_messages' && server.gateChatReadsOnChatRow) {
                    const evFilter = filters.find(f => f.col === 'event_id');
                    const chatExists = evFilter && server.tables.event_chats.some(c => c.event_id === evFilter.val);
                    if (!chatExists) return Promise.resolve({ data: [], error: null });
                }

                // Simulate a transient failure on the first message read.
                if (table === 'event_chat_messages' && server.failFirstMessageRead) {
                    server.failFirstMessageRead = false;
                    return Promise.resolve({ data: null, error: { code: 'PGRST301', message: 'boom' } });
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
        rpc(name, params) {
            server.rpcCalls.push(name);
            if (name === 'ensure_event_chat_for_event') {
                const ev = server.tables.events.find(e => e.id === params._event_id);
                if (ev && new Date(ev.event_date) > new Date()) {
                    const attCount = server.tables.event_attendees.filter(a => a.event_id === params._event_id).length;
                    if (attCount >= 1) {
                        const idx = server.tables.event_chats.findIndex(c => c.event_id === params._event_id);
                        const chat = { event_id: params._event_id, expires_at: ev.event_date, status: 'active' };
                        if (idx === -1) server.tables.event_chats.push(chat);
                        else server.tables.event_chats[idx] = { ...server.tables.event_chats[idx], ...chat };
                        return Promise.resolve({ data: chat, error: null });
                    }
                }
                return Promise.resolve({ data: null, error: null });
            }
            if (name === 'cleanup_expired_event_chats') {
                return Promise.resolve({ data: { deleted_chats: 0, deleted_messages: 0 }, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'rpc unavailable' } });
        }
    };
}

/* ── Simulated browser device running the REAL js/events.js ─────────────── */

function createDevice(server, user) {
    const storage = {};
    const localStorage = {
        getItem: k => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: k => { delete storage[k]; }
    };

    function noopEl(tag) {
        const handlers = {};
        const attrs = {};
        return {
            tagName: tag || 'div',
            style: {},
            classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
            appendChild() {}, removeChild() {}, remove() {}, insertBefore() {},
            scrollIntoView() {}, focus() {}, blur() {},
            setAttribute(k, v) { attrs[k] = String(v); },
            getAttribute: k => (k in attrs ? attrs[k] : null),
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
            fire(type, ev) { return Promise.all((handlers[type] || []).map(fn => fn(ev || { target: this }))); },
            click() { return this.fire('click'); },
            cloneNode() { return noopEl(tag); },
            textContent: '',
            innerHTML: '',
            disabled: false,
            value: ''
        };
    }

    // getElementById returns a STABLE element per id so the chat modal and
    // its #chatMessagesList are observable from the test.
    const byId = new Map();
    const created = [];
    const document = {
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, noopEl('div'));
            return byId.get(id);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement(tag) { const el = noopEl(tag); created.push(el); return el; },
        head: noopEl(),
        body: Object.assign(noopEl(), { classList: { add() {}, remove() {}, contains: () => false } }),
        addEventListener() {},
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
        // Execute setTimeout callbacks synchronously so the loadChatMessages
        // retry actually runs; never run intervals.
        setTimeout: fn => { fn(); return timers.length + 1; },
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
    sandbox.addEventListener = () => {};
    sandbox.dispatchEvent = () => true;
    sandbox.supabaseClient = createSupabaseClient(server);
    sandbox._authUser = () => user;
    sandbox._currentLang = () => 'en';

    vm.createContext(sandbox);
    vm.runInContext(EVENTS_JS, sandbox, { filename: 'js/events.js' });

    return { sandbox, storage, alerts, localStorage, byId, created, timers };
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */

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
        id: 'att-' + user.id + '-' + eventId,
        event_id: eventId,
        user_id: user.id,
        user_name: user.name,
        joined_at: new Date().toISOString()
    });
}

function seedMessages(server, eventId) {
    server.tables.event_chat_messages.push(
        {
            id: 'msg-1',
            event_id: eventId,
            user_id: CREATOR.id,
            user_name: CREATOR.name,
            message: 'First message from the creator',
            media_url: null,
            media_type: 'none',
            created_at: new Date(Date.now() - 7200000).toISOString()
        },
        {
            id: 'msg-2',
            event_id: eventId,
            user_id: OTHER.id,
            user_name: OTHER.name,
            message: 'Another attendee says hello',
            media_url: null,
            media_type: 'none',
            created_at: new Date(Date.now() - 3600000).toISOString()
        }
    );
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

async function openChat(device, eventId) {
    await device.sandbox._fetchEvents();
    await device.sandbox._openEventChat(eventId);
    return device.byId.get('chatMessagesList').innerHTML;
}

function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { console.log('✓ ' + name); })
        .catch(err => { console.error('✗ ' + name + '\n   ' + (err && err.stack || err)); process.exitCode = 1; });
}

(async function main() {
    // 1. THE REPORTED BUG: with reads gated on the event_chats row (the
    //    restrictive deployment), opening the chat must still show the
    //    previous messages of other users — without sending anything.
    await test('previous messages visible on open even when reads are gated on the chat row', async () => {
        const server = createServer();
        server.gateChatReadsOnChatRow = true;
        const eventId = seedEvent(server);
        seedAttendee(server, eventId, GUEST);
        seedMessages(server, eventId);

        const device = createDevice(server, GUEST);
        const html = await openChat(device, eventId);

        assert.ok(server.rpcCalls.includes('ensure_event_chat_for_event'),
            'expected _openEventChat to call ensure_event_chat_for_event');
        assert.ok(html.indexOf(CREATOR.name) !== -1, 'creator message sender should be visible: ' + html);
        assert.ok(html.indexOf('First message from the creator') !== -1, 'creator message text should be visible');
        assert.ok(html.indexOf(OTHER.name) !== -1, 'other attendee sender should be visible');
        assert.ok(html.indexOf('Another attendee says hello') !== -1, 'other attendee message should be visible');
        assert.ok(html.indexOf('Start the conversation') === -1, 'must not show the empty-chat placeholder');
    });

    // 2. Baseline: on a permissive deployment the history loads immediately.
    await test('previous messages visible on open on a permissive deployment', async () => {
        const server = createServer();
        const eventId = seedEvent(server);
        seedAttendee(server, eventId, GUEST);
        seedMessages(server, eventId);

        const device = createDevice(server, GUEST);
        const html = await openChat(device, eventId);

        assert.ok(html.indexOf('First message from the creator') !== -1, 'creator message should be visible');
        assert.ok(html.indexOf('Another attendee says hello') !== -1, 'attendee message should be visible');
    });

    // 3. A transient failure on the first read is retried before falling back.
    await test('transient first-read failure is retried and history still loads', async () => {
        const server = createServer();
        server.failFirstMessageRead = true;
        const eventId = seedEvent(server);
        seedAttendee(server, eventId, GUEST);
        seedMessages(server, eventId);

        const device = createDevice(server, GUEST);
        const html = await openChat(device, eventId);

        assert.ok(html.indexOf('First message from the creator') !== -1, 'creator message should be visible after retry');
        assert.ok(html.indexOf('Another attendee says hello') !== -1, 'attendee message should be visible after retry');
    });

    // 4. A genuinely empty chat still shows the "start the conversation" state.
    await test('genuinely empty chat still shows the start-conversation placeholder', async () => {
        const server = createServer();
        const eventId = seedEvent(server);
        seedAttendee(server, eventId, GUEST);

        const device = createDevice(server, GUEST);
        const html = await openChat(device, eventId);

        assert.ok(html.indexOf('Start the conversation') !== -1, 'empty chat should show placeholder, got: ' + html);
    });
})();
