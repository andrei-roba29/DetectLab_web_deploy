// Regression test: tapping a detectorist pin on the map ("Vezi alți detectoriști
// în zonă") must offer the social action that matches the relationship with that
// account — send a friend request to a stranger, accept a pending request
// addressed to us, cancel our own pending request, or send a message when you
// are already friends.
//
// What the feature is
// -------------------
// * js/map-app.js renders the live (orange) and offline (black/white) pins with
//   an EMPTY .detector-social-actions slot holding only the account id + name
//   (detectorSocialSlotHtml) and wires map.on('popupopen') to
//   window.DetectLabFriends.decorateDetectorPopup(popupEl).
// * js/friends.js owns the friend state: relationFor() answers what the
//   relationship is, detectorActionsHtml() paints the single button that
//   matches it, decorateDetectorPopup() repaints the slot every time a popup
//   opens (and after the lists are refreshed) and one delegated capture-phase
//   click listener acts on data-social-action (add / accept / cancel / message).
//
// The test therefore runs the REAL code of both files (no jsdom):
//   1. js/map-app.js — searchNearbyDetectors() + addOfflineDetectorBubbles() in
//      a vm sandbox with Leaflet/Supabase stubs, asserting both popups carry
//      the slot with the right account id and kind, and that the popupopen hook
//      calls into friends.js;
//   2. js/friends.js — relationFor()/detectorActionsHtml() against every
//      relationship (stranger is the ONLY one that offers "Adaugă prietenie");
//   3. js/friends.js end to end in a tiny fake DOM: the decorated slot, the
//      click on "＋ Adaugă prietenie" turning into a real send_friend_request
//      call (and the slot flipping to "Cerere de prietenie trimisă / Anulează"),
//      accepting an incoming request and opening the chat for a friend;
//   4. index.html / sw.js wiring (script order + cache-busted precache).
//
// Run: node test-map-friend-actions.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'js/map-app.js'), 'utf8');
const FRIENDS_SRC = fs.readFileSync(path.join(ROOT, 'js/friends.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
    if (!cond) {
        console.error('✗ ' + name + (extra ? '\n    ' + extra : ''));
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log('✓ ' + name);
}
function section(title) { console.log('\n' + title); }

/* ── source helpers ────────────────────────────────────────────────────────── */

function extractFn(src, marker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('could not find "' + marker + '"');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j + 1);
        }
    }
    throw new Error('unbalanced braces for "' + marker + '"');
}

/* ══════════════════════════════════════════════════════════════════════════
   1. js/map-app.js — both detectorist popups carry the social slot
   ══════════════════════════════════════════════════════════════════════════ */

section('[1] js/map-app.js — live + offline detectorist popups');

const LIVE_ROWS = [
    // Our OWN other device: must be skipped by the search (no popup at all).
    { user_id: 'u-me', device_id: 'device-me', full_name: 'Me Myself', email: 'me@example.com', latitude: 45.7480, longitude: 21.2080 },
    { user_id: 'u-live', device_id: 'device-other', full_name: 'Ana <Live>', email: 'ana@example.com', latitude: 45.7500, longitude: 21.2100 }
];
const LAST_ROWS = [
    { user_id: 'u-me', full_name: 'Me Myself', latitude: 45.748, longitude: 21.208, county: 'Timis', label: 'Timisoara, Timis' },
    { user_id: 'u-offline', full_name: 'Andrei Popescu', latitude: 45.755, longitude: 21.230, county: 'Timis', label: 'Timisoara, Timis', updated_at: '2026-09-05T08:15:00.000Z' },
    { user_id: 'u-live', full_name: 'Ana <Live>', latitude: 45.750, longitude: 21.210, county: 'Timis', label: 'Timisoara, Timis' }
];

function makeMapSandbox() {
    const captured = { markers: [], layers: [], mapHandlers: {}, fits: 0 };
    const elements = {};
    function el(id) {
        if (!elements[id]) {
            elements[id] = {
                id: id, innerHTML: '', textContent: '', style: {},
                classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
            };
        }
        return elements[id];
    }

    const sandbox = {
        console: { warn() {}, log() {} },
        Promise, Date, Math, JSON, Number, String, Array, Object, RegExp,
        isFinite, isNaN, setTimeout, clearTimeout, setInterval, clearInterval,
        // ── state normally owned by the map-app closure ──
        _det: { active: true },
        _detLat: 45.7489,
        _detLng: 21.2087,
        _visibleToOthers: true,
        DETECTOR_DEVICE_ID: 'device-me',
        navigator: { geolocation: {} },
        toggleDetection() {},
        _syncDetectSwitchUI() {},
        waitForDetPosition: async function () { return true; },
        publishDetectorPresence: async function () { return true; },
        nearbyUser: function () { return { id: 'u-me' }; },
        nearbyDistance: function (a, b, c, d) {
            const R = 6371, x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180;
            const q = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(q));
        },
        document: { getElementById: el, querySelectorAll() { return []; } },
        L: {
            divIcon(opts) { return { options: opts }; },
            marker(latlng, opts) {
                const m = {
                    latlng: latlng, options: opts || {},
                    getLatLng() { return { lat: latlng[0], lng: latlng[1] }; },
                    bindPopup(html, options) { m.popup = { html: html, options: options || null }; return m; },
                    addTo(layer) { layer.addLayer(m); captured.markers.push(m); return m; }
                };
                return m;
            },
            layerGroup() {
                return {
                    _layers: [],
                    addLayer(l) { this._layers.push(l); return this; },
                    addTo() { return this; },
                    getLayers() { return this._layers; },
                    clearLayers() { this._layers = []; return this; }
                };
            },
            latLngBounds(latlngs) {
                return { _latlngs: latlngs, pad() { return this; }, extend() { return this; } };
            }
        },
        map: {
            on(type, fn) { (captured.mapHandlers[type] = captured.mapHandlers[type] || []).push(fn); return this; },
            fitBounds() { captured.fits++; },
            closePopup() {}
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.nearbyLayer = sandbox.L.layerGroup();
    sandbox.supabaseClient = {
        from() {
            return {
                select() { return this; },
                eq() { return this; },
                gt() { return Promise.resolve({ data: LIVE_ROWS, error: null }); }
            };
        }
    };
    sandbox.DetectLabLastLocation = {
        recordLastLocation: async function () { return null; },
        getMyLastLocation: function () { return LAST_ROWS[0]; },
        resolveBroadLocation: async function () { return { county: 'Timis' }; },
        fetchLastLocations: async function () { return LAST_ROWS.slice(); },
        sameCounty: function (a, b) {
            const n = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
            return n(a) === n(b);
        }
    };
    return { sandbox: sandbox, captured: captured, elements: elements };
}

(async function runMapPart() {
    const { sandbox, captured } = makeMapSandbox();
    vm.createContext(sandbox);
    vm.runInContext(
        extractFn(MAP_SRC, 'function nearbyInitials(') + '\n' +
        extractFn(MAP_SRC, 'function detectorSocialSlotHtml(') + '\n' +
        extractFn(MAP_SRC, 'async function addOfflineDetectorBubbles(') + '\n' +
        extractFn(MAP_SRC, 'window.searchNearbyDetectors = async function()') + ';\n' +
        // the real map registration, run against the sandbox map stub
        extractFn(MAP_SRC, "map.on('popupopen'") + ');',
        sandbox
    );

    await sandbox.searchNearbyDetectors();

    const liveMarkers = captured.markers.filter(m => /detector-nearby-marker/.test((m.options.icon || {}).options.html || ''));
    const offlineMarkers = captured.markers.filter(m => /detector-offline-marker/.test((m.options.icon || {}).options.html || ''));

    check('the search draws the live pin and the offline bubble (own device skipped)',
        liveMarkers.length === 1 && offlineMarkers.length === 1,
        'live=' + liveMarkers.length + ', offline=' + offlineMarkers.length);
    if (!liveMarkers.length || !offlineMarkers.length) return;

    const liveHtml = liveMarkers[0].popup.html;
    check('live pin popup keeps the name and the e-mail',
        /Ana/.test(liveHtml) && /ana@example\.com/.test(liveHtml), liveHtml);
    check('live pin popup carries the social slot for that ACCOUNT (not the device)',
        /class="detector-social-actions"/.test(liveHtml) &&
        /data-user-id="u-live"/.test(liveHtml) &&
        /data-detector-kind="live"/.test(liveHtml),
        (liveHtml.match(/<div class="detector-social-actions"[^>]*>/) || ['<none>'])[0]);
    check('the live slot is empty in the markup (friends.js paints it on popupopen)',
        !/data-social-action=/.test(liveHtml));

    const offlineHtml = offlineMarkers[0].popup.html;
    check('offline bubble popup carries the social slot too',
        /class="detector-social-actions"/.test(offlineHtml) &&
        /data-user-id="u-offline"/.test(offlineHtml) &&
        /data-detector-kind="offline"/.test(offlineHtml),
        (offlineHtml.match(/<div class="detector-social-actions"[^>]*>/) || ['<none>'])[0]);

    /* the popupopen hook must hand the popup element over to friends.js */
    check('map.on(\'popupopen\') is registered', !!captured.mapHandlers.popupopen && captured.mapHandlers.popupopen.length === 1);

    const decorated = [];
    sandbox.DetectLabFriends = {
        decorateDetectorPopup(root) { decorated.push(root); return 1; }
    };
    const popupEl = { isPopup: true };
    captured.mapHandlers.popupopen.forEach(fn => fn({ popup: { getElement: () => popupEl } }));
    check('opening a detectorist popup calls DetectLabFriends.decorateDetectorPopup(popup)',
        decorated.length === 1 && decorated[0] === popupEl, 'calls=' + decorated.length);

    /* a missing friends.js must never break the popup */
    let threw = false;
    sandbox.DetectLabFriends = undefined;
    try { captured.mapHandlers.popupopen.forEach(fn => fn({ popup: { getElement: () => popupEl } })); }
    catch (e) { threw = true; }
    check('the popup opens unchanged when the social layer is not loaded', !threw);

    /* and a popup without our slot is ignored */
    let callsWithoutSlot = 0;
    sandbox.DetectLabFriends = { decorateDetectorPopup() { callsWithoutSlot++; return 0; } };
    captured.mapHandlers.popupopen.forEach(fn => fn({ popup: { getElement: () => ({ other: true }) } }));
    check('the hook is harmless for every other Leaflet popup', callsWithoutSlot === 1);

    runRendererPart();
})().catch(function (e) {
    console.error('✗ map part crashed: ' + (e && e.stack || e));
    process.exitCode = 1;
});

/* ══════════════════════════════════════════════════════════════════════════
   2. js/friends.js — which button per relationship
   ══════════════════════════════════════════════════════════════════════════ */

function makeRendererSandbox() {
    const sandbox = {
        console: { warn() {}, log() {} },
        Promise, Date, Math, JSON, Number, String, Array, Object, RegExp,
        state: { friends: [], incomingRequests: [], outgoingRequests: [] },
        _me: { id: 'u-me' },
        _lang: 'ro'
    };
    sandbox.window = sandbox;
    sandbox.currentUser = function () { return sandbox._me; };
    sandbox._currentLang = function () { return sandbox._lang; };
    vm.createContext(sandbox);
    vm.runInContext(
        extractFn(FRIENDS_SRC, 'function escapeHtml(') + '\n' +
        extractFn(FRIENDS_SRC, 'function isRo(') + '\n' +
        extractFn(FRIENDS_SRC, 'function t(') + '\n' +
        extractFn(FRIENDS_SRC, 'function relationFor(') + '\n' +
        extractFn(FRIENDS_SRC, 'function requestIdFor(') + '\n' +
        extractFn(FRIENDS_SRC, 'function detectorActionsHtml(') + '\n' +
        'globalThis.__html = detectorActionsHtml;\n' +
        'globalThis.__rel = relationFor;\n',
        sandbox
    );
    return sandbox;
}

function runRendererPart() {
    section('[2] js/friends.js — the button that matches the relationship');

    const s = makeRendererSandbox();
    const rel = s.__rel;
    const html = s.__html;

    // A stranger: the ONLY case that offers a new friend request.
    s.state.friends = [];
    s.state.outgoingRequests = [];
    s.state.incomingRequests = [];
    let out = html('u-stranger', { name: 'Ion' });
    check('stranger → "＋ Adaugă prietenie" (data-social-action="add")',
        /data-social-action="add"/.test(out) && /Adaugă prietenie/.test(out) && !/Trimite mesaj/.test(out), out);
    check('stranger is tagged with the account id and name for the click handler',
        /data-user-id="u-stranger"/.test(out) && /data-user-name="Ion"/.test(out), out);

    // Already friends: message button, never a friend request.
    s.state.friends = [{ user_id: 'u-friend', display_name: 'Ana', conversation_id: 'c1' }];
    out = html('u-friend', { name: 'Ana' });
    check('friend → "💬 Trimite mesaj" (data-social-action="message")',
        /data-social-action="message"/.test(out) && /Trimite mesaj/.test(out), out);
    check('friend never sees a friend-request button', !/data-social-action="add"/.test(out));

    // Our request is pending: status + cancel, never a second request.
    s.state.friends = [];
    s.state.outgoingRequests = [{ id: 'req-1', other_id: 'u-pending', status: 'pending' }];
    out = html('u-pending', { name: 'Vlad' });
    check('request sent by us → "Cerere de prietenie trimisă" + "Anulează"',
        /data-social-action="cancel"/.test(out) && /Cerere de prietenie trimisă/.test(out) && /Anulează/.test(out), out);
    check('a pending outgoing request never offers a duplicate "Adaugă"',
        !/data-social-action="add"/.test(out));
    check('relationFor() reports request_sent with the request id',
        rel('u-pending').state === 'request_sent' && rel('u-pending').requestId === 'req-1',
        JSON.stringify(rel('u-pending')));

    // Their request is pending: accepting is the only forward action.
    s.state.outgoingRequests = [];
    s.state.incomingRequests = [{ id: 'req-2', other_id: 'u-incoming', status: 'pending' }];
    out = html('u-incoming', { name: 'Maria' });
    check('request received → "✓ Acceptă cererea" (data-social-action="accept")',
        /data-social-action="accept"/.test(out) && /Acceptă cererea/.test(out), out);

    // Nothing to offer: myself, nobody signed in, unknown id.
    check('another device of my own account → no action button',
        !/data-social-action/.test(html('u-me', { name: 'Me' })) && rel('u-me').state === 'self');
    s._me = null;
    check('nobody signed in → nothing rendered', html('u-friend', {}) === '' && rel('u-friend').state === 'anonymous');
    s._me = { id: 'u-me' };
    check('missing account id → nothing rendered', html('', {}).includes('<button') === false);

    // Names come from other users — they must never break out of the markup.
    s.state.incomingRequests = [];
    s.state.friends = [];
    out = html('u-xss', { name: '"><img src=x onerror=alert(1)>' });
    check('the display name is HTML-escaped in the button attributes',
        /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/.test(out) && !/<img/.test(out), out);

    // English UI.
    s._lang = 'en';
    check('EN stranger label is "Add friend"', /Add friend/.test(html('u-stranger', { name: 'Ion' })));
    s.state.friends = [{ user_id: 'u-friend2', display_name: 'Ana' }];
    check('EN friend label is "Send message"', /Send message/.test(html('u-friend2', { name: 'Ana' })));
    s.state.friends = [];
    s.state.outgoingRequests = [{ id: 'r', other_id: 'u-p', status: 'pending' }];
    check('EN pending label is "Friend request sent"', /Friend request sent/.test(html('u-p', {})));
    s.state.outgoingRequests = [];
    s.state.incomingRequests = [{ id: 'r2', other_id: 'u-i', status: 'pending' }];
    check('EN incoming label is "Accept request"', /Accept request/.test(html('u-i', {})));
    s._lang = 'ro';

    runIntegrationPart();
}

/* ══════════════════════════════════════════════════════════════════════════
   3. js/friends.js in a tiny fake DOM — decorate + click → real RPC
   ══════════════════════════════════════════════════════════════════════════ */

function makeFakeDom() {
    const byId = new Map();
    const slots = [];
    const docHandlers = {};

    function makeEl(tag) {
        const children = [];
        const attrs = {};
        const handlers = {};
        const el = {
            tagName: tag, style: {}, children: children, id: '', innerHTML: '', textContent: '',
            className: '', disabled: false, _attrs: attrs,
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            appendChild(c) { children.push(c); return c; },
            removeChild(c) { return c; },
            remove() {},
            insertBefore(c) { return el.appendChild(c); },
            focus() {}, blur() {}, click() {},
            setAttribute(k, v) { attrs[k] = String(v); },
            getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
            hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
            addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
            removeEventListener() {},
            async fire(type, ev) {
                for (const fn of (handlers[type] || [])) await fn(ev || { target: el, preventDefault() {}, stopPropagation() {} });
            },
            querySelector(sel) {
                if (typeof sel !== 'string') return null;
                if (sel.charAt(0) === '#') {
                    const id = sel.slice(1);
                    if (!byId.has(id)) { const e = makeEl('div'); e.id = id; byId.set(id, e); }
                    return byId.get(id);
                }
                if (sel.charAt(0) === '[') return el._msg || (el._msg = makeEl('div'));
                return children.filter(c => (' ' + c.className + ' ').indexOf(' ' + sel.slice(1) + ' ') !== -1)[0] || null;
            },
            querySelectorAll(sel) {
                if (typeof sel === 'string' && sel.charAt(0) === '.') {
                    return children.filter(c => (' ' + c.className + ' ').indexOf(' ' + sel.slice(1) + ' ') !== -1);
                }
                return [];
            },
            contains(node) { return node === el || children.indexOf(node) !== -1; },
            getContext() { return { drawImage() {} }; },
            toDataURL() { return 'data:image/jpeg;base64,' + 'A'.repeat(32); },
            closest() { return null; }
        };
        return el;
    }

    const body = makeEl('body');
    const head = makeEl('head');
    const document = {
        readyState: 'complete', hidden: false, head: head, body: body,
        documentElement: makeEl('html'),
        createElement(tag) { return makeEl(tag); },
        getElementById(id) {
            if (!byId.has(id)) { const e = makeEl('div'); e.id = id; byId.set(id, e); }
            return byId.get(id);
        },
        querySelector(sel) {
            if (typeof sel === 'string' && sel.charAt(0) === '#' && byId.has(sel.slice(1))) return byId.get(sel.slice(1));
            return null;
        },
        querySelectorAll(sel) {
            if (sel === '.detector-social-actions') return slots.slice();
            return [];
        },
        addEventListener(type, fn) { (docHandlers[type] = docHandlers[type] || []).push(fn); },
        removeEventListener() {},
        _byId: byId
    };

    // A slot exactly like js/map-app.js writes it into the popup markup.
    function makeSlot(userId, name, kind) {
        const slot = makeEl('div');
        slot.className = 'detector-social-actions';
        slot.setAttribute('data-user-id', userId);
        slot.setAttribute('data-user-name', name || '');
        slot.setAttribute('data-detector-kind', kind || 'live');
        slots.push(slot);
        return slot;
    }

    // A button as it appears inside a decorated slot.
    function makeButton(slot, action) {
        const btn = makeEl('button');
        btn.setAttribute('data-social-action', action);
        btn.setAttribute('data-user-id', slot.getAttribute('data-user-id'));
        btn.setAttribute('data-user-name', slot.getAttribute('data-user-name'));
        btn.closest = function (sel) {
            if (sel === '[data-social-action]') return btn;
            if (sel === '.detector-social-actions') return slot;
            return null;
        };
        return btn;
    }

    async function click(btn) {
        const results = [];
        for (const fn of (docHandlers.click || [])) results.push(fn({ target: btn, preventDefault() {}, stopPropagation() {} }));
        await Promise.all(results);
        await flush();
    }

    async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

    return { document, body, head, makeEl, makeSlot, makeButton, click, flush, slots, docHandlers };
}

function makeSocialSandbox(dom, user) {
    const storage = {};
    const listeners = {};
    const rpcCalls = [];
    const alerts = [];

    const server = {
        friends: [
            { user_id: 'u-friend', display_name: 'Ana', email: 'ana@example.com', county: 'Timis', friends_since: '2026-09-01T00:00:00Z', conversation_id: 'c1' }
        ],
        outgoing: [{ id: 'req-out', other_id: 'u-pending', status: 'pending' }],
        incoming: [{ id: 'req-in', other_id: 'u-incoming', other_name: 'Maria', status: 'pending' }],
        rpc(name, params) {
            rpcCalls.push({ name: name, params: params || {} });
            const ok = data => Promise.resolve({ data: data, error: null });
            if (name === 'get_app_limits') return ok(null);
            if (name === 'get_social_counters') return ok([{ pending_requests: 1, unread_messages: 0, friends: this.friends.length, conversations: 1 }]);
            if (name === 'list_my_friends') return ok(this.friends);
            if (name === 'list_my_friend_requests') return ok(params._direction === 'outgoing' ? this.outgoing : this.incoming);
            if (name === 'send_friend_request') {
                this.outgoing.push({ id: 'req-new', other_id: params._addressee_id, status: 'pending' });
                return ok({ id: 'req-new' });
            }
            if (name === 'cancel_friend_request') {
                this.outgoing = this.outgoing.filter(r => r.id !== params._request_id);
                return ok(null);
            }
            if (name === 'respond_friend_request') {
                const row = this.incoming.filter(r => r.id === params._request_id)[0];
                if (row) {
                    this.incoming = this.incoming.filter(r => r.id !== params._request_id);
                    this.friends.push({ user_id: row.other_id, display_name: row.other_name, friends_since: '2026-09-15T00:00:00Z', conversation_id: 'c9' });
                }
                return ok(null);
            }
            if (name === 'list_my_conversations') return ok([{ id: 'c1', kind: 'direct', other_user_id: 'u-friend', title: 'Ana', unread_count: 0, status: 'open' }]);
            if (name === 'cleanup_social_messages' || name === 'cleanup_event_chat_messages') return ok(null);
            // The chat itself is covered by test-friends-social.js; here we only
            // prove that "Trimite mesaj" routes into the real chat flow.
            if (name === 'start_direct_conversation') return Promise.resolve({ data: null, error: { message: 'CONVERSATION_NOT_FOUND' } });
            return ok(null);
        }
    };
    server.from = function () {
        const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; }, limit() { return chain; }, single() { return Promise.resolve({ data: null, error: null }); }, then(res) { return Promise.resolve({ data: [], error: null }).then(res); } };
        return chain;
    };

    const sandbox = {
        console: { warn() {}, log() {}, error() {} },
        document: dom.document,
        window: null,
        localStorage: {
            getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); },
            removeItem: k => { delete storage[k]; },
            key: i => Object.keys(storage)[i] || null,
            get length() { return Object.keys(storage).length; }
        },
        alert: msg => alerts.push(String(msg)),
        confirm: () => true,
        setTimeout: (fn, ms) => 1,      // timers are inspected, never fired
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        fetch: () => Promise.reject(new Error('no network')),
        navigator: { onLine: true, userAgent: 'node-test' },
        location: { href: 'https://detectlab.ro/' },
        crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) },
        MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
        Image: function () { return dom.makeEl('img'); },
        FileReader: function () { return { readAsDataURL() {} }; },
        Date, Math, JSON, Promise, Number, String, Array, Object, Boolean, RegExp, Error, Set, Map,
        isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.addEventListener = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
    sandbox.removeEventListener = function () {};
    sandbox.dispatchEvent = function (ev) {
        (listeners[(ev && ev.type) || ''] || []).forEach(fn => { try { fn(ev); } catch (e) {} });
        return true;
    };
    sandbox.supabaseClient = server;
    sandbox._authUser = () => user;
    sandbox._currentLang = () => 'ro';
    sandbox._alerts = alerts;
    sandbox._rpcCalls = rpcCalls;
    sandbox._server = server;
    return sandbox;
}

async function runIntegrationPart() {
    section('[3] detectorist popup → real send_friend_request / respond / chat');

    const dom = makeFakeDom();
    const sb = makeSocialSandbox(dom, { id: 'u-me', email: 'me@example.com' });
    vm.createContext(sb);
    vm.runInContext(FRIENDS_SRC, sb, { filename: 'js/friends.js' });

    const F = sb.DetectLabFriends;
    check('js/friends.js exposes the map-pin API',
        !!(F && typeof F.decorateDetectorPopup === 'function' && typeof F.refreshDetectorPopups === 'function' && typeof F.detectorRelation === 'function'));

    const slotFriend = dom.makeSlot('u-friend', 'Ana', 'live');
    const slotStranger = dom.makeSlot('u-stranger', 'Ion', 'offline');
    const slotPending = dom.makeSlot('u-pending', 'Vlad', 'live');
    const slotIncoming = dom.makeSlot('u-incoming', 'Maria', 'offline');
    const slotSelf = dom.makeSlot('u-me', 'Me', 'live');

    const decorated = F.decorateDetectorPopup(dom.document);   // paints from the mirror
    await dom.flush();                                         // then repaints with fresh lists
    check('every map slot is decorated', decorated === 5, 'decorated=' + decorated);

    check('friend pin → "Trimite mesaj" button',
        /data-social-action="message"/.test(slotFriend.innerHTML) && /Trimite mesaj/.test(slotFriend.innerHTML),
        slotFriend.innerHTML);
    check('stranger pin → "Adaugă prietenie" button',
        /data-social-action="add"/.test(slotStranger.innerHTML) && /Adaugă prietenie/.test(slotStranger.innerHTML),
        slotStranger.innerHTML);
    check('pending request pin → "Cerere de prietenie trimisă / Anulează"',
        /data-social-action="cancel"/.test(slotPending.innerHTML) && /Cerere de prietenie trimisă/.test(slotPending.innerHTML),
        slotPending.innerHTML);
    check('incoming request pin → "Acceptă cererea"',
        /data-social-action="accept"/.test(slotIncoming.innerHTML),
        slotIncoming.innerHTML);
    check('my own account pin → no action button',
        !/data-social-action/.test(slotSelf.innerHTML), slotSelf.innerHTML);
    check('relationFor() is exposed for assertions', F.detectorRelation('u-friend') === 'friend');

    /* ── the click: stranger → friend request ── */
    await dom.click(dom.makeButton(slotStranger, 'add'));
    const sent = sb._rpcCalls.filter(c => c.name === 'send_friend_request');
    check('tapping "Adaugă prietenie" sends a REAL friend request for that account',
        sent.length === 1 && sent[0].params._addressee_id === 'u-stranger',
        JSON.stringify(sent));
    check('the slot flips to "Cerere de prietenie trimisă" without reopening the popup',
        /data-social-action="cancel"/.test(slotStranger.innerHTML) && /Cerere de prietenie trimisă/.test(slotStranger.innerHTML),
        slotStranger.innerHTML);
    check('the friend request is confirmed to the user',
        /Cerere de prietenie trimisă\./.test(slotStranger.querySelector('[data-social-msg]').textContent),
        slotStranger.querySelector('[data-social-msg]').textContent);

    /* ── the click: cancel our pending request ── */
    await dom.click(dom.makeButton(slotPending, 'cancel'));
    const cancelled = sb._rpcCalls.filter(c => c.name === 'cancel_friend_request');
    check('tapping "Anulează" cancels exactly our pending request',
        cancelled.length === 1 && cancelled[0].params._request_id === 'req-out',
        JSON.stringify(cancelled));

    /* ── the click: accept theirs → we become friends ── */
    await dom.click(dom.makeButton(slotIncoming, 'accept'));
    const accepted = sb._rpcCalls.filter(c => c.name === 'respond_friend_request');
    check('tapping "Acceptă cererea" accepts that request',
        accepted.length === 1 && accepted[0].params._request_id === 'req-in' && accepted[0].params._accept === true,
        JSON.stringify(accepted));
    check('after accepting, the pin offers "Trimite mesaj" (you are friends now)',
        /data-social-action="message"/.test(slotIncoming.innerHTML) && /Trimite mesaj/.test(slotIncoming.innerHTML),
        slotIncoming.innerHTML);

    /* ── the click: message an existing friend ── */
    await dom.click(dom.makeButton(slotFriend, 'message'));
    const started = sb._rpcCalls.filter(c => c.name === 'start_direct_conversation');
    check('tapping "Trimite mesaj" opens the private chat (start_direct_conversation)',
        started.length === 1 && started[0].params._other_user === 'u-friend',
        JSON.stringify(started));
    check('a failing chat backend surfaces a readable message instead of silence',
        sb._alerts.length >= 1 && /conversați/i.test(sb._alerts[0]), JSON.stringify(sb._alerts));

    /* ── anonymous visitor: the button routes into the auth flow ── */
    const dom2 = makeFakeDom();
    const sb2 = makeSocialSandbox(dom2, null);
    let authOpened = 0;
    sb2.openAuth = function () { authOpened++; };
    vm.createContext(sb2);
    vm.runInContext(FRIENDS_SRC, sb2, { filename: 'js/friends.js' });
    const anonSlot = dom2.makeSlot('u-stranger', 'Ion', 'live');
    sb2.DetectLabFriends.decorateDetectorPopup(dom2.document);
    await dom2.flush();
    check('signed-out visitors get no action buttons', !/data-social-action/.test(anonSlot.innerHTML), anonSlot.innerHTML);
    await dom2.click(dom2.makeButton(anonSlot, 'add'));
    check('a click with no session asks for sign-in instead of calling the backend',
        authOpened === 1 && sb2._rpcCalls.filter(c => c.name === 'send_friend_request').length === 0,
        'openAuth=' + authOpened);

    runWiringPart();
}

/* ══════════════════════════════════════════════════════════════════════════
   4. index.html / sw.js wiring
   ══════════════════════════════════════════════════════════════════════════ */

function runWiringPart() {
    section('[4] index.html / sw.js wiring');

    const friendsTag = (INDEX_SRC.match(/<script src="js\/friends\.js\?v=[^"]+"/) || []).index;
    const mapTag = (INDEX_SRC.match(/<script src="js\/map-app\.js\?v=[^"]+"/) || []).index;
    check('the friends.js <script> is parsed BEFORE the map-app.js one (the popup hook needs DetectLabFriends)',
        friendsTag > -1 && mapTag > -1 && friendsTag < mapTag,
        'friends@' + friendsTag + ', map@' + mapTag);
    check('the delegated click listener is capture-phase so Leaflet cannot swallow it',
        /document\.addEventListener\('click', onDetectorSocialAction, true\)/.test(FRIENDS_SRC));

    ['js/friends.js', 'js/map-app.js', 'css/styles.css'].forEach(function (asset) {
        const href = (INDEX_SRC.match(new RegExp('(?:src|href)="(' + asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=[^"]+)"')) || [])[1];
        check(asset + ' is requested with a cache-busting ?v=',
            !!href && SW_SRC.indexOf("'" + href + "'") !== -1, href || 'no ?v= found');
    });

    // The hook leans on two Leaflet APIs: a 'popupopen' event carrying the popup
    // object and Popup#getElement(). The vendored Leaflet must provide both.
    const LEAFLET_SRC = fs.readFileSync(path.join(ROOT, 'js/leaflet.js'), 'utf8');
    check('the vendored Leaflet fires popupopen with the popup object',
        /fire\("popupopen",\{popup:this\}\)/.test(LEAFLET_SRC));
    check('the vendored Leaflet exposes Popup#getElement() for the hook',
        /getElement:function\(\)\{return this\._container\}/.test(LEAFLET_SRC));

    check('the social action styles ship in css/styles.css',
        /\.detector-social-actions/.test(fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8')) &&
        /\.detector-social-btn/.test(fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8')));

    console.log('\n' + passed + ' checks passed.');
    if (process.exitCode) console.error('FAILED');
}
