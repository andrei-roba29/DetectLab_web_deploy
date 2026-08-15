// Regression test for the "last known broad location" feature:
//
//   1. js/last-location.js records each user's last BROAD location (nearest
//      city/town + county) into public.user_last_locations, throttled so the
//      GPS watcher does not hammer Nominatim / Supabase.
//   2. Creating an event notifies every user whose last known location is in
//      the event's county, or within 50 km of the event — never the creator,
//      and never for anonymous events.
//   3. Those notifications are classified as kind 'nearby_event' by the
//      notification modal, so it renders the "See event" / "Vezi evenimentul"
//      button which zooms the map onto that event.
//
// Loads the REAL js/last-location.js and js/events.js in a minimal browser
// sandbox (no jsdom dependency), like the other tests in this repo.
//
// Run: node test-last-location-nearby-events.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ── Supabase-like query builder stub ─────────────────────────────────────── */
function makeSupabaseStub(opts) {
    opts = opts || {};
    const tables = {
        events: [],
        event_inquiries: [],
        event_attendees: [],
        event_notifications: [],
        event_deletions: [],
        event_chats: [],
        event_chat_messages: [],
        user_last_locations: []
    };

    function matcher(q) {
        return function (row) {
            return Object.keys(q.filters).every(function (col) { return row[col] === q.filters[col]; }) &&
                Object.keys(q.inFilters).every(function (col) { return q.inFilters[col](row[col]); });
        };
    }

    function run(q) {
        // Simulate a deployment whose tables lack the newest columns/tables.
        if (opts.missingTables && opts.missingTables.indexOf(q.table) !== -1) {
            return { error: { message: 'relation "public.' + q.table + '" does not exist' }, data: null };
        }
        if (opts.missingKindColumn && q.table === 'event_notifications' &&
            (q.mode === 'insert' || q.mode === 'upsert') &&
            (q.payload || []).some(function (r) { return Object.prototype.hasOwnProperty.call(r, 'kind'); })) {
            return { error: { message: "Could not find the 'kind' column of 'event_notifications' in the schema cache" }, data: null };
        }

        if (q.mode === 'insert' || q.mode === 'upsert') {
            (q.payload || []).forEach(function (row) {
                if (!Array.isArray(tables[q.table])) return;
                if (q.mode === 'upsert') {
                    const i = tables[q.table].findIndex(function (r) { return r.user_id === row.user_id || (row.id && r.id === row.id); });
                    if (i !== -1) { Object.assign(tables[q.table][i], row); return; }
                }
                tables[q.table].push(row);
            });
            return { error: null, data: q.payload };
        }
        if (q.mode === 'update') {
            const m = matcher(q);
            (tables[q.table] || []).forEach(function (row) { if (m(row)) Object.assign(row, q.patch); });
            return { error: null, data: null };
        }
        if (q.mode === 'delete') return { error: null, data: null };

        let rows = (tables[q.table] || []).filter(matcher(q));
        if (q.singleMode) {
            const f = rows[0] || null;
            return { error: f ? null : { code: 'PGRST116', message: 'no rows' }, data: f };
        }
        if (q.limitN != null) rows = rows.slice(0, q.limitN);
        return { error: null, data: rows };
    }

    function buildChain(table) {
        const q = { table, filters: {}, inFilters: {}, mode: null, patch: null, payload: null, singleMode: false, limitN: null };
        const chain = {
            select() { if (q.mode !== 'insert' && q.mode !== 'upsert') q.mode = 'select'; return chain; },
            insert(rows) { q.mode = 'insert'; q.payload = Array.isArray(rows) ? rows : [rows]; return chain; },
            upsert(rows) { q.mode = 'upsert'; q.payload = Array.isArray(rows) ? rows : [rows]; return chain; },
            update(patch) { q.mode = 'update'; q.patch = patch; return chain; },
            delete() { q.mode = 'delete'; return chain; },
            eq(col, val) { q.filters[col] = val; return chain; },
            gt() { return chain; },
            in(col, arr) { q.inFilters[col] = function (v) { return arr.indexOf(v) !== -1; }; return chain; },
            single() { q.singleMode = true; return chain; },
            limit(n) { q.limitN = n; return chain; },
            order() { return chain; },
            then(resolve, reject) { try { resolve(run(q)); } catch (e) { reject(e); } }
        };
        return chain;
    }

    return { client: { from(t) { return buildChain(t); }, rpc() { return Promise.resolve({ error: null }); } }, tables };
}

/* ── DOM / storage stubs ──────────────────────────────────────────────────── */
function fakeEl() {
    return {
        style: {}, innerHTML: '', className: '', disabled: false,
        addEventListener() {}, removeEventListener() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        setAttribute() {}, getAttribute() { return null; },
        appendChild() {}, remove() {}, classList: { add() {}, remove() {}, contains() { return false; } }
    };
}
function makeDocStub() {
    return {
        addEventListener() {}, removeEventListener() {},
        getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
        createElement() { return fakeEl(); },
        head: { appendChild() {} }, body: { appendChild() {} }
    };
}
function makeLsStub() {
    const store = {};
    return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        _store: store
    };
}

// Nominatim reverse-geocode stub: maps coordinates to a county so the test can
// place users in / out of the event's county deterministically.
function makeFetchStub(geoTable, counters) {
    return function (url) {
        counters.calls++;
        const lat = parseFloat(/[?&]lat=([^&]+)/.exec(url)[1]);
        const lon = parseFloat(/[?&]lon=([^&]+)/.exec(url)[1]);
        let best = null, bestD = Infinity;
        geoTable.forEach(function (g) {
            const d = Math.hypot(g.lat - lat, g.lng - lon);
            if (d < bestD) { bestD = d; best = g; }
        });
        return Promise.resolve({
            ok: true,
            json() {
                return Promise.resolve({
                    name: best.city,
                    display_name: best.city + ', ' + best.county + ', Romania',
                    address: { town: best.city, county: best.county, country: 'Romania' }
                });
            }
        });
    };
}

function loadModules(options) {
    options = options || {};
    const ls = makeLsStub();
    const supa = makeSupabaseStub(options.supabase);
    const counters = { calls: 0 };
    let currentUser = null;
    let idc = 0;

    const win = {};
    win.crypto = { randomUUID: function () { return 'uuid-' + (++idc); } };
    win._authUser = function () { return currentUser; };
    win._currentLang = function () { return options.lang || 'en'; };
    win.supabaseClient = supa.client;
    win.addEventListener = function () {};
    win.dispatchEvent = function () { return true; };

    const sandbox = {
        window: win,
        document: makeDocStub(),
        localStorage: ls,
        alert() {},
        fetch: makeFetchStub(options.geo || [], counters),
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        setTimeout, setInterval, clearTimeout, clearInterval,
        console: options.quiet ? { log() {}, warn() {}, error() {} } : console,
        Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, Error,
        isFinite, parseFloat, parseInt, isNaN, encodeURIComponent
    };
    sandbox.crypto = win.crypto;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'last-location.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'events.js'), 'utf8'), sandbox);

    return {
        win, supa, ls, counters,
        setUser(u) { currentUser = u; }
    };
}

// Mirror of showNotificationModal's kind derivation for nearby-event notifs
// (verbatim rules from js/events.js).
function deriveKind(notif) {
    let kind = 'inquiry';
    if (!notif.inquiry_id) kind = 'info';
    if (notif.kind === 'nearby_event' ||
        (!notif.inquiry_id && notif.event_id &&
         /created near you|creat în apropiere|creat in apropiere/i.test(notif.message || ''))) {
        kind = 'nearby_event';
    }
    return kind;
}

const GEO = [
    // Baia Mare area — Maramures county
    { lat: 47.657, lng: 23.568, city: 'Baia Mare', county: 'Maramureș' },
    // Borșa — same county but ~82 km away, i.e. OUTSIDE the 50 km radius, so it
    // can only be matched by the county rule.
    { lat: 47.655, lng: 24.665, city: 'Borșa', county: 'Maramureș' },
    // Cluj-Napoca — different county, far away
    { lat: 46.770, lng: 23.591, city: 'Cluj-Napoca', county: 'Cluj' },
    // Cehu Silvaniei — a DIFFERENT county (Sălaj) but only ~38 km from the
    // event, so it can only be matched by the 50 km radius rule.
    { lat: 47.350, lng: 23.350, city: 'Cehu Silvaniei', county: 'Sălaj' }
];

function futureIso(days) { return new Date(Date.now() + days * 86400000).toISOString(); }

(async () => {
    /* ══════════════════════════════════════════════════════════════════
       1) recordLastLocation stores the BROAD place, not just coordinates
       ══════════════════════════════════════════════════════════════════ */
    {
        const m = loadModules({ geo: GEO, quiet: true });
        m.setUser({ id: 'u-1', email: 'a@t.com', name: 'Andrei' });
        const LL = m.win.DetectLabLastLocation;

        const row = await LL.recordLastLocation(47.657, 23.568);
        assert.ok(row, 'recordLastLocation must return the stored row');
        assert.strictEqual(row.city, 'Baia Mare', 'city must be the nearest town, got ' + row.city);
        assert.strictEqual(row.county, 'Maramureș', 'county must be resolved');
        assert.strictEqual(row.user_id, 'u-1');
        assert.strictEqual(m.supa.tables.user_last_locations.length, 1, 'one row must be persisted');

        // Broad, not exact: the coordinates are kept but the *identity* of the
        // location is the city/county pair.
        assert.ok(row.label.indexOf('Baia Mare') !== -1 && row.label.indexOf('Maramureș') !== -1,
            'label must combine city + county, got ' + row.label);
        console.log('✓ 1. last location is recorded as nearest city/town + county');
    }

    /* ══════════════════════════════════════════════════════════════════
       2) Throttling: a tiny move must not re-query Nominatim / Supabase,
          a big move must.
       ══════════════════════════════════════════════════════════════════ */
    {
        const m = loadModules({ geo: GEO, quiet: true });
        m.setUser({ id: 'u-1', email: 'a@t.com', name: 'Andrei' });
        const LL = m.win.DetectLabLastLocation;

        await LL.recordLastLocation(47.657, 23.568);
        const afterFirst = m.counters.calls;

        // ~100 m away: below the 2 km threshold → no new write, no new lookup.
        await LL.recordLastLocation(47.6575, 23.5685);
        assert.strictEqual(m.counters.calls, afterFirst, 'a sub-threshold move must not re-query Nominatim');
        assert.strictEqual(m.supa.tables.user_last_locations.length, 1, 'upsert must keep a single row per user');

        // Far move to another county → must refresh.
        await LL.recordLastLocation(46.770, 23.591);
        assert.ok(m.counters.calls > afterFirst, 'a >2 km move must re-resolve the broad location');
        assert.strictEqual(m.supa.tables.user_last_locations.length, 1, 'still exactly one row per user');
        assert.strictEqual(m.supa.tables.user_last_locations[0].county, 'Cluj', 'row must be updated to the new county');
        console.log('✓ 2. publishing is throttled by distance and upserts a single row per user');
    }

    /* ══════════════════════════════════════════════════════════════════
       3) Creating an event notifies county + 50 km users, not the creator
       ══════════════════════════════════════════════════════════════════ */
    {
        const m = loadModules({ geo: GEO, quiet: true });
        const LL = m.win.DetectLabLastLocation;

        // Four users with known last locations.
        m.supa.tables.user_last_locations.push(
            { user_id: 'creator', full_name: 'Creator', latitude: 47.657, longitude: 23.568, city: 'Baia Mare', county: 'Maramureș' },
            // Same county, but 82 km away → matched by the COUNTY rule only.
            { user_id: 'same-county-far', full_name: 'Borsa Guy', latitude: 47.655, longitude: 24.665, city: 'Borșa', county: 'Maramureș' },
            // Different county, but 38 km away → matched by the RADIUS rule only.
            { user_id: 'other-county-near', full_name: 'Cehu Guy', latitude: 47.350, longitude: 23.350, city: 'Cehu Silvaniei', county: 'Sălaj' },
            { user_id: 'far-away', full_name: 'Cluj Guy', latitude: 46.770, longitude: 23.591, city: 'Cluj-Napoca', county: 'Cluj' }
        );

        m.setUser({ id: 'creator', email: 'c@t.com', name: 'Creator' });

        const ev = {
            id: 'ev-1', creator_id: 'creator', creator_name: 'Andrei',
            title: 'Forest Hunt', description: 'd',
            latitude: 47.657, longitude: 23.568,     // Baia Mare, Maramures
            event_date: futureIso(7), is_anonymous: false
        };
        const sent = await m.win._notifyUsersNearEvent(ev);

        const notifs = m.supa.tables.event_notifications;
        const recipients = notifs.map(function (n) { return n.user_id; }).sort();

        assert.deepStrictEqual(recipients, ['other-county-near', 'same-county-far'],
            'must notify same-county users and users within 50 km, got: ' + JSON.stringify(recipients));
        assert.strictEqual(sent, 2);
        assert.ok(recipients.indexOf('creator') === -1, 'the creator must never be notified about their own event');
        assert.ok(recipients.indexOf('far-away') === -1, 'a user in another far county must not be notified');

        const n = notifs[0];
        assert.strictEqual(n.kind, 'nearby_event', 'notification must carry kind=nearby_event');
        assert.strictEqual(n.event_id, 'ev-1', 'notification must reference the event so "See event" can zoom to it');
        assert.strictEqual(n.sender_name, 'Andrei');
        assert.strictEqual(n.read, false);
        // Bilingual copy, ending in the creator's name (before the optional place).
        assert.ok(/An event was created near you by Andrei/.test(n.message),
            'English copy must read "An event was created near you by <name>", got: ' + n.message);
        assert.ok(/Un eveniment a fost creat în apropiere de tine de Andrei/.test(n.message),
            'Romanian copy must read "Un eveniment a fost creat în apropiere de tine de <name>", got: ' + n.message);
        console.log('✓ 3. event creation notifies same-county + within-50 km users (never the creator)');
    }

    /* ══════════════════════════════════════════════════════════════════
       4) Anonymous events must not be broadcast to a whole county
       ══════════════════════════════════════════════════════════════════ */
    {
        const m = loadModules({ geo: GEO, quiet: true });
        m.supa.tables.user_last_locations.push(
            { user_id: 'neighbour', full_name: 'N', latitude: 47.657, longitude: 23.568, city: 'Baia Mare', county: 'Maramureș' }
        );
        m.setUser({ id: 'creator', email: 'c@t.com', name: 'Creator' });

        const sent = await m.win._notifyUsersNearEvent({
            id: 'ev-anon', creator_id: 'creator', creator_name: 'Andrei',
            title: 'Secret', latitude: 47.657, longitude: 23.568,
            event_date: futureIso(3), is_anonymous: true, event_code: 'K7KQ4D'
        });
        assert.strictEqual(sent, 0, 'anonymous events must not notify the county');
        assert.strictEqual(m.supa.tables.event_notifications.length, 0);
        console.log('✓ 4. anonymous events stay private (no county broadcast)');
    }

    /* ══════════════════════════════════════════════════════════════════
       5) Notification is classified as 'nearby_event' → "See event" button
       ══════════════════════════════════════════════════════════════════ */
    {
        assert.strictEqual(deriveKind({
            id: 'n1', inquiry_id: null, event_id: 'ev-1', kind: 'nearby_event',
            message: 'Un eveniment a fost creat în apropiere de tine de Andrei / An event was created near you by Andrei'
        }), 'nearby_event', 'kind column must select the nearby-event modal');

        // Legacy deployments without the `kind` column: fall back to the message.
        assert.strictEqual(deriveKind({
            id: 'n2', inquiry_id: null, event_id: 'ev-1',
            message: 'Un eveniment a fost creat în apropiere de tine de Andrei / An event was created near you by Andrei'
        }), 'nearby_event', 'message fallback must still select the nearby-event modal');

        // Unrelated informational notices must NOT be mistaken for nearby events.
        assert.strictEqual(deriveKind({
            id: 'n3', inquiry_id: null, event_id: 'ev-1', message: 'X joined your anonymous event'
        }), 'info', 'other info notices must keep the plain info modal');

        // Join requests are unaffected.
        assert.strictEqual(deriveKind({ id: 'n4', inquiry_id: 'inq-1', event_id: 'ev-1', message: 'wants to attend' }),
            'inquiry', 'join requests must keep the accept/decline modal');
        console.log('✓ 5. nearby-event notifications render the "See event" modal (incl. legacy fallback)');
    }

    /* ══════════════════════════════════════════════════════════════════
       6) Graceful degradation when the migration has not been applied
       ══════════════════════════════════════════════════════════════════ */
    {
        // (a) user_last_locations table missing → recording is a no-op, no throw.
        const m1 = loadModules({ geo: GEO, quiet: true, supabase: { missingTables: ['user_last_locations'] } });
        m1.setUser({ id: 'u-1', email: 'a@t.com', name: 'A' });
        const r = await m1.win.DetectLabLastLocation.recordLastLocation(47.657, 23.568);
        assert.strictEqual(r, null, 'a missing table must degrade to a no-op');
        const rows = await m1.win.DetectLabLastLocation.fetchLastLocations();
        // NOTE: `rows` is created inside the VM realm, so compare its length
        // rather than deep-equalling against a host-realm [].
        assert.strictEqual(rows.length, 0, 'a missing table must read as empty');

        // (b) event_notifications.kind column missing → insert retried without it.
        const m2 = loadModules({ geo: GEO, quiet: true, supabase: { missingKindColumn: true } });
        m2.supa.tables.user_last_locations.push(
            { user_id: 'neighbour', full_name: 'N', latitude: 47.657, longitude: 23.568, city: 'Baia Mare', county: 'Maramureș' }
        );
        m2.setUser({ id: 'creator', email: 'c@t.com', name: 'C' });
        const sent = await m2.win._notifyUsersNearEvent({
            id: 'ev-2', creator_id: 'creator', creator_name: 'Andrei',
            title: 'T', latitude: 47.657, longitude: 23.568, event_date: futureIso(5), is_anonymous: false
        });
        assert.strictEqual(sent, 1, 'insert must be retried without the kind column');
        const legacy = m2.supa.tables.event_notifications[0];
        assert.ok(!Object.prototype.hasOwnProperty.call(legacy, 'kind'), 'retry payload must omit `kind`');
        assert.strictEqual(deriveKind(legacy), 'nearby_event', 'legacy row must still render the See-event modal');
        console.log('✓ 6. degrades gracefully when the Supabase migration is missing');
    }

    /* ══════════════════════════════════════════════════════════════════
       7) County matching is diacritics / wording insensitive
       ══════════════════════════════════════════════════════════════════ */
    {
        const m = loadModules({ geo: GEO, quiet: true });
        const LL = m.win.DetectLabLastLocation;
        assert.ok(LL.sameCounty('Maramureș', 'Maramures'), 'diacritics must not break county matching');
        assert.ok(LL.sameCounty('Județul Maramureș', 'Maramures County'), '"Județul"/"County" wording must be stripped');
        assert.ok(LL.sameCounty('  SĂLAJ ', 'Salaj'), 'casing and padding must not matter');
        assert.ok(!LL.sameCounty('Cluj', 'Maramures'), 'different counties must not match');
        assert.ok(!LL.sameCounty('', 'Maramures'), 'an unknown county must never match');
        assert.ok(!LL.sameCounty(null, null), 'two unknown counties must not match each other');
        console.log('✓ 7. county comparison ignores diacritics, casing and "Județul"/"County"');
    }

    console.log('\nAll last-location / nearby-event tests passed.');
})().catch(function (e) {
    console.error('\n✗ TEST FAILED:', e && e.message ? e.message : e);
    if (e && e.stack) console.error(e.stack);
    process.exit(1);
});
