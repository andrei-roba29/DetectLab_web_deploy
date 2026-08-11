// Regression test: event sync + join-request flow must not fail silently when
// the live Supabase `events` table is missing the newer columns
// (pin_id / category / creator_email) that js/events.js sends on upsert.
//
// Background: the deployed project's events table predates those columns
// (PostgREST error 42703), so every event upsert failed, the events table
// stayed empty, and join inquiries hit the event_id foreign key -> the creator
// never received join requests. js/events.js now retries with the base columns
// and reports honest success/failure instead of swallowing errors.
//
// Run: node test-event-join-sync.js

'use strict';

const assert = require('assert');

// ── Stub Supabase client ──
// records the payloads it receives; can be scripted to fail like PostgREST.
let stub = {
    calls: [],          // every upsert payload pushed here
    fullPayloadError: null,  // error returned for the full payload
    basePayloadError: null   // error returned for the base (retry) payload
};

function fakeSupabaseClient() {
    return {
        from() {
            return {
                upsert(payloadArr) {
                    const payload = payloadArr[0];
                    stub.calls.push(JSON.parse(JSON.stringify(payload)));
                    // The first call is always the "full" payload (has pin_id),
                    // the retry is the base payload (no pin_id).
                    const isFull = 'pin_id' in payload;
                    const err = isFull ? stub.fullPayloadError : stub.basePayloadError;
                    return Promise.resolve(err ? { error: err } : { error: null, data: payloadArr });
                }
            };
        }
    };
}

// ── Logic copied verbatim from js/events.js (adapted to stubs) ──
function isMissingColumnError(err) {
    if (!err) return false;
    if (err.code === '42703') return true;
    var msg = String(err.message || err.error_description || err.hint || '');
    return msg.indexOf('does not exist') !== -1;
}

async function ensureEventOnServer(ev, supabaseClient) {
    if (!supabaseClient || !ev || !ev.id) {
        return { ok: false, reason: 'no-client' };
    }
    try {
        var payload = {
            id: ev.id,
            pin_id: ev.pin_id || null,
            creator_id: ev.creator_id,
            creator_name: ev.creator_name || 'User',
            creator_email: ev.creator_email || null,
            title: ev.title,
            description: ev.description || '',
            category: ev.category || 'Other',
            latitude: Number(ev.latitude),
            longitude: Number(ev.longitude),
            event_date: ev.event_date,
            max_attendees: ev.max_attendees || null,
            created_at: ev.created_at || new Date().toISOString()
        };
        var res = await supabaseClient.from('events').upsert([payload], { onConflict: 'id' });
        if (res && res.error) {
            if (isMissingColumnError(res.error)) {
                var basePayload = {
                    id: ev.id,
                    creator_id: ev.creator_id,
                    creator_name: ev.creator_name || 'User',
                    title: ev.title,
                    description: ev.description || '',
                    latitude: Number(ev.latitude),
                    longitude: Number(ev.longitude),
                    event_date: ev.event_date,
                    max_attendees: ev.max_attendees || null,
                    created_at: ev.created_at || new Date().toISOString()
                };
                var retry = await supabaseClient.from('events').upsert([basePayload], { onConflict: 'id' });
                if (retry && retry.error) {
                    return { ok: false, reason: 'server-error', error: retry.error };
                }
                return { ok: true, partial: true };
            }
            return { ok: false, reason: 'server-error', error: res.error };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'exception', error: e };
    }
}

// ── Tests ──
const event = {
    id: '11111111-1111-4111-8111-111111111111',
    pin_id: 'pin-42',
    creator_id: '22222222-2222-4222-8222-222222222222',
    creator_name: 'Creator',
    creator_email: 'creator@example.com',
    title: 'Test hunt',
    description: 'desc',
    category: 'Metal Detecting',
    latitude: 47.1,
    longitude: 22.9,
    event_date: '2026-09-01T10:00:00.000Z',
    max_attendees: 5,
    created_at: '2026-08-11T10:00:00.000Z'
};

(async () => {
    // 1) Healthy schema: full payload succeeds, no retry.
    stub = { calls: [], fullPayloadError: null, basePayloadError: null };
    let r = await ensureEventOnServer(event, fakeSupabaseClient());
    assert.strictEqual(r.ok, true, 'healthy schema should succeed');
    assert.strictEqual(r.partial, undefined, 'healthy schema is not partial');
    assert.strictEqual(stub.calls.length, 1, 'no retry on healthy schema');
    assert.strictEqual(stub.calls[0].pin_id, 'pin-42');
    assert.strictEqual(stub.calls[0].category, 'Metal Detecting');
    assert.strictEqual(stub.calls[0].creator_email, 'creator@example.com');

    // 2) Schema drift (42703 on the full payload): retries with base columns.
    stub = {
        calls: [],
        fullPayloadError: { code: '42703', message: 'column events.pin_id does not exist' },
        basePayloadError: null
    };
    r = await ensureEventOnServer(event, fakeSupabaseClient());
    assert.strictEqual(r.ok, true, 'should recover via base-column retry');
    assert.strictEqual(r.partial, true, 'recovery should be flagged as partial');
    assert.strictEqual(stub.calls.length, 2, 'should retry exactly once');
    assert.strictEqual('pin_id' in stub.calls[1], false, 'retry payload must omit pin_id');
    assert.strictEqual('category' in stub.calls[1], false, 'retry payload must omit category');
    assert.strictEqual('creator_email' in stub.calls[1], false, 'retry payload must omit creator_email');
    assert.strictEqual(stub.calls[1].id, event.id, 'retry keeps event id');
    assert.strictEqual(stub.calls[1].creator_id, event.creator_id, 'retry keeps creator id');

    // 3) Both payloads rejected: honest failure, not a fake success.
    stub = {
        calls: [],
        fullPayloadError: { code: '42703', message: 'column events.pin_id does not exist' },
        basePayloadError: { code: '42501', message: 'new row violates row-level security policy' }
    };
    r = await ensureEventOnServer(event, fakeSupabaseClient());
    assert.strictEqual(r.ok, false, 'should report failure when both attempts fail');
    assert.strictEqual(r.reason, 'server-error');
    assert.strictEqual(r.error.code, '42501');

    // 4) Non-schema error on the full payload: no blind retry, honest failure.
    stub = {
        calls: [],
        fullPayloadError: { code: '42501', message: 'new row violates row-level security policy' },
        basePayloadError: null
    };
    r = await ensureEventOnServer(event, fakeSupabaseClient());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(stub.calls.length, 1, 'no retry for non-schema errors');

    // 5) No client: local-only result, join flow must surface it as such.
    r = await ensureEventOnServer(event, null);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-client');

    console.log('✅ test-event-join-sync.js passed: event sync self-heals schema drift, failures are surfaced.');
})().catch((err) => {
    console.error('❌ test-event-join-sync.js failed:', err.message);
    process.exit(1);
});
