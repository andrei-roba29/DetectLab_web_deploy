// Regression tests for event-chat messages that only became visible after the
// recipient sent a message.
//
// Symptoms: opening an event chat could hide previous messages, and new
// messages from another participant did not appear live. Sending a message
// forced a reload and made the missing conversation appear all at once.
//
// Root causes: chat message reads could be gated (server-side) on state that
// only exists after the user's first INSERT, and the client never subscribed
// to INSERT changes at all. The fixes guarantee the chat row exists before
// reading, re-assert read access, and keep a filtered Supabase Realtime stream
// (with a short reconnect/poll fallback) active while the modal is open.
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
        rpcCalls: [],
        realtimeSubscriptions: []
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

                        if (table === 'event_chat_messages' && idx === -1) {
                            server.realtimeSubscriptions.slice().forEach(subscription => {
                                const binding = subscription.binding;
                                if (!binding || binding.table !== table || binding.event !== 'INSERT') return;
                                const expectedEventId = String(binding.filter || '').replace(/^event_id=eq\./, '');
                                if (expectedEventId && expectedEventId !== rec.event_id) return;
                                Promise.resolve().then(() => subscription.handler({
                                    eventType: 'INSERT',
                                    new: { ...rec },
                                    old: {}
                                }));
                            });
                        }
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

    const client = {
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
        },
        channel(name) {
            const subscription = {
                name,
                binding: null,
                handler: null,
                on(type, binding, handler) {
                    assert.strictEqual(type, 'postgres_changes');
                    subscription.binding = binding;
                    subscription.handler = handler;
                    return subscription;
                },
                subscribe(statusHandler) {
                    server.realtimeSubscriptions.push(subscription);
                    Promise.resolve().then(() => statusHandler('SUBSCRIBED'));
                    return subscription;
                },
                unsubscribe() {
                    server.realtimeSubscriptions = server.realtimeSubscriptions.filter(item => item !== subscription);
                    return Promise.resolve('ok');
                }
            };
            return subscription;
        },
        removeChannel(subscription) {
            server.realtimeSubscriptions = server.realtimeSubscriptions.filter(item => item !== subscription);
            return Promise.resolve('ok');
        }
    };
    return client;
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

    // 4. THE LIVE-DELIVERY REGRESSION: while the recipient has the chat open,
    //    another participant's INSERT must render without any action from the
    //    recipient (especially without sending a message to force a reload).
    await test('another participant message appears live without the recipient sending', async () => {
        const server = createServer();
        const eventId = seedEvent(server);
        seedAttendee(server, eventId, GUEST);

        const recipient = createDevice(server, GUEST);
        const initialHtml = await openChat(recipient, eventId);
        assert.ok(initialHtml.indexOf('Start the conversation') !== -1, 'chat should start empty');
        assert.strictEqual(server.realtimeSubscriptions.length, 1, 'open chat should have one Realtime subscription');
        assert.strictEqual(server.realtimeSubscriptions[0].binding.filter, 'event_id=eq.' + eventId,
            'Realtime subscription must be filtered to the active event');

        const incoming = {
            id: 'msg-live',
            event_id: eventId,
            user_id: CREATOR.id,
            user_name: CREATOR.name,
            message: 'This must arrive without a reply',
            media_url: null,
            media_type: 'none',
            created_at: new Date().toISOString()
        };
        await createSupabaseClient(server).from('event_chat_messages').insert([incoming]);

        // Let the simulated Realtime delivery and its follow-up SELECT finish.
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

        const liveHtml = recipient.byId.get('chatMessagesList').innerHTML;
        assert.ok(liveHtml.indexOf(CREATOR.name) !== -1, 'live sender should render: ' + liveHtml);
        assert.ok(liveHtml.indexOf(incoming.message) !== -1, 'live message should render without recipient send');
        assert.ok(liveHtml.indexOf('Start the conversation') === -1, 'empty state should be replaced');

        recipient.sandbox._closeEventChatModal();
        assert.strictEqual(server.realtimeSubscriptions.length, 0, 'closing chat should unsubscribe');
    });

    // 5. A genuinely empty chat still shows the "start the conversation" state.
    await test('genuinely empty chat still shows the start-conversation placeholder', async () => {
        const server = createServer();
        const eventId = seedEvent(server);
        seedAttendee(server, eventId, GUEST);

        const device = createDevice(server, GUEST);
        const html = await openChat(device, eventId);

        assert.ok(html.indexOf('Start the conversation') !== -1, 'empty chat should show placeholder, got: ' + html);
    });
})();
