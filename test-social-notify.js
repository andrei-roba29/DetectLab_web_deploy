// Regression tests for the SOCIAL NOTIFICATION layer:
// the red badge on the profile button + the pop-up cards.
//
// What is exercised against the REAL js/friends.js (and the badge contract of
// js/events.js):
//   1. The profile button (desktop pill `#navUser` and PWA `#pwaUserTrigger`)
//      carries ONE red badge with pending friend requests + unread messages;
//      it hides again at zero and drops the moment a thread is read.
//   2. js/events.js and js/friends.js feed the SAME badge through
//      window.DetectLabNotify.setSourceCount(), so the two counts add up
//      instead of overwriting each other — while the „Prieteni” entry keeps a
//      social-only badge.
//   3. A new friend request pops a card naming the requester; tapping it opens
//      the panel on the „Cereri” tab.
//   4. A new message pops a card (through the realtime inbox channel AND
//      through the counter poll) with the sender and a preview; tapping it
//      opens that very thread.
//   5. Nothing pops for what you are already looking at (the open thread, your
//      own message), nothing pops twice for the same item, a plain reload is
//      silent (the marks live in the per-account mirror) and an old backlog
//      stays a badge instead of a pop-up.
//   6. index.html + sw.js ship the new versions and pre-cache them.
//
// Run: node test-social-notify.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const FRIENDS_JS = fs.readFileSync(path.join(__dirname, 'js/friends.js'), 'utf8');
const EVENTS_JS = fs.readFileSync(path.join(__dirname, 'js/events.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const SW_JS = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

let passed = 0;
function ok(label) { passed++; console.log('  ✔ ' + label); }

const LIMITS = {
    max_events_created_active: 10,
    max_events_attending_active: 15,
    max_event_deadline_days: 365,
    max_event_invites_per_event: 50,
    max_friends: 100,
    max_friend_requests_per_day: 50,
    max_friend_request_message_len: 200,
    max_group_conversations: 50,
    max_group_members: 20,
    max_conversation_title_len: 60,
    max_message_length: 2000,
    max_messages_per_conversation: 500,
    max_messages_per_minute: 60,
    max_messages_per_day: 2000,
    message_retention_days: 90,
    max_attachment_bytes: 5 * 1024 * 1024,
    max_conversation_storage_bytes: 209715200,
    max_user_storage_bytes: 524288000,
    event_chat_message_length: 2000,
    event_chat_retention_days: 90
};

const ME = { id: 'u-ana', name: 'Ana Pop', email: 'ana.pop@detectlab.ro' };
const MIHAI = { id: 'u-mihai', name: 'Mihai Ionescu', email: 'mihai.i@example.com' };
const ELENA = { id: 'u-elena', name: 'Elena Dobre', email: 'elena@dorelmail.com' };

const DAY = 24 * 60 * 60 * 1000;
function iso(msAgo) { return new Date(Date.now() - (msAgo || 0)).toISOString(); }

/* ══════════════════════════════════════════════════════════════════════════
   In-memory social server — only the surface js/friends.js touches while it
   watches the inbox: counters, requests, conversations, mark-as-read and the
   realtime channel that carries conversation_messages INSERTs.
══════════════════════════════════════════════════════════════════════════ */

function createSocialServer() {
    const server = {
        currentUserId: ME.id,
        rpcCalls: [],
        channels: [],
        friendRequests: [],
        conversations: [],
        messages: {},          // conversation_id -> [rows]
        friends: [
            { user_id: MIHAI.id, display_name: MIHAI.name, email: MIHAI.email, county: 'Cluj', city: 'Cluj-Napoca', conversation_id: 'c-mihai' },
            { user_id: ELENA.id, display_name: ELENA.name, email: ELENA.email, county: 'Bihor', city: 'Oradea', conversation_id: 'c-elena' }
        ]
    };

    // A private thread with Mihai, empty and fully read by default.
    server.conversations.push({
        id: 'c-mihai', kind: 'direct', title: null, status: 'active', my_role: 'member',
        member_count: 2, unread_count: 0, last_message_at: null, last_message_body: null,
        last_media_type: 'none', last_sender_id: null, last_sender_name: null,
        created_by: ME.id, other_user_id: MIHAI.id, other_user_name: MIHAI.name, other_user_county: 'Cluj'
    });
    server.messages['c-mihai'] = [];

    function counters() {
        const pending = server.friendRequests.filter(r => r.addressee_id === server.currentUserId && r.status === 'pending').length;
        const unread = server.conversations.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);
        return { pending_requests: pending, unread_messages: unread, friends: server.friends.length, conversations: server.conversations.length };
    }

    /* ── test-side helpers ── */

    // Somebody asks to be your friend.
    server.receiveRequest = function (from, message, msAgo) {
        const row = {
            id: 'req-' + (server.friendRequests.length + 1),
            requester_id: from.id, addressee_id: ME.id, requester_name: from.name,
            message: message || null, status: 'pending', created_at: iso(msAgo)
        };
        server.friendRequests.push(row);
        return row;
    };

    // Somebody writes in a thread you are NOT looking at.
    server.receiveMessage = function (conversationId, from, body, msAgo, mediaType) {
        const conv = server.conversations.filter(c => c.id === conversationId)[0];
        assert(conv, 'unknown conversation ' + conversationId);
        const row = {
            id: 'msg-' + conversationId + '-' + ((server.messages[conversationId] || []).length + 1),
            conversation_id: conversationId, sender_id: from.id, sender_name: from.name,
            body: body || '', media_type: mediaType || 'none', media_url: null,
            created_at: iso(msAgo)
        };
        (server.messages[conversationId] = server.messages[conversationId] || []).push(row);
        conv.unread_count = (Number(conv.unread_count) || 0) + 1;
        conv.last_message_at = row.created_at;
        conv.last_message_body = row.body;
        conv.last_media_type = row.media_type;
        conv.last_sender_id = row.sender_id;
        conv.last_sender_name = row.sender_name;
        return row;
    };

    server.addGroup = function (id, title, members) {
        server.conversations.push({
            id: id, kind: 'group', title: title, status: 'active', my_role: 'admin',
            member_count: (members || []).length + 1, unread_count: 0, last_message_at: null,
            last_message_body: null, last_media_type: 'none', last_sender_id: null,
            last_sender_name: null, created_by: ME.id, other_user_id: null, other_user_name: null
        });
        server.messages[id] = [];
        return id;
    };

    // Fire the realtime INSERT frame the browser would get.
    server.emitRealtime = function (row) {
        let delivered = 0;
        server.channels.forEach(function (channel) {
            channel._handlers.forEach(function (h) {
                if (h.table === 'conversation_messages') { h.cb({ new: row, old: {}, eventType: 'INSERT' }); delivered++; }
            });
        });
        return delivered;
    };

    /* ── supabase-js surface ── */

    server.rpc = async function (name, params) {
        server.rpcCalls.push({ name: name, params: params || {} });
        const p = params || {};
        switch (name) {
            case 'get_app_limits': return { data: [Object.assign({}, LIMITS)], error: null };
            case 'upsert_my_social_profile': return { data: { user_id: ME.id }, error: null };
            case 'list_my_friends': return { data: server.friends.slice(), error: null };
            case 'list_my_friend_requests': {
                const incoming = p._direction !== 'outgoing';
                const rows = server.friendRequests
                    .filter(r => (incoming ? r.addressee_id : r.requester_id) === server.currentUserId)
                    .map(function (r) {
                        const other = incoming ? { id: r.requester_id, name: r.requester_name } : { id: r.addressee_id, name: r.addressee_name };
                        return {
                            id: r.id, direction: incoming ? 'incoming' : 'outgoing',
                            other_id: other.id, other_name: other.name, other_email: null,
                            other_county: incoming ? (other.id === ELENA.id ? 'Bihor' : 'Cluj') : null,
                            message: r.message, status: r.status, created_at: r.created_at
                        };
                    });
                return { data: rows, error: null };
            }
            case 'list_my_conversations': return { data: server.conversations.map(c => Object.assign({}, c)), error: null };
            case 'get_social_counters': return { data: [counters()], error: null };
            case 'get_my_event_quota':
                return { data: [{ events_created_active: 0, events_created_max: 10, events_attending_active: 0, events_attending_max: 15, max_deadline_days: 365 }], error: null };
            case 'mark_conversation_read': {
                const conv = server.conversations.filter(c => c.id === p._conversation_id)[0];
                if (conv) conv.unread_count = 0;
                return { data: true, error: null };
            }
            case 'get_conversation_messages': {
                const rows = (server.messages[p._conversation_id] || []).slice().reverse();
                return { data: rows, error: null };
            }
            case 'start_direct_conversation': {
                const existing = server.conversations.filter(c => c.kind === 'direct' && c.other_user_id === p._other_user)[0];
                if (existing) return { data: Object.assign({}, existing), error: null };
                const friend = server.friends.filter(f => f.user_id === p._other_user)[0];
                if (!friend) return { data: null, error: { message: 'NOT_FRIENDS' } };
                const conv = {
                    id: 'c-' + friend.user_id, kind: 'direct', title: null, status: 'active', my_role: 'member',
                    member_count: 2, unread_count: 0, last_message_at: null, last_message_body: null,
                    last_media_type: 'none', last_sender_id: null, last_sender_name: null, created_by: ME.id,
                    other_user_id: friend.user_id, other_user_name: friend.display_name, other_user_county: friend.county
                };
                server.conversations.push(conv);
                server.messages[conv.id] = [];
                return { data: Object.assign({}, conv), error: null };
            }
            case 'send_conversation_message': return { data: null, error: null };
            case 'cleanup_social_messages': return { data: 0, error: null };
            case 'cleanup_event_chat_messages': return { data: 0, error: null };
            case 'search_social_users': return { data: [], error: null };
            case 'list_social_counties': return { data: [], error: null };
            default: return { data: null, error: null };
        }
    };

    // Chainable SELECT stub (the fallback paths friends.js keeps for servers
    // without the RPCs); everything resolves to an empty, error-free result.
    server.from = function () {
        const q = {
            select() { return q; }, eq() { return q; }, neq() { return q; }, in() { return q; },
            order() { return q; }, limit() { return q; }, range() { return q; }, or() { return q; },
            then(resolve) { resolve({ data: [], error: null }); }
        };
        return q;
    };

    server.channel = function (name) {
        const channel = {
            name: name, _handlers: [], subscribed: false,
            on(event, filter, cb) { channel._handlers.push({ event: event, table: (filter && filter.table) || '', cb: cb }); return channel; },
            subscribe(cb) { channel.subscribed = true; if (cb) cb('SUBSCRIBED'); return channel; },
            unsubscribe() { return channel; }
        };
        server.channels.push(channel);
        return channel;
    };
    server.removeChannel = function (channel) {
        server.channels = server.channels.filter(c => c !== channel);
        return Promise.resolve({ status: 'ok' });
    };

    return server;
}

/* ══════════════════════════════════════════════════════════════════════════
   Minimal DOM (no jsdom, same approach as test-friends-social.js)
══════════════════════════════════════════════════════════════════════════ */

function createDom() {
    const byId = new Map();
    const timers = [];

    function makeElement(tag) {
        const children = new Map();
        const handlers = {};
        const attrs = {};
        const el = {
            tagName: String(tag || 'div').toUpperCase(),
            id: '', style: { cssText: '' }, dataset: {}, value: '', checked: false,
            disabled: false, textContent: '', innerHTML: '', scrollTop: 0, scrollHeight: 100,
            files: [], _kids: [],
            classList: {
                _set: new Set(),
                add(c) { this._set.add(c); },
                remove(c) { this._set.delete(c); },
                contains(c) { return this._set.has(c); },
                toggle(c, on) { if (on === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (on) this._set.add(c); else this._set.delete(c); }
            },
            appendChild(child) {
                if (child && child.id) byId.set(child.id, child);
                el._kids.push(child);
                return child;
            },
            removeChild(child) { el._kids = el._kids.filter(k => k !== child); return child; },
            insertBefore(child) { return el.appendChild(child); },
            remove() {
                if (el.id && byId.get(el.id) === el) byId.delete(el.id);
                el._removed = true;
            },
            focus() {}, blur() {}, scrollIntoView() {},
            click() { return el.fire('click', { target: el }); },
            setAttribute(k, v) { attrs[k] = String(v); },
            getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
            hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
            addEventListener(type, fn) {
                const list = (handlers[type] = handlers[type] || []);
                if (list.indexOf(fn) === -1) list.push(fn);
            },
            removeEventListener() {},
            async fire(type, ev) {
                const list = handlers[type] || [];
                for (const fn of list) await fn(ev || { target: el, preventDefault() {}, stopPropagation() {} });
            },
            querySelector(sel) {
                // '#id' resolves through the document registry, exactly like a
                // real DOM does for a node created by innerHTML: the element
                // becomes (or already is) a child of this node, so both
                // `panel.querySelector('#frChatBack')` and the
                // `host.querySelector('#navUserBadge')` dedupe check behave
                // like they do in the browser.
                if (typeof sel === 'string' && sel.charAt(0) === '#') {
                    const id = sel.slice(1);
                    let target = byId.get(id);
                    if (!target) {
                        target = makeElement('div');
                        target.id = id;
                        byId.set(id, target);
                    }
                    if (el._kids.indexOf(target) === -1) el._kids.push(target);
                    return target;
                }
                if (!children.has(sel)) children.set(sel, makeElement('div'));
                return children.get(sel);
            },
            querySelectorAll() { return []; },
            closest() { return null; },
            getContext() { return { drawImage() {} }; },
            toDataURL() { return 'data:image/jpeg;base64,' + 'A'.repeat(64); },
            onload: null, onerror: null, src: ''
        };
        // className and classList are two views of the same list in a real DOM.
        Object.defineProperty(el, 'className', {
            get() { return Array.from(el.classList._set).join(' '); },
            set(v) { el.classList._set = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean)); }
        });
        return el;
    }

    const body = makeElement('body');
    const head = makeElement('head');
    const document = {
        readyState: 'complete',
        hidden: false,
        documentElement: makeElement('html'),
        head: head, body: body,
        createElement(tag) { return makeElement(tag); },
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, makeElement('div'));
            const el = byId.get(id);
            el.id = id;
            return el;
        },
        querySelector(sel) {
            if (sel && sel.charAt(0) === '#' && byId.has(sel.slice(1))) return byId.get(sel.slice(1));
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        _byId: byId
    };

    return { document: document, body: body, head: head, timers: timers, makeElement: makeElement };
}

function createSandbox(server, user, dom, seedStorage) {
    const storage = Object.assign({}, seedStorage || {});
    const localStorage = {
        getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: k => { delete storage[k]; },
        key: i => Object.keys(storage)[i] || null,
        get length() { return Object.keys(storage).length; },
        _dump: () => Object.assign({}, storage)
    };

    const alerts = [];
    const listeners = {};

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document: dom.document,
        localStorage: localStorage,
        alert: msg => alerts.push(String(msg)),
        confirm: () => true,
        setTimeout: (fn, ms) => { dom.timers.push({ fn: fn, ms: ms || 0 }); return dom.timers.length; },
        setInterval: () => 1,
        clearInterval() {}, clearTimeout() {},
        fetch: () => Promise.reject(new Error('no network')),
        MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
        navigator: { onLine: true, userAgent: 'node-test', serviceWorker: undefined },
        location: { href: 'https://detectlab.ro/', search: '' },
        crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2), getRandomValues(a) { return a; } },
        Date: Date, Math: Math, JSON: JSON, Promise: Promise, Number: Number, String: String,
        Array: Array, Object: Object, Boolean: Boolean, isNaN: isNaN, isFinite: isFinite,
        parseInt: parseInt, parseFloat: parseFloat, RegExp: RegExp, Error: Error, Set: Set, Map: Map,
        encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
    };

    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.addEventListener = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
    sandbox.removeEventListener = function () {};
    sandbox.dispatchEvent = function (ev) {
        (listeners[(ev && ev.type) || ''] || []).forEach(function (fn) { try { fn(ev); } catch (e) {} });
        return true;
    };
    sandbox.supabaseClient = server;
    sandbox._authUser = () => user;
    sandbox._currentLang = () => 'ro';
    sandbox._alerts = alerts;
    sandbox._storage = storage;
    sandbox._fireWindowEvent = function (type, detail) { sandbox.dispatchEvent({ type: type, detail: detail || {} }); };
    // maxMs keeps the long auto-hide timers (9 s) queued, so a test can run the
    // 160 ms pop-up stagger without also dismissing the cards it just made.
    sandbox._flushTimers = async function (maxMs) {
        const limit = (maxMs === undefined) ? Infinity : Number(maxMs);
        const pending = dom.timers.splice(0, dom.timers.length);
        const kept = [];
        for (const t of pending) {
            if ((t.ms || 0) <= limit) await t.fn(); else kept.push(t);
        }
        kept.forEach(t => dom.timers.push(t));
    };
    return sandbox;
}

function runInSandbox(sandbox, sources) {
    const ctx = vm.createContext(sandbox);
    sources.forEach(src => vm.runInContext(src.code, ctx, { filename: src.name }));
    return ctx;
}

function flush(times) {
    let p = Promise.resolve();
    for (let i = 0; i < (times || 8); i++) p = p.then(() => new Promise(r => setImmediate(r)));
    return p;
}

async function boot(server, user, seedStorage) {
    const dom = createDom();
    const sandbox = createSandbox(server, user, dom, seedStorage);
    runInSandbox(sandbox, [{ code: FRIENDS_JS, name: 'js/friends.js' }]);
    sandbox._fireWindowEvent('detectlab:authchange', { user: user });
    await sandbox._flushTimers();
    await flush(12);
    return { dom: dom, sandbox: sandbox, api: sandbox.DetectLabFriends, notify: sandbox.DetectLabNotify };
}

function badgeOf(dom, id) {
    const el = dom.document.getElementById(id);
    return { text: el.textContent, hidden: el.classList.contains('hidden'), pulse: el.classList.contains('pulse') };
}

function cards(notify) {
    return notify.list().map(function (entry) {
        return {
            key: entry.key, kind: entry.kind, id: entry.id,
            html: entry.el.innerHTML, el: entry.el
        };
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 1 — the red badge on the profile button
══════════════════════════════════════════════════════════════════════════ */

async function partBadge() {
    console.log('\n[1] the red notification badge on the profile button');

    const server = createSocialServer();
    const { dom, api, notify } = await boot(server, ME);

    assert(notify, 'window.DetectLabNotify must be exposed for js/events.js');
    assert.strictEqual(typeof notify.setSourceCount, 'function', 'setSourceCount() must exist');

    // Nothing waiting → both profile badges exist but stay hidden.
    let nav = badgeOf(dom, 'navUserBadge');
    let pwa = badgeOf(dom, 'pwaUserBadge');
    assert.strictEqual(nav.hidden, true, 'the desktop badge must be hidden with an empty inbox');
    assert.strictEqual(pwa.hidden, true, 'the PWA badge must be hidden with an empty inbox');
    assert(dom.document.getElementById('navUser')._kids.some(k => k.id === 'navUserBadge'),
        'the badge must sit in the corner of the profile button (#navUser)');
    assert(dom.document.getElementById('pwaUserTrigger')._kids.some(k => k.id === 'pwaUserBadge'),
        'the badge must sit in the corner of the PWA profile trigger (#pwaUserTrigger)');
    ok('the profile button (desktop + PWA) carries the badge and it is hidden when nothing waits');

    // A friend request + two unread messages land → one red dot with the sum.
    server.receiveRequest(ELENA, 'Hai la detectat sâmbătă!', 60 * 1000);
    server.receiveMessage('c-mihai', MIHAI, 'Salut! Ai văzut noua zonă?', 30 * 1000);
    server.receiveMessage('c-mihai', MIHAI, 'Îți trimit coordonatele.', 10 * 1000);
    await api.pollCounters();
    await flush(8);

    nav = badgeOf(dom, 'navUserBadge');
    pwa = badgeOf(dom, 'pwaUserBadge');
    assert.strictEqual(nav.text, '3', 'the badge must count 1 request + 2 unread messages, got ' + nav.text);
    assert.strictEqual(nav.hidden, false, 'the badge must be visible');
    assert.strictEqual(nav.pulse, true, 'the badge must pulse while something waits');
    assert.strictEqual(pwa.text, '3', 'the PWA badge must show the same count');
    assert.strictEqual(notify.getSourceCount('social'), 3, 'the social source must hold 3');
    ok('1 cerere + 2 mesaje necitite → cerculeț roșu „3” pe butonul de profil (desktop și PWA)');

    // The „Prieteni” menu entry keeps its own social-only badge.
    assert.strictEqual(dom.document.getElementById('navFriendsBadge').textContent, '3',
        'the Friends entry keeps a social-only badge');

    // js/events.js writes its own source into the SAME elements.
    notify.setSourceCount('events', 2);
    nav = badgeOf(dom, 'navUserBadge');
    assert.strictEqual(nav.text, '5', 'events (2) + social (3) must add up on the profile button, got ' + nav.text);
    assert.strictEqual(dom.document.getElementById('navFriendsBadge').textContent, '3',
        'the Friends entry must stay social-only');
    notify.setSourceCount('events', 0);
    assert.strictEqual(badgeOf(dom, 'navUserBadge').text, '3', 'the events source must be removable again');
    ok('js/events.js și js/friends.js adună în același badge (2 + 3 = 5), fără să se suprascrie');

    // Reading the thread drops the count at once — no 20 s wait.
    const conv = server.conversations.filter(c => c.id === 'c-mihai')[0];
    assert.strictEqual(conv.unread_count, 2, 'the mock thread must be unread before the test reads it');
    await api.openChatWithUser(MIHAI.id);
    await flush(12);
    assert.strictEqual(server.conversations.filter(c => c.id === 'c-mihai')[0].unread_count, 0,
        'opening the thread must mark it read server-side');
    assert.strictEqual(notify.getSourceCount('social'), 1, 'only the pending request must remain on the badge');
    assert.strictEqual(badgeOf(dom, 'navUserBadge').text, '1', 'the red dot must drop to 1 the moment the chat is read');
    ok('citirea chat-ului scade imediat cerculețul (3 → 1), fără să aștepte următorul poll');

    return { server: server, dom: dom, api: api, notify: notify };
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 2 — the pop-up cards
══════════════════════════════════════════════════════════════════════════ */

async function partPopups() {
    console.log('\n[2] pop-up notifications for a new request / a new message');

    const server = createSocialServer();
    const { dom, sandbox, api, notify } = await boot(server, ME);
    assert.strictEqual(notify.list().length, 0, 'an empty inbox must not pop anything on boot');
    assert(server.channels.some(c => c.name === 'dl-social-inbox'),
        'the inbox realtime channel must be open while signed in');
    ok('boot cu inbox-ul gol: niciun pop-up, iar canalul realtime de inbox e deschis');

    /* ── a friend request arrives while the map is open ── */
    server.receiveRequest(ELENA, 'Hai la detectat sâmbătă!', 5 * 1000);
    await api.pollCounters();
    await flush(8);
    let list = cards(notify);
    assert.strictEqual(list.length, 1, 'one request must pop exactly one card, got ' + list.length);
    assert.strictEqual(list[0].kind, 'request', 'the card must be a request card');
    assert(/Cerere de prietenie de la Elena Dobre/.test(list[0].html), 'the card must name the requester: ' + list[0].html);
    assert(/Hai la detectat/.test(list[0].html), 'the card must quote the request message');
    assert(list[0].el.classList.contains('is-request'), 'the card must carry the request styling');
    ok('o cerere de prietenie nouă apare ca pop-up cu numele și mesajul ei');

    // Tapping the card opens the panel straight on the „Cereri” tab.
    await list[0].el.fire('click', { target: list[0].el });
    await flush(12);
    const panel = dom.document.getElementById('friendsManagerPanel');
    assert(panel && !panel._removed, 'tapping the card must open the Friends panel');
    assert(/data-tab="requests"/.test(panel.innerHTML), 'the panel must render the requests tab');
    assert.strictEqual(notify.list().length, 0, 'tapping a card must dismiss it');
    ok('tap pe pop-up → se deschide „Prieteni” direct pe tabul „Cereri”');

    /* ── a message arrives through the realtime channel (instant) ── */
    const row = server.receiveMessage('c-mihai', MIHAI, 'Am găsit o monedă romană!', 1000);
    const delivered = server.emitRealtime(row);
    assert.strictEqual(delivered, 1, 'the realtime frame must reach the inbox channel');
    await flush(6);
    list = cards(notify);
    const msgCard = list.filter(c => c.kind === 'message')[0];
    assert(msgCard, 'a realtime message must pop a card without waiting for the poll');
    assert(/Mesaj nou de la Mihai Ionescu/.test(msgCard.html), 'the card must name the sender: ' + msgCard.html);
    assert(/monedă romană/.test(msgCard.html), 'the card must preview the message');
    ok('un mesaj nou apare instant ca pop-up prin canalul realtime (numele + preview-ul lui)');

    // The very same message must not pop twice — neither from realtime again,
    // nor from the next counter poll.
    server.emitRealtime(row);
    await api.pollCounters();
    await flush(8);
    const dupes = cards(notify).filter(c => c.kind === 'message');
    assert.strictEqual(dupes.length, 1, 'the same message must never pop twice, got ' + dupes.length);
    ok('același mesaj nu mai apare a doua oară (nici la realtime, nici la poll)');

    // Tapping it opens that exact thread and marks it read.
    await dupes[0].el.fire('click', { target: dupes[0].el });
    await flush(14);
    const chat = dom.document.getElementById('friendChatPanel');
    assert(chat && !chat._removed, 'tapping the card must open the chat panel');
    assert(/Mihai Ionescu/.test(chat.innerHTML), 'the chat must be the one with the sender');
    assert.strictEqual(server.conversations.filter(c => c.id === 'c-mihai')[0].unread_count, 0,
        'opening the thread from the pop-up must mark it read');
    ok('tap pe pop-up → se deschide exact conversația și se marchează ca citită');

    /* ── what must NOT pop ── */
    // A message in the thread you are already reading (the open chat has its
    // own realtime channel too, so the frame reaches more than one listener).
    const openRow = server.receiveMessage('c-mihai', MIHAI, 'Mai ești acolo?', 500);
    assert(server.emitRealtime(openRow) >= 1, 'the frame must still be delivered');
    await flush(6);
    assert.strictEqual(cards(notify).filter(c => /Mai ești acolo/.test(c.html)).length, 0,
        'a message in the OPEN thread must not pop (you are reading it)');

    // Your own message echoed from another device/tab.
    const mine = {
        id: 'msg-mine-1', conversation_id: 'c-mihai', sender_id: ME.id, sender_name: ME.name,
        body: 'Mesajul meu propriu', media_type: 'none', created_at: iso(200)
    };
    server.emitRealtime(mine);
    await flush(6);
    assert.strictEqual(cards(notify).filter(c => /Mesajul meu propriu/.test(c.html)).length, 0,
        'your own message must never pop');
    ok('nu apare pop-up pentru thread-ul deja deschis nici pentru mesajele tale');

    // ✕ dismisses without opening anything.
    server.addGroup('c-group', 'Detectat Cluj', [MIHAI, ELENA]);
    const groupRow = server.receiveMessage('c-group', ELENA, 'Ne vedem la 7 dimineața?', 300);
    server.emitRealtime(groupRow);
    await flush(14);
    let groupCard = cards(notify).filter(c => c.id === 'c-group')[0];
    assert(groupCard, 'a group message must pop too');
    assert(/Mesaj nou în „Detectat Cluj”/.test(groupCard.html), 'the group card must name the group: ' + groupCard.html);
    assert(/👥/.test(groupCard.html), 'the group card must use the group icon');
    const closeBtn = groupCard.el.querySelector('.dl-notify-close');
    closeBtn.classList.add('dl-notify-close');
    await groupCard.el.fire('click', { target: closeBtn });
    await flush(4);
    assert.strictEqual(cards(notify).filter(c => c.id === 'c-group').length, 0, '✕ must dismiss the card');
    ok('cardul de grup poartă numele grupului, iar ✕ îl închide fără să deschidă nimic');

    /* ── already on screen → silent; a flood → one card ── */
    // The panel is still open on the „Cereri” tab: the very requests you are
    // looking at must not pop again.
    notify.clear();
    for (let i = 0; i < 5; i++) {
        server.receiveRequest({ id: 'u-onscreen-' + i, name: 'Detectorist ' + i }, null, 1000 + i);
    }
    await api.pollCounters();
    await flush(10);
    assert.strictEqual(cards(notify).filter(c => c.kind === 'request').length, 0,
        'while the „Cereri” tab is open the new requests must not pop');
    ok('când tabul „Cereri” e deja deschis, noile cereri nu mai apar ca pop-up');

    // Panel closed: five requests in one poll collapse into a single card.
    sandbox._closeFriendsPanel();
    for (let i = 0; i < 5; i++) {
        server.receiveRequest({ id: 'u-stranger-' + i, name: 'Detectorist ' + i }, null, 1000 + i);
    }
    await api.pollCounters();
    await flush(12);
    const bulk = cards(notify).filter(c => c.kind === 'request');
    assert.strictEqual(bulk.length, 1, '5 requests at once must collapse into ONE card, got ' + bulk.length);
    assert(/5 cereri de prietenie noi/.test(bulk[0].html), 'the card must say how many: ' + bulk[0].html);
    assert(/Detectorist 0/.test(bulk[0].html), 'the card must name the first requesters');
    ok('5 cereri deodată → un singur pop-up agregat („5 cereri de prietenie noi”)');

    return { server: server, dom: dom, sandbox: sandbox, api: api, notify: notify };
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 3 — reloads, backlogs and logout
══════════════════════════════════════════════════════════════════════════ */

async function partReloadAndBacklog() {
    console.log('\n[3] reload, backlog and logout behaviour');

    const server = createSocialServer();
    const first = await boot(server, ME);

    // Something arrives, the card pops, the mirror records the announcement.
    server.receiveRequest(ELENA, 'Ne cunoaștem de la Târnăveni.', 2000);
    server.receiveMessage('c-mihai', MIHAI, 'Vezi că plouă mâine.', 1000);
    await first.api.pollCounters();
    await flush(8);
    await first.sandbox._flushTimers(1000);      // the staggered second card
    await flush(8);
    assert.strictEqual(first.notify.list().length, 2, 'a request and a message must pop two cards');

    const mirrorKey = 'detectlab_social_v1:' + ME.id;
    const mirror = JSON.parse(first.sandbox._storage[mirrorKey]);
    assert(mirror && mirror.inboxSeen, 'the announcement marks must live in the per-account mirror');
    assert(Object.keys(mirror.inboxSeen.requests).length === 1, 'the request must be marked as announced');
    assert(mirror.inboxSeen.messages['c-mihai'], 'the conversation must be marked as announced');
    ok('pop-up-urile anunțate sunt marcate în oglinda contului (detectlab_social_v1:<userId>)');

    // A plain reload with the same inbox: the badge is there, the pop-ups are not.
    const second = await boot(server, ME, first.sandbox._storage);
    assert.strictEqual(second.notify.list().length, 0, 'a reload must not replay the same announcements');
    assert.strictEqual(second.notify.getSourceCount('social'), 2, 'the badge must still show 1 request + 1 message');
    assert.strictEqual(badgeOf(second.dom, 'navUserBadge').text, '2', 'the red dot survives the reload');
    ok('la reîncărcare cerculețul rămâne (2), dar pop-up-urile nu se repetă');

    // A backlog older than a week is a badge, never a pop-up.
    const third = createSocialServer();
    third.receiveRequest(ELENA, 'Cerere veche.', 12 * DAY);
    third.receiveMessage('c-mihai', MIHAI, 'Mesaj vechi.', 12 * DAY);
    const thirdBoot = await boot(third, ME);
    await flush(6);
    assert.strictEqual(thirdBoot.notify.list().length, 0, 'a 12-day-old backlog must not pop');
    assert.strictEqual(thirdBoot.notify.getSourceCount('social'), 2, '…but it must still count on the badge');
    ok('un backlog mai vechi de 7 zile rămâne doar pe badge, fără pop-up');

    // Logout: the cards of the previous account disappear and the badge resets.
    thirdBoot.sandbox._authUser = () => null;
    thirdBoot.sandbox._fireWindowEvent('detectlab:authchange', { user: null });
    await thirdBoot.sandbox._flushTimers();
    await flush(8);
    assert.strictEqual(thirdBoot.notify.list().length, 0, 'logout must clear the cards');
    assert.strictEqual(thirdBoot.notify.getSourceCount('social'), 0, 'logout must clear the social count');
    assert.strictEqual(badgeOf(thirdBoot.dom, 'navUserBadge').hidden, true, 'logout must hide the red dot');
    assert.strictEqual(third.channels.filter(c => c.name === 'dl-social-inbox').length, 0,
        'logout must close the inbox channel');
    ok('la deconectare se șterg cardurile, cerculețul și canalul de inbox');
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 4 — js/events.js writes through the shared surface, wiring ships
══════════════════════════════════════════════════════════════════════════ */

async function partWiring() {
    console.log('\n[4] js/events.js + index.html + sw.js wiring');

    // events.js must hand its count to DetectLabNotify instead of painting the
    // profile badge itself (otherwise it erases the social count).
    assert(/setSourceCount\('events'/.test(EVENTS_JS),
        'js/events.js must feed the shared badge through DetectLabNotify.setSourceCount("events", …)');
    assert(/window\.DetectLabNotify/.test(EVENTS_JS), 'js/events.js must look the shared surface up');
    const eventPaint = EVENTS_JS.indexOf("notify.setSourceCount('events', count)");
    const profileList = EVENTS_JS.indexOf("var PROFILE_BADGE_IDS = ['navUserBadge','pwaUserBadge']");
    assert(eventPaint > -1 && profileList > -1, 'the profile badges must be routed through the shared surface');
    ok('js/events.js își raportează chat-urile necitite către badge-ul comun, nu direct');

    // events.js still works alone (no friends.js loaded): the fallback paints
    // the profile badges itself.
    {
        const dom = createDom();
        const sandbox = createSandbox(createSocialServer(), null, dom);
        sandbox._authUser = () => null;
        runInSandbox(sandbox, [{ code: EVENTS_JS, name: 'js/events.js' }]);
        assert.strictEqual(typeof sandbox._updateEventBadges, 'function', 'events.js must expose _updateEventBadges');
        const count = await sandbox._updateEventBadges();
        assert.strictEqual(count, 0, 'signed out → nothing to count');
        const el = dom.document.getElementById('navUserBadge');
        assert(el.classList.contains('hidden'), 'signed out → the profile badge must be hidden');
        ok('events.js singur (fără friends.js) pictează badge-ul prin fallback și îl ascunde la delogare');
    }

    // index.html ships the new versions and loads friends.js after events.js.
    assert(/js\/friends\.js\?v=20260918-social-notify/.test(INDEX_HTML), 'index.html must load the new friends.js');
    assert(/js\/events\.js\?v=20260918-social-notify/.test(INDEX_HTML), 'index.html must load the new events.js');
    assert(INDEX_HTML.indexOf('js/events.js?v=20260918-social-notify') < INDEX_HTML.indexOf('js/friends.js?v=20260918-social-notify'),
        'events.js must load before friends.js (the shared surface lives in friends.js)');
    assert(/window\.DetectLabNotify/.test(FRIENDS_JS), 'friends.js must expose window.DetectLabNotify');
    ok('index.html încarcă noile versiuni, events.js înaintea friends.js');

    // The PWA pre-caches both and bumps the app shell.
    assert(/detectlab-v110-social-notify/.test(SW_JS), 'sw.js must bump the cache name');
    assert(/'js\/friends\.js\?v=20260918-social-notify'/.test(SW_JS), 'sw.js must pre-cache the new friends.js');
    assert(/'js\/events\.js\?v=20260918-social-notify'/.test(SW_JS), 'sw.js must pre-cache the new events.js');
    ok('sw.js pre-cache-uiește ambele fișiere și sare la detectlab-v110-social-notify');

    // The pop-up styles ship with the social stylesheet.
    ['#dlNotifyStack', '.dl-notify', 'dlNotifyIn', '.dl-notify-close'].forEach(function (needle) {
        assert(FRIENDS_JS.indexOf(needle) !== -1, 'the notification styles must include ' + needle);
    });
    ok('stilurile pop-up-ului (#dlNotifyStack / .dl-notify) sunt în stylesheet-ul social');
}

/* ══════════════════════════════════════════════════════════════════════════ */

(async function main() {
    console.log('DetectLab — social notifications (badge on the profile button + pop-ups)');
    try {
        await partBadge();
        await partPopups();
        await partReloadAndBacklog();
        await partWiring();
    } catch (err) {
        console.error('\n❌ ' + (err && err.message ? err.message : err));
        if (err && err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
        process.exit(1);
    }
    console.log('\n✅ test-social-notify.js passed (' + passed + ' checks): the profile button shows the red');
    console.log('   badge for requests + messages (summed with the event chats) and every new request or');
    console.log('   message pops a card that opens exactly what it announces.');
})();
