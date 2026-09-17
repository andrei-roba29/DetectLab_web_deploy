// Regression tests for the SOCIAL layer ("Prieteni / Friends").
//
// What is exercised against the REAL js/friends.js and js/events.js:
//   1. The UNIFIED search bar finds people by a partial query matched against
//      display name, e-mail, county, city or the account id prefix —
//      diacritics-insensitive ("muresan" finds "Mureșan"), multi-word queries
//      need every word somewhere — and the county (județ) filter narrows
//      the results.
//   2. A friend request lands in the addressee's "Cereri" tab; accepting it
//      puts both users in each other's friend list WITH a chat button.
//   3. Private (1:1) and group conversations: only friends can be invited,
//      the creator is the admin, the title is required, oversize groups are
//      refused.
//   4. The agreed storage/rate limits are enforced before anything is sent:
//      message length, messages per minute, attachment size, and the server
//      side per-thread message cap that drops the oldest messages.
//   5. The local mirror is keyed by ACCOUNT (detectlab_social_v1:<userId>) so
//      the same login sees its threads on another device, media data URLs are
//      never mirrored, and two accounts on one device never mix.
//   6. A missing social backend (migrations not applied yet) is reported in the
//      panel instead of failing silently.
//   7. js/events.js: the create-event form renders the "Adaugă prieteni" box,
//      invites exactly the ticked friends after saving, refuses to keep a local
//      ghost event when the DB quota trigger rejects it, and a notification
//      with kind = 'friend_event_invite' offers accept / decline.
//
// Run: node test-friends-social.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const FRIENDS_JS = fs.readFileSync(path.join(__dirname, 'js/friends.js'), 'utf8');
const EVENTS_JS = fs.readFileSync(path.join(__dirname, 'js/events.js'), 'utf8');

let passed = 0;
function ok(label) { passed++; console.log('  ✔ ' + label); }

/* ══════════════════════════════════════════════════════════════════════════
   In-memory social server — mirrors the rules of migrations
   20260915000000 … 20260916010000 so the client is tested against the same
   contract the database enforces.
══════════════════════════════════════════════════════════════════════════ */

const LIMITS = {
    max_events_created_active: 10,
    max_events_attending_active: 15,
    max_event_deadline_days: 365,
    max_event_invites_per_event: 50,
    max_friends: 3,                     // tiny on purpose so the cap is testable
    max_friend_requests_per_day: 50,
    max_friend_request_message_len: 200,
    max_group_conversations: 50,
    max_group_members: 4,               // tiny on purpose
    max_conversation_title_len: 60,
    max_message_length: 2000,
    max_messages_per_conversation: 5,   // tiny on purpose so trimming is testable
    max_messages_per_minute: 60,
    max_messages_per_day: 2000,
    message_retention_days: 90,
    max_attachment_bytes: 5 * 1024 * 1024,
    max_conversation_storage_bytes: 209715200,
    max_user_storage_bytes: 524288000,
    event_chat_message_length: 2000,
    event_chat_retention_days: 90
};

const USERS = {
    ana: { id: 'u-ana', name: 'Ana Pop', email: 'ana.pop@detectlab.ro', county: 'Cluj' },
    mihai: { id: 'u-mihai', name: 'Mihai Ionescu', email: 'mihai.i@example.com', county: 'Cluj' },
    elena: { id: 'u-elena', name: 'Elena Dobre', email: 'elena@dorelmail.com', county: 'Bihor', city: 'Oradea' },
    vlad: { id: 'u-vlad', name: 'Vlad Mureșan', email: 'vlad@muresan.ro', county: 'Maramureș' },
    ioana: { id: 'u-ioana', name: 'Ioana Radu', email: 'ioana@radu.ro', county: 'Cluj' }
};

let uidCounter = 0;
function uid(prefix) { uidCounter++; return (prefix || 'id') + '-' + uidCounter; }

function normaliseCounty(raw) {
    return String(raw || '')
        .toLowerCase()
        .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
        .replace(/\b(judetul|judet|jud|county|province|region|regiunea|municipiul)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Mirrors public.search_normalise() in
// supabase/migrations/20260916010000_social_unified_search.sql — keep both in
// sync (same fold set: Romanian ș/ț in both the comma-below and the cedilla
// spellings, plus the Hungarian/European vowels common in Transylvanian
// names).
function searchNormalise(raw) {
    return String(raw || '')
        .toLowerCase()
        .replace(/[ăâáàäãå]/g, 'a')
        .replace(/[îíìï]/g, 'i')
        .replace(/[șş]/g, 's')
        .replace(/[țţ]/g, 't')
        .replace(/[éèëê]/g, 'e')
        .replace(/[óòöõø]/g, 'o')
        .replace(/[úùüû]/g, 'u')
        .replace(/[ýÿ]/g, 'y')
        .replace(/ç/g, 'c')
        .replace(/ñ/g, 'n')
        .replace(/\s+/g, ' ')
        .trim();
}

function createSocialServer(options) {
    const opts = options || {};
    const server = {
        currentUserId: null,
        rpcCalls: [],
        // Simulates a deployment where the social migrations were not applied.
        missingFunctions: !!opts.missingFunctions,
        tables: {
            app_limits: [Object.assign({ id: true }, LIMITS)],
            user_social_profiles: Object.keys(USERS).map(function (k) {
                const u = USERS[k];
                return {
                    user_id: u.id, display_name: u.name, email: u.email,
                    county: u.county, city: u.city || null, discoverable: true,
                    updated_at: new Date().toISOString()
                };
            }),
            // The broad last-known location of every account: the directory
            // projection of 20260916020000 mirrors these rows, so the search can
            // also be tested against accounts that never opened the panel.
            user_last_locations: Object.keys(USERS).map(function (k) {
                const u = USERS[k];
                return {
                    user_id: u.id, full_name: u.name, email: u.email,
                    county: u.county, city: u.city || null,
                    latitude: 46.7, longitude: 23.5, label: u.city || u.county,
                    updated_at: new Date().toISOString()
                };
            }),
            friend_requests: [],
            friendships: [],
            conversations: [],
            conversation_members: [],
            conversation_messages: [],
            events: [],
            event_attendees: [],
            event_inquiries: [],
            event_notifications: []
        }
    };

    server.as = function (userId) { server.currentUserId = userId; return server; };

    function me() { return server.currentUserId; }
    function fail(code) { return { data: null, error: { message: code, code: 'P0001' } }; }
    function profile(userId) {
        return server.tables.user_social_profiles.filter(function (p) { return p.user_id === userId; })[0] || null;
    }
    function areFriends(a, b) {
        return server.tables.friendships.some(function (f) {
            return (f.user_a === a && f.user_b === b) || (f.user_a === b && f.user_b === a);
        });
    }
    function friendCount(userId) {
        return server.tables.friendships.filter(function (f) { return f.user_a === userId || f.user_b === userId; }).length;
    }
    function memberOf(convId, userId) {
        return server.tables.conversation_members.filter(function (m) {
            return m.conversation_id === convId && m.user_id === userId;
        })[0] || null;
    }

    const functions = {
        get_app_limits: function () {
            return { data: server.tables.app_limits[0], error: null };
        },

        upsert_my_social_profile: function (p) {
            // Mirrors the SQL guard (auth.uid() null → 'Not signed in').
            // Without it the boot-time upsert — fired before server.as() —
            // would forge a ghost row with user_id null; the real function
            // raises instead.
            if (!me()) return fail('Not signed in');
            let row = profile(me());
            if (!row) {
                row = { user_id: me(), display_name: '', email: '', county: null, city: null, discoverable: true };
                server.tables.user_social_profiles.push(row);
            }
            if (p._display_name) row.display_name = p._display_name;
            if (p._email) row.email = String(p._email).toLowerCase();
            if (p._county) row.county = p._county;
            if (p._city) row.city = p._city;
            row.updated_at = new Date().toISOString();
            return { data: row, error: null };
        },

        search_social_users: function (p) {
            // Unified rule, mirroring the migration: every normalised query
            // word must appear (as a substring) in at least one visible
            // column — display name, e-mail, county, city — or prefix-match
            // the account id.
            const tokens = searchNormalise(p._query).split(' ').filter(Boolean);
            const county = normaliseCounty(p._county);
            const rows = server.tables.user_social_profiles.filter(function (row) {
                if (row.user_id === me()) return false;
                if (!row.discoverable) return false;
                if (county && normaliseCounty(row.county) !== county) return false;
                if (!tokens.length) return true;
                const haystacks = [
                    searchNormalise(row.display_name),
                    searchNormalise(row.email),
                    searchNormalise(row.county),
                    searchNormalise(row.city)
                ];
                const idText = String(row.user_id).toLowerCase();
                return tokens.every(function (tok) {
                    return idText.indexOf(tok) === 0 ||
                        haystacks.some(function (h) { return h.indexOf(tok) !== -1; });
                });
            });
            const data = rows.slice(0, p._limit_n || 25).map(function (row) {
                const pending = server.tables.friend_requests.filter(function (r) {
                    return r.status === 'pending' &&
                        ((r.requester_id === me() && r.addressee_id === row.user_id) ||
                         (r.requester_id === row.user_id && r.addressee_id === me()));
                })[0];
                let relationship = 'none';
                if (areFriends(me(), row.user_id)) relationship = 'friend';
                else if (pending && pending.requester_id === me()) relationship = 'request_sent';
                else if (pending) relationship = 'request_received';
                return {
                    user_id: row.user_id, display_name: row.display_name, email: row.email,
                    county: row.county, city: row.city, relationship: relationship,
                    request_id: pending ? pending.id : null
                };
            });
            return { data: data, error: null };
        },

        list_social_counties: function () {
            const counts = {};
            server.tables.user_social_profiles.forEach(function (p) {
                const key = normaliseCounty(p.county);
                if (key) counts[key] = (counts[key] || 0) + 1;
            });
            return {
                data: Object.keys(counts).map(function (k) { return { county: k, members: counts[k] }; }),
                error: null
            };
        },

        send_friend_request: function (p) {
            const target = p._addressee_id;
            if (!target || target === me()) return fail('CANNOT_ADD_SELF');
            const them = profile(target);
            if (!them) return fail('USER_NOT_FOUND');
            if (areFriends(me(), target)) return fail('ALREADY_FRIENDS');
            const pending = server.tables.friend_requests.filter(function (r) {
                return r.status === 'pending' &&
                    ((r.requester_id === me() && r.addressee_id === target) ||
                     (r.requester_id === target && r.addressee_id === me()));
            })[0];
            if (pending) return fail('REQUEST_ALREADY_PENDING');
            if (friendCount(me()) >= LIMITS.max_friends) return fail('FRIEND_LIMIT_REACHED:' + LIMITS.max_friends);
            if (friendCount(target) >= LIMITS.max_friends) return fail('ADDRESSEE_FRIEND_LIMIT_REACHED:' + LIMITS.max_friends);
            const mine = profile(me()) || { display_name: 'Detectorist' };
            const row = {
                id: uid('req'), requester_id: me(), requester_name: mine.display_name,
                addressee_id: target, addressee_name: them.display_name,
                message: p._message || null, status: 'pending',
                created_at: new Date().toISOString(), responded_at: null
            };
            server.tables.friend_requests.push(row);
            return { data: row, error: null };
        },

        cancel_friend_request: function (p) {
            const row = server.tables.friend_requests.filter(function (r) { return r.id === p._request_id; })[0];
            if (!row || row.requester_id !== me() || row.status !== 'pending') return fail('REQUEST_NOT_FOUND');
            row.status = 'cancelled';
            row.responded_at = new Date().toISOString();
            return { data: true, error: null };
        },

        respond_friend_request: function (p) {
            const row = server.tables.friend_requests.filter(function (r) { return r.id === p._request_id; })[0];
            if (!row) return fail('REQUEST_NOT_FOUND');
            if (row.addressee_id !== me()) return fail('NOT_YOUR_REQUEST');
            if (row.status !== 'pending') return fail('REQUEST_ALREADY_HANDLED:' + row.status);
            row.status = p._accept ? 'accepted' : 'declined';
            row.responded_at = new Date().toISOString();
            if (!p._accept) return { data: null, error: null };
            if (friendCount(me()) >= LIMITS.max_friends || friendCount(row.requester_id) >= LIMITS.max_friends) {
                return fail('FRIEND_LIMIT_REACHED:' + LIMITS.max_friends);
            }
            const a = me() < row.requester_id ? me() : row.requester_id;
            const b = me() < row.requester_id ? row.requester_id : me();
            if (!areFriends(a, b)) {
                server.tables.friendships.push({ id: uid('fr'), user_a: a, user_b: b, created_at: new Date().toISOString() });
            }
            return { data: { id: uid('fr'), user_a: a, user_b: b }, error: null };
        },

        remove_friend: function (p) {
            const before = server.tables.friendships.length;
            server.tables.friendships = server.tables.friendships.filter(function (f) {
                return !((f.user_a === me() && f.user_b === p._friend_id) || (f.user_a === p._friend_id && f.user_b === me()));
            });
            if (server.tables.friendships.length === before) return fail('NOT_FRIENDS');
            // Direct threads are closed when the friendship ends.
            server.tables.conversations.forEach(function (c) {
                if (c.kind !== 'direct' || c.status !== 'active') return;
                const members = server.tables.conversation_members.filter(function (m) { return m.conversation_id === c.id; });
                const ids = members.map(function (m) { return m.user_id; });
                if (ids.indexOf(me()) !== -1 && ids.indexOf(p._friend_id) !== -1) c.status = 'closed';
            });
            return { data: true, error: null };
        },

        list_my_friends: function () {
            const rows = server.tables.friendships
                .filter(function (f) { return f.user_a === me() || f.user_b === f.user_b && f.user_b === me(); })
                .map(function (f) {
                    const otherId = f.user_a === me() ? f.user_b : f.user_a;
                    const p = profile(otherId) || {};
                    const direct = server.tables.conversations.filter(function (c) {
                        if (c.kind !== 'direct') return false;
                        const ids = server.tables.conversation_members
                            .filter(function (m) { return m.conversation_id === c.id; })
                            .map(function (m) { return m.user_id; });
                        return ids.indexOf(me()) !== -1 && ids.indexOf(otherId) !== -1;
                    })[0];
                    return {
                        user_id: otherId,
                        display_name: p.display_name || 'Detectorist',
                        email: p.email || '',
                        county: p.county || '',
                        city: p.city || '',
                        friends_since: f.created_at,
                        conversation_id: direct ? direct.id : null
                    };
                });
            return { data: rows, error: null };
        },

        list_my_friend_requests: function (p) {
            const dir = p._direction || 'both';
            const rows = server.tables.friend_requests.filter(function (r) {
                if (dir === 'incoming' && r.addressee_id !== me()) return false;
                if (dir === 'outgoing' && r.requester_id !== me()) return false;
                if (dir === 'both' && r.requester_id !== me() && r.addressee_id !== me()) return false;
                return true;
            }).map(function (r) {
                const otherId = r.addressee_id === me() ? r.requester_id : r.addressee_id;
                const other = profile(otherId) || {};
                return {
                    id: r.id,
                    direction: r.addressee_id === me() ? 'incoming' : 'outgoing',
                    other_id: otherId,
                    other_name: other.display_name || 'Detectorist',
                    other_email: other.email || '',
                    other_county: other.county || '',
                    message: r.message,
                    status: r.status,
                    created_at: r.created_at
                };
            });
            return { data: rows, error: null };
        },

        get_social_counters: function () {
            const pending = server.tables.friend_requests.filter(function (r) {
                return r.addressee_id === me() && r.status === 'pending';
            }).length;
            const myMemberships = server.tables.conversation_members.filter(function (m) { return m.user_id === me(); });
            let unread = 0;
            myMemberships.forEach(function (m) {
                unread += server.tables.conversation_messages.filter(function (msg) {
                    return msg.conversation_id === m.conversation_id && msg.sender_id !== me() &&
                        (!m.last_read_at || msg.created_at > m.last_read_at);
                }).length;
            });
            return {
                data: {
                    pending_requests: pending, unread_messages: unread,
                    friends: friendCount(me()), conversations: myMemberships.length
                },
                error: null
            };
        },

        start_direct_conversation: function (p) {
            if (!areFriends(me(), p._other_user)) return fail('NOT_FRIENDS');
            let conv = server.tables.conversations.filter(function (c) {
                if (c.kind !== 'direct') return false;
                const ids = server.tables.conversation_members
                    .filter(function (m) { return m.conversation_id === c.id; })
                    .map(function (m) { return m.user_id; });
                return ids.indexOf(me()) !== -1 && ids.indexOf(p._other_user) !== -1;
            })[0];
            if (!conv) {
                conv = {
                    id: uid('conv'), kind: 'direct', title: null, status: 'active',
                    created_by: me(), created_at: new Date().toISOString(),
                    last_message_at: null, message_count: 0, storage_bytes: 0
                };
                server.tables.conversations.push(conv);
                [me(), p._other_user].forEach(function (userId) {
                    server.tables.conversation_members.push({
                        conversation_id: conv.id, user_id: userId, role: 'member',
                        joined_at: new Date().toISOString(), last_read_at: null
                    });
                });
            } else {
                conv.status = 'active';
            }
            return { data: Object.assign({}, conv, { my_role: 'member', member_count: 2, unread_count: 0 }), error: null };
        },

        create_group_conversation: function (p) {
            const title = String(p._title || '').trim();
            if (!title) return fail('TITLE_REQUIRED');
            const ids = Array.from(new Set((p._member_ids || []).filter(function (id) { return id && id !== me(); })));
            if (!ids.length) return fail('NO_MEMBERS_SELECTED');
            if (ids.length + 1 > LIMITS.max_group_members) return fail('GROUP_TOO_LARGE:' + LIMITS.max_group_members);
            if (ids.some(function (id) { return !areFriends(me(), id); })) return fail('NOT_FRIENDS');
            const groups = server.tables.conversations.filter(function (c) {
                return c.kind === 'group' && c.status === 'active' && memberOf(c.id, me());
            }).length;
            if (groups >= LIMITS.max_group_conversations) return fail('GROUP_LIMIT_REACHED:' + LIMITS.max_group_conversations);

            const conv = {
                id: uid('conv'), kind: 'group', title: title.slice(0, LIMITS.max_conversation_title_len),
                status: 'active', created_by: me(), created_at: new Date().toISOString(),
                last_message_at: null, message_count: 0, storage_bytes: 0
            };
            server.tables.conversations.push(conv);
            server.tables.conversation_members.push({
                conversation_id: conv.id, user_id: me(), role: 'admin',
                joined_at: new Date().toISOString(), last_read_at: null
            });
            ids.forEach(function (id) {
                server.tables.conversation_members.push({
                    conversation_id: conv.id, user_id: id, role: 'member',
                    joined_at: new Date().toISOString(), last_read_at: null
                });
            });
            return { data: Object.assign({}, conv, { my_role: 'admin' }), error: null };
        },

        rename_conversation: function (p) {
            const m = memberOf(p._conversation_id, me());
            if (!m || m.role !== 'admin') return fail('ADMIN_ONLY');
            const conv = server.tables.conversations.filter(function (c) { return c.id === p._conversation_id; })[0];
            if (!conv || conv.kind !== 'group') return fail('CONVERSATION_NOT_FOUND');
            if (!String(p._title || '').trim()) return fail('TITLE_REQUIRED');
            conv.title = String(p._title).trim();
            return { data: conv, error: null };
        },

        add_conversation_members: function (p) {
            const m = memberOf(p._conversation_id, me());
            if (!m || m.role !== 'admin') return fail('ADMIN_ONLY');
            const ids = Array.from(new Set(p._member_ids || []));
            if (ids.some(function (id) { return !areFriends(me(), id); })) return fail('NOT_FRIENDS');
            let added = 0;
            ids.forEach(function (id) {
                if (memberOf(p._conversation_id, id)) return;
                server.tables.conversation_members.push({
                    conversation_id: p._conversation_id, user_id: id, role: 'member',
                    joined_at: new Date().toISOString(), last_read_at: null
                });
                added++;
            });
            return { data: added, error: null };
        },

        remove_conversation_member: function (p) {
            const m = memberOf(p._conversation_id, me());
            if (!m || m.role !== 'admin') return fail('ADMIN_ONLY');
            if (p._user_id === me()) return fail('USE_LEAVE_INSTEAD');
            const before = server.tables.conversation_members.length;
            server.tables.conversation_members = server.tables.conversation_members.filter(function (x) {
                return !(x.conversation_id === p._conversation_id && x.user_id === p._user_id);
            });
            if (server.tables.conversation_members.length === before) return fail('MEMBER_NOT_FOUND');
            return { data: true, error: null };
        },

        leave_conversation: function (p) {
            const conv = server.tables.conversations.filter(function (c) { return c.id === p._conversation_id; })[0];
            if (!memberOf(p._conversation_id, me())) return fail('NOT_A_MEMBER');
            if (conv.kind === 'direct') { conv.status = 'closed'; return { data: true, error: null }; }
            server.tables.conversation_members = server.tables.conversation_members.filter(function (m) {
                return !(m.conversation_id === p._conversation_id && m.user_id === me());
            });
            const rest = server.tables.conversation_members.filter(function (m) { return m.conversation_id === p._conversation_id; });
            if (!rest.length) {
                server.tables.conversations = server.tables.conversations.filter(function (c) { return c.id !== p._conversation_id; });
            } else if (!rest.some(function (m) { return m.role === 'admin'; })) {
                rest[0].role = 'admin';
            }
            return { data: true, error: null };
        },

        delete_conversation: function (p) {
            const m = memberOf(p._conversation_id, me());
            if (!m || m.role !== 'admin') return fail('ADMIN_ONLY');
            server.tables.conversations = server.tables.conversations.filter(function (c) { return c.id !== p._conversation_id; });
            server.tables.conversation_members = server.tables.conversation_members.filter(function (x) { return x.conversation_id !== p._conversation_id; });
            server.tables.conversation_messages = server.tables.conversation_messages.filter(function (x) { return x.conversation_id !== p._conversation_id; });
            return { data: true, error: null };
        },

        get_conversation_members: function (p) {
            if (!memberOf(p._conversation_id, me())) return fail('NOT_A_MEMBER');
            const rows = server.tables.conversation_members
                .filter(function (m) { return m.conversation_id === p._conversation_id; })
                .map(function (m) {
                    const prof = profile(m.user_id) || {};
                    return {
                        user_id: m.user_id, display_name: prof.display_name || 'Detectorist',
                        email: prof.email || '', county: prof.county || '',
                        role: m.role, joined_at: m.joined_at, is_friend: areFriends(me(), m.user_id)
                    };
                });
            return { data: rows, error: null };
        },

        mark_conversation_read: function (p) {
            const m = memberOf(p._conversation_id, me());
            if (!m) return fail('NOT_A_MEMBER');
            m.last_read_at = new Date().toISOString();
            return { data: m.last_read_at, error: null };
        },

        send_conversation_message: function (p) {
            const m = memberOf(p._conversation_id, me());
            if (!m) return fail('NOT_A_MEMBER');
            const conv = server.tables.conversations.filter(function (c) { return c.id === p._conversation_id; })[0];
            if (!conv || conv.status !== 'active') return fail('CONVERSATION_CLOSED');
            const body = String(p._body || '');
            const type = String(p._media_type || 'none');
            if (body.length > LIMITS.max_message_length) return fail('MESSAGE_TOO_LONG:' + LIMITS.max_message_length);
            const bytes = Math.max(Number(p._media_bytes) || 0, String(p._media_url || '').length);
            if (bytes > LIMITS.max_attachment_bytes) return fail('ATTACHMENT_TOO_LARGE:' + LIMITS.max_attachment_bytes);
            if (!body.trim() && type === 'none') return fail('EMPTY_MESSAGE');

            const now = Date.now();
            const perMin = server.tables.conversation_messages.filter(function (x) {
                return x.sender_id === me() && (now - new Date(x.created_at).getTime()) < 60000;
            }).length;
            if (perMin >= LIMITS.max_messages_per_minute) return fail('RATE_LIMIT_MINUTE:' + LIMITS.max_messages_per_minute);

            const row = {
                id: uid('msg'), conversation_id: conv.id, sender_id: me(),
                sender_name: (profile(me()) || {}).display_name || 'Detectorist',
                body: body || null, media_url: type === 'none' ? null : (p._media_url || null),
                media_type: type, media_bytes: type === 'none' ? 0 : bytes,
                created_at: new Date(now).toISOString()
            };
            server.tables.conversation_messages.push(row);

            // Per-thread cap: the oldest messages are dropped first.
            const inThread = server.tables.conversation_messages.filter(function (x) { return x.conversation_id === conv.id; });
            if (inThread.length > LIMITS.max_messages_per_conversation) {
                const drop = inThread.length - LIMITS.max_messages_per_conversation;
                const doomed = inThread.slice(0, drop).map(function (x) { return x.id; });
                server.tables.conversation_messages = server.tables.conversation_messages.filter(function (x) {
                    return doomed.indexOf(x.id) === -1;
                });
            }
            const after = server.tables.conversation_messages.filter(function (x) { return x.conversation_id === conv.id; });
            conv.message_count = after.length;
            conv.storage_bytes = after.reduce(function (sum, x) { return sum + (x.media_bytes || 0); }, 0);
            conv.last_message_at = row.created_at;
            return { data: row, error: null };
        },

        list_my_conversations: function () {
            const memberships = server.tables.conversation_members.filter(function (m) { return m.user_id === me(); });
            const rows = memberships.map(function (m) {
                const conv = server.tables.conversations.filter(function (c) { return c.id === m.conversation_id; })[0];
                if (!conv) return null;
                const members = server.tables.conversation_members.filter(function (x) { return x.conversation_id === conv.id; });
                const messages = server.tables.conversation_messages.filter(function (x) { return x.conversation_id === conv.id; });
                const last = messages[messages.length - 1] || null;
                const unread = messages.filter(function (x) {
                    return x.sender_id !== me() && (!m.last_read_at || x.created_at > m.last_read_at);
                }).length;
                const other = members.filter(function (x) { return x.user_id !== me(); })[0];
                const otherProfile = other ? profile(other.user_id) : null;
                return {
                    id: conv.id, kind: conv.kind, title: conv.title, status: conv.status,
                    my_role: m.role, member_count: members.length, unread_count: unread,
                    last_message_at: conv.last_message_at,
                    last_message_body: last ? last.body : null,
                    last_media_type: last ? last.media_type : null,
                    last_sender_id: last ? last.sender_id : null,
                    last_sender_name: last ? last.sender_name : null,
                    created_by: conv.created_by,
                    other_user_id: conv.kind === 'direct' && other ? other.user_id : null,
                    other_user_name: otherProfile ? otherProfile.display_name : null,
                    other_user_county: otherProfile ? otherProfile.county : null
                };
            }).filter(Boolean);
            rows.sort(function (a, b) { return String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')); });
            return { data: rows, error: null };
        },

        cleanup_social_messages: function () { return { data: { deleted_messages: 0, deleted_conversations: 0 }, error: null }; },
        cleanup_event_chat_messages: function () { return { data: { deleted_messages: 0 }, error: null }; },

        get_my_event_quota: function () {
            const created = server.tables.events.filter(function (e) {
                return e.creator_id === me() && new Date(e.event_date) > new Date();
            }).length;
            const attending = server.tables.event_attendees.filter(function (a) {
                if (a.user_id !== me()) return false;
                const ev = server.tables.events.filter(function (e) { return e.id === a.event_id; })[0];
                return ev && new Date(ev.event_date) > new Date();
            }).length;
            return {
                data: {
                    events_created_active: created,
                    events_created_max: LIMITS.max_events_created_active,
                    events_attending_active: attending,
                    events_attending_max: LIMITS.max_events_attending_active,
                    max_deadline_days: LIMITS.max_event_deadline_days
                },
                error: null
            };
        },

        invite_friends_to_event: function (p) {
            const ev = server.tables.events.filter(function (e) { return e.id === p._event_id; })[0];
            if (!ev) return fail('EVENT_NOT_FOUND');
            if (ev.creator_id !== me()) return fail('NOT_EVENT_CREATOR');
            const out = [];
            (p._friend_ids || []).forEach(function (id) {
                if (id === me()) return;
                if (!areFriends(me(), id)) { out.push({ user_id: id, result: 'not_friend' }); return; }
                if (server.tables.event_attendees.some(function (a) { return a.event_id === ev.id && a.user_id === id; })) {
                    out.push({ user_id: id, result: 'already_attending' }); return;
                }
                if (server.tables.event_inquiries.some(function (i) {
                    return i.event_id === ev.id && i.user_id === id && i.status !== 'declined';
                })) { out.push({ user_id: id, result: 'already_pending' }); return; }

                const prof = profile(id) || {};
                const inquiry = {
                    id: uid('inq'), event_id: ev.id, user_id: id,
                    user_name: prof.display_name || 'Detectorist',
                    message: 'Invitație / Invitation: ' + ev.title, status: 'pending',
                    created_at: new Date().toISOString()
                };
                server.tables.event_inquiries.push(inquiry);
                server.tables.event_notifications.push({
                    id: uid('notif'), user_id: id, event_id: ev.id, inquiry_id: inquiry.id,
                    sender_id: me(), sender_name: (profile(me()) || {}).display_name || 'Creator',
                    message: 'te-a invitat / invited you', read: false,
                    kind: 'friend_event_invite', created_at: new Date().toISOString()
                });
                out.push({ user_id: id, result: 'invited' });
            });
            return { data: out, error: null };
        }
    };

    server.rpc = function (name, params) {
        server.rpcCalls.push(name);
        if (server.missingFunctions) {
            return Promise.resolve({
                data: null,
                error: { code: '42883', message: 'could not find the function public.' + name }
            });
        }
        const fn = functions[name];
        if (!fn) {
            return Promise.resolve({ data: null, error: { code: '42883', message: 'could not find the function public.' + name } });
        }
        try {
            return Promise.resolve(fn(params || {}));
        } catch (e) {
            return Promise.resolve({ data: null, error: { message: e.message } });
        }
    };

    // Minimal PostgREST-style query builder for the direct SELECTs the client
    // makes (conversation_messages history).
    server.from = function (table) {
        const filters = [];
        let mode = 'select';
        let payload = null;
        let limitN = null;
        const api = {
            select() { return api; },
            insert(rows) { mode = 'insert'; payload = rows; return api; },
            update(patch) { mode = 'update'; payload = patch; return api; },
            delete() { mode = 'delete'; return api; },
            upsert(rows) { mode = 'upsert'; payload = rows; return api; },
            eq(col, val) { filters.push({ col: col, val: val }); return api; },
            in(col, val) { filters.push({ col: col, val: val, op: 'in' }); return api; },
            order() { return api; },
            limit(n) { limitN = n; return api; },
            single() { return api._run(true); },
            then(resolve, reject) { return api._run(false).then(resolve, reject); },
            _run(single) {
                const rows = server.tables[table] || [];
                if (mode === 'insert' || mode === 'upsert') {
                    (Array.isArray(payload) ? payload : [payload]).forEach(function (r) { rows.push(r); });
                    return Promise.resolve({ data: payload, error: null });
                }
                if (mode === 'update') {
                    rows.forEach(function (r, i) {
                        if (filters.every(function (f) { return r[f.col] === f.val; })) rows[i] = Object.assign({}, r, payload);
                    });
                    return Promise.resolve({ data: [], error: null });
                }
                if (mode === 'delete') {
                    server.tables[table] = rows.filter(function (r) {
                        return !filters.every(function (f) { return r[f.col] === f.val; });
                    });
                    return Promise.resolve({ data: [], error: null });
                }
                let out = rows.filter(function (r) {
                    return filters.every(function (f) {
                        if (f.op === 'in') return f.val.indexOf(r[f.col]) !== -1;
                        return r[f.col] === f.val;
                    });
                });
                if (limitN != null) out = out.slice(0, limitN);
                if (single) {
                    return Promise.resolve(out[0]
                        ? { data: out[0], error: null }
                        : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
                }
                return Promise.resolve({ data: out, error: null });
            }
        };
        return api;
    };

    return server;
}

/* ══════════════════════════════════════════════════════════════════════════
   Minimal DOM sandbox (same approach as the other test-*.js files: no jsdom)
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
            id: '',
            style: { cssText: '' },
            dataset: {},
            value: '',
            checked: false,
            disabled: false,
            textContent: '',
            innerHTML: '',
            scrollTop: 0,
            scrollHeight: 100,
            files: [],
            classList: {
                _set: new Set(),
                add(c) { this._set.add(c); },
                remove(c) { this._set.delete(c); },
                contains(c) { return this._set.has(c); },
                toggle(c, on) { if (on === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (on) this._set.add(c); else this._set.delete(c); }
            },
            appendChild(child) {
                if (child && child.id) byId.set(child.id, child);
                (el._kids = el._kids || []).push(child);
                return child;
            },
            removeChild(child) { return child; },
            insertBefore(child) { return el.appendChild(child); },
            remove() { if (el.id && byId.get(el.id) === el) byId.delete(el.id); },
            focus() {},
            blur() {},
            scrollIntoView() {},
            click() { return el.fire('click', { target: el }); },
            setAttribute(k, v) { attrs[k] = String(v); },
            getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
            hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
            addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
            removeEventListener() {},
            async fire(type, ev) {
                const list = handlers[type] || [];
                for (const fn of list) await fn(ev || { target: el, preventDefault() {}, stopPropagation() {} });
            },
            querySelector(sel) {
                // '#id' resolves through the document registry, exactly like a
                // real DOM: modal.querySelector('#ceFriendsBox') and
                // document.getElementById('ceFriendsBox') are the same node.
                if (typeof sel === 'string' && sel.charAt(0) === '#') {
                    return document.getElementById(sel.slice(1));
                }
                if (!children.has(sel)) children.set(sel, makeElement('div'));
                return children.get(sel);
            },
            querySelectorAll() { return []; },
            closest() { return null; },
            getContext() { return { drawImage() {} }; },
            toDataURL() { return 'data:image/jpeg;base64,' + 'A'.repeat(64); },
            onload: null,
            onerror: null,
            src: ''
        };
        return el;
    }

    const body = makeElement('body');
    const head = makeElement('head');
    const document = {
        readyState: 'complete',
        hidden: false,
        documentElement: makeElement('html'),
        head: head,
        body: body,
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
        addEventListener() {},
        removeEventListener() {},
        _byId: byId
    };

    return { document: document, body: body, timers: timers, makeElement: makeElement };
}

function createSandbox(server, user, dom, extra) {
    const storage = {};
    const localStorage = {
        getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: k => { delete storage[k]; },
        key: i => Object.keys(storage)[i] || null,
        get length() { return Object.keys(storage).length; },
        _dump: () => Object.assign({}, storage)
    };

    const alerts = [];
    const confirms = [];
    const listeners = {};

    const sandbox = Object.assign({
        console: { log() {}, warn() {}, error() {} },
        document: dom.document,
        localStorage: localStorage,
        alert: msg => alerts.push(String(msg)),
        confirm: msg => { confirms.push(String(msg)); return true; },
        setTimeout: (fn, ms) => { dom.timers.push({ fn: fn, ms: ms || 0 }); return dom.timers.length; },
        setInterval: () => 1,
        clearInterval() {},
        clearTimeout() {},
        fetch: () => Promise.reject(new Error('no network')),
        MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
        navigator: { onLine: true, userAgent: 'node-test', serviceWorker: undefined },
        location: { href: 'https://detectlab.ro/', search: '' },
        Image: function () {
            const img = dom.makeElement('img');
            img.width = 4000; img.height = 3000;
            setTimeout(function () { if (img.onload) img.onload(); }, 0);
            return img;
        },
        FileReader: function () {
            const reader = {
                onload: null, onerror: null,
                readAsDataURL(file) {
                    const payload = 'data:' + (file && file.type || 'image/jpeg') + ';base64,' + 'B'.repeat(Math.min((file && file.size) || 1024, 4096));
                    Promise.resolve().then(function () {
                        if (reader.onload) reader.onload({ target: { result: payload } });
                    });
                }
            };
            return reader;
        },
        crypto: {
            randomUUID: () => uid('uuid'),
            getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = i + 1; return arr; }
        },
        Date: Date,
        Math: Math,
        JSON: JSON,
        Promise: Promise,
        Number: Number,
        String: String,
        Array: Array,
        Object: Object,
        Boolean: Boolean,
        isNaN: isNaN,
        isFinite: isFinite,
        parseInt: parseInt,
        parseFloat: parseFloat,
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
        RegExp: RegExp,
        Error: Error,
        Set: Set,
        Map: Map
    }, extra || {});

    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.addEventListener = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
    sandbox.removeEventListener = function () {};
    sandbox.dispatchEvent = function (ev) {
        const list = listeners[(ev && ev.type) || ''] || [];
        list.forEach(function (fn) { try { fn(ev); } catch (e) {} });
        return true;
    };
    sandbox.supabaseClient = server;
    sandbox._authUser = () => user;
    sandbox._currentLang = () => 'ro';
    sandbox._alerts = alerts;
    sandbox._confirms = confirms;
    sandbox._storage = storage;
    sandbox._listeners = listeners;
    sandbox._fireWindowEvent = function (type, detail) {
        sandbox.dispatchEvent({ type: type, detail: detail || {} });
    };
    sandbox._flushTimers = async function () {
        const pending = dom.timers.splice(0, dom.timers.length);
        for (const t of pending) { await t.fn(); }
    };
    return sandbox;
}

function runInSandbox(sandbox, sources) {
    const ctx = vm.createContext(sandbox);
    sources.forEach(function (src) { vm.runInContext(src.code, ctx, { filename: src.name }); });
    return ctx;
}

function flush(times) {
    // Let the queued microtasks/promises settle.
    let p = Promise.resolve();
    for (let i = 0; i < (times || 6); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
    return p;
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 1 — js/friends.js against the in-memory social server
══════════════════════════════════════════════════════════════════════════ */

async function partOne() {
    console.log('\n[1] js/friends.js — search, requests, chats, limits, per-account cache');

    const server = createSocialServer();
    const dom = createDom();
    const sandbox = createSandbox(server, USERS.ana, dom);
    runInSandbox(sandbox, [{ code: FRIENDS_JS, name: 'js/friends.js' }]);

    const api = sandbox.DetectLabFriends;
    assert(api, 'window.DetectLabFriends must be exposed');
    assert.strictEqual(typeof sandbox.openFriends, 'function', 'window.openFriends must exist for the nav button');

    // Boot: the module reacts to the auth event (the DOMContentLoaded timer is
    // flushed explicitly so the test stays deterministic).
    sandbox._fireWindowEvent('detectlab:authchange', { user: USERS.ana });
    await sandbox._flushTimers();
    await flush(10);

    const limits = api.getLimits();
    assert.strictEqual(limits.max_message_length, LIMITS.max_message_length, 'limits must come from public.app_limits');
    assert.strictEqual(api.backendAvailable(), true, 'backend must be detected as installed');
    ok('limits are read from public.app_limits and the backend is detected');

    /* ── Unified search: partial, diacritic-insensitive, every column ── */
    server.as(USERS.ana.id);
    let res = await server.rpc('search_social_users', { _query: 'mihai.i@', _county: null, _limit_n: 25 });
    assert(res.data.some(r => r.user_id === USERS.mihai.id), 'search by e-mail must find Mihai');

    res = await server.rpc('search_social_users', { _query: 'elena', _county: null, _limit_n: 25 });
    assert(res.data.some(r => r.user_id === USERS.elena.id), 'search by name must find Elena');

    res = await server.rpc('search_social_users', { _query: 'u-vlad', _county: null, _limit_n: 25 });
    assert(res.data.some(r => r.user_id === USERS.vlad.id), 'search by account id must find Vlad');

    res = await server.rpc('search_social_users', { _query: '', _county: 'Județul Cluj', _limit_n: 25 });
    const clujIds = res.data.map(r => r.user_id);
    assert(clujIds.indexOf(USERS.mihai.id) !== -1, 'county filter must include Mihai (Cluj)');
    assert(clujIds.indexOf(USERS.ioana.id) !== -1, 'county filter must include Ioana (Cluj)');
    assert(clujIds.indexOf(USERS.elena.id) === -1, 'county filter must exclude Elena (Bihor)');
    assert(clujIds.indexOf(USERS.ana.id) === -1, 'search must never return the caller');
    ok('search matches e-mail, name and id, and "Județul Cluj" filters to Cluj only');

    /* ── the search BAR (js/friends.js): typing must find people ── */
    dom.document.getElementById('frSearchInput').value = 'muresan';
    let barRows = await api.searchUsers();
    assert(barRows.some(r => r.user_id === USERS.vlad.id),
        'typing "muresan" must find "Vlad Mureșan" through the search bar');
    let barHtml = dom.document.getElementById('frSearchResults').innerHTML;
    assert(/data-search-action="add"/.test(barHtml),
        'a stranger in the results must offer the "＋ Adaugă" action, got: ' + barHtml.slice(0, 160));
    ok('the search bar finds a diacritic-free partial name and offers the action button');

    /* ── … also on a deployment where the search RPC is not installed, and for
          accounts that never opened the Friends panel (no directory row) ── */
    {
        const bare = createSocialServer({ missingFunctions: true });
        bare.as(USERS.ana.id);
        bare.tables.user_social_profiles = [];      // nobody opened the panel
        const bareDom = createDom();
        const bareSb = createSandbox(bare, USERS.ana, bareDom);
        runInSandbox(bareSb, [{ code: FRIENDS_JS, name: 'js/friends.js (no migrations)' }]);
        bareDom.document.getElementById('frSearchInput').value = 'ioana';
        const found = await bareSb.DetectLabFriends.searchUsers();
        assert(found.some(r => r.user_id === USERS.ioana.id),
            'without the search RPC the client must still find the account through the tables RLS exposes');
        bareDom.document.getElementById('frSearchInput').value = '';
        const browsed = await bareSb.DetectLabFriends.searchUsers();
        assert(browsed.length === Object.keys(USERS).length - 1,
            'an empty query must browse the whole directory instead of returning nothing, got ' + browsed.length);
        ok('the search degrades to the readable tables (and browses on an empty query)');
    }

    /* ── … and the unified rule: diacritics, county/city, multi-word ── */
    async function searchIds(query) {
        const r = await server.rpc('search_social_users', { _query: query, _county: null, _limit_n: 25 });
        return r.data.map(x => x.user_id);
    }
    assert.deepStrictEqual(await searchIds('muresan'), [USERS.vlad.id],
        '"muresan" (no diacritics) must find "Mureșan"');
    assert.deepStrictEqual(await searchIds('MUREȘAN'), [USERS.vlad.id],
        'uppercase + diacritics must find Vlad too');
    assert.deepStrictEqual(await searchIds('vlad muresan'), [USERS.vlad.id],
        'every word of a multi-word query must match somewhere');
    assert.deepStrictEqual(await searchIds('mihai cluj'), [USERS.mihai.id],
        '"mihai cluj" must match the name AND the county of the same row');
    assert.deepStrictEqual(await searchIds('mih'), [USERS.mihai.id],
        'a 3-letter fragment must already return results');
    assert.deepStrictEqual(await searchIds('cluj'), [USERS.mihai.id, USERS.ioana.id],
        'a county typed in the search box must match the county column');
    assert.deepStrictEqual(await searchIds('oradea'), [USERS.elena.id],
        'a city typed in the search box must match the city column');
    assert.deepStrictEqual(await searchIds('elena bihor'), [USERS.elena.id],
        'name + county words must combine on one row');
    assert.deepStrictEqual(await searchIds('  elena   '), [USERS.elena.id],
        'surrounding whitespace must not break the search');
    assert.deepStrictEqual(await searchIds(''), [USERS.mihai.id, USERS.elena.id, USERS.vlad.id, USERS.ioana.id],
        'a blank query lists the whole directory except the caller');
    ok('unified search: partial + diacritic-insensitive across name, e-mail, county, city and id');

    /* ── The SQL migration the mock mirrors ── */
    const unifiedSql = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20260916010000_social_unified_search.sql'), 'utf8');
    assert(unifiedSql.indexOf('create or replace function public.search_normalise(raw text)') !== -1,
        'the migration must define public.search_normalise()');
    assert(unifiedSql.indexOf("'ăâîșşțţáàäãåéèëêíìïóòöõøúùüûýÿçñ'") !== -1,
        'search_normalise() must fold the same diacritic set the mock folds');
    assert(/bool_and\(/.test(unifiedSql),
        'multi-word queries must need EVERY word (bool_and over the tokens)');
    assert(unifiedSql.indexOf('strpos(public.search_normalise(p.county), t) > 0') !== -1,
        'county must be a searchable column');
    assert(unifiedSql.indexOf('strpos(public.search_normalise(p.city), t) > 0') !== -1,
        'city must be a searchable column');
    assert(unifiedSql.indexOf('starts_with(lower(p.user_id::text), t)') !== -1,
        'the account id prefix must stay searchable');
    ok('migration 20260916010000 defines the unified rule the mock reproduces');

    /* ── Friend request → accept → friend list with a chat button ── */
    server.as(USERS.ana.id);
    res = await server.rpc('send_friend_request', { _addressee_id: USERS.mihai.id, _message: 'Hai la detectat!' });
    assert(!res.error, 'Ana must be able to send a request to Mihai');
    const requestId = res.data.id;

    const dup = await server.rpc('send_friend_request', { _addressee_id: USERS.mihai.id, _message: '' });
    assert.strictEqual(dup.error.message, 'REQUEST_ALREADY_PENDING', 'a second request must be refused');

    server.as(USERS.mihai.id);
    const incoming = await server.rpc('list_my_friend_requests', { _direction: 'incoming' });
    assert(incoming.data.some(r => r.id === requestId && r.status === 'pending'), 'the request must appear in Mihai\'s requests tab');

    const accepted = await server.rpc('respond_friend_request', { _request_id: requestId, _accept: true });
    assert(!accepted.error, 'Mihai must be able to accept');

    server.as(USERS.ana.id);
    let friends = await server.rpc('list_my_friends', {});
    assert(friends.data.some(f => f.user_id === USERS.mihai.id), 'Mihai must appear in Ana\'s friend list');
    server.as(USERS.mihai.id);
    friends = await server.rpc('list_my_friends', {});
    assert(friends.data.some(f => f.user_id === USERS.ana.id), 'Ana must appear in Mihai\'s friend list too');
    ok('a request can be sent once, shows up in "Cereri", and accepting makes both sides friends');

    // The friends tab must render a chat button per friend; the search bar and
    // the county filter live in their own „Caută prieteni” tab now.
    server.as(USERS.ana.id);
    sandbox._authUser = () => USERS.ana;
    await api.refresh(false);
    await flush(6);
    await sandbox.openFriends('friends');
    await flush(10);
    const friendsTab = dom.document.getElementById('frTabFriends');
    assert(friendsTab.innerHTML.indexOf('data-action="chat"') !== -1, 'the friends list must render a chat button');
    assert(friendsTab.innerHTML.indexOf(USERS.mihai.id) !== -1, 'the accepted friend must be listed');
    assert(friendsTab.innerHTML.indexOf('frSearchInput') === -1, 'the search bar must live in its own tab, not in the friend list');
    await sandbox.openFriends('search');
    await flush(10);
    const searchTab = dom.document.getElementById('frTabSearch');
    assert(searchTab.innerHTML.indexOf('frSearchInput') !== -1, 'the search tab must render the search bar');
    assert(searchTab.innerHTML.indexOf('frCountySelect') !== -1, 'the search tab must render the county filter');
    assert(friendsTab.innerHTML.indexOf('data-action="chat"') !== -1, 'the friends tab keeps rendering a chat button after the switch');
    ok('the panel splits „Caută prieteni” (search bar + county filter) from „Prietenii tăi” (list + a 💬 button per friend)');

    /* ── Private chat ── */
    const direct = await server.rpc('start_direct_conversation', { _other_user: USERS.mihai.id });
    assert(!direct.error, 'friends must be able to open a private chat');
    const convId = direct.data.id;

    const notFriend = await server.rpc('start_direct_conversation', { _other_user: USERS.elena.id });
    assert.strictEqual(notFriend.error.message, 'NOT_FRIENDS', 'a private chat requires friendship');

    const sent = await server.rpc('send_conversation_message', {
        _conversation_id: convId, _body: 'Salut Mihai! Plecăm sâmbătă?', _media_url: null, _media_type: 'none', _media_bytes: 0
    });
    assert(!sent.error, 'a message must be accepted');
    assert.strictEqual(sent.data.sender_id, USERS.ana.id);

    server.as(USERS.mihai.id);
    const history = server.from('conversation_messages').select('*').eq('conversation_id', convId);
    const rows = await history;
    assert.strictEqual(rows.data.length, 1, 'Mihai sees the same thread on his own account');

    const tooLong = await server.rpc('send_conversation_message', {
        _conversation_id: convId, _body: 'x'.repeat(LIMITS.max_message_length + 1), _media_url: null, _media_type: 'none', _media_bytes: 0
    });
    assert.strictEqual(tooLong.error.message.indexOf('MESSAGE_TOO_LONG'), 0, 'over-long messages must be refused');

    const bigAttachment = await server.rpc('send_conversation_message', {
        _conversation_id: convId, _body: '', _media_url: 'data:video/mp4;base64,' + 'C'.repeat(1024),
        _media_type: 'video', _media_bytes: LIMITS.max_attachment_bytes + 1
    });
    assert.strictEqual(bigAttachment.error.message.indexOf('ATTACHMENT_TOO_LARGE'), 0, 'oversize attachments must be refused');

    // Per-thread cap: with max_messages_per_conversation = 5, the oldest go first.
    server.as(USERS.ana.id);
    for (let i = 0; i < 8; i++) {
        await server.rpc('send_conversation_message', {
            _conversation_id: convId, _body: 'mesaj ' + i, _media_url: null, _media_type: 'none', _media_bytes: 0
        });
    }
    const thread = server.tables.conversation_messages.filter(m => m.conversation_id === convId);
    assert.strictEqual(thread.length, LIMITS.max_messages_per_conversation, 'the thread must stay at the cap');
    assert(thread.every(m => m.body !== 'Salut Mihai! Plecăm sâmbătă?'), 'the oldest messages are trimmed first');
    ok('message length, attachment size and the per-thread cap (oldest first) are enforced');

    /* ── Client-side guard rails mirror the DB rules ── */
    sandbox._authUser = () => USERS.ana;
    server.as(USERS.ana.id);
    const clientLong = await sandbox.window.DetectLabFriends.prepareAttachment({
        size: LIMITS.max_attachment_bytes + 10, type: 'image/jpeg', name: 'big.jpg'
    });
    assert(clientLong && clientLong.error, 'prepareAttachment must reject a file above the cap before reading it');

    const clientSmall = await sandbox.window.DetectLabFriends.prepareAttachment({
        size: 40 * 1024, type: 'image/jpeg', name: 'small.jpg'
    });
    assert(clientSmall && clientSmall.url && clientSmall.type === 'image', 'a small image must be downscaled to a data URL');
    assert(clientSmall.url.length < 4096, 'the downscaled payload must stay small');
    ok('attachments are checked and downscaled in the browser before upload');

    /* ── Group chat with admin rights ── */
    // Ana needs more friends for a group: befriend Elena and Ioana.
    for (const other of [USERS.elena, USERS.ioana]) {
        const r = await server.rpc('send_friend_request', { _addressee_id: other.id, _message: '' });
        if (r.error) continue;
        server.as(other.id);
        await server.rpc('respond_friend_request', { _request_id: r.data.id, _accept: true });
        server.as(USERS.ana.id);
    }

    const noTitle = await server.rpc('create_group_conversation', { _title: '  ', _member_ids: [USERS.mihai.id] });
    assert.strictEqual(noTitle.error.message, 'TITLE_REQUIRED', 'a group needs a title');

    const stranger = await server.rpc('create_group_conversation', { _title: 'Grup', _member_ids: [USERS.vlad.id] });
    assert.strictEqual(stranger.error.message, 'NOT_FRIENDS', 'only friends can be invited to a group');

    const tooBig = await server.rpc('create_group_conversation', {
        _title: 'Grup mare', _member_ids: [USERS.mihai.id, USERS.elena.id, USERS.ioana.id, USERS.vlad.id]
    });
    assert.strictEqual(tooBig.error.message.indexOf('GROUP_TOO_LARGE'), 0, 'the member cap must be enforced');

    const group = await server.rpc('create_group_conversation', { _title: 'Vânătoare sâmbăta', _member_ids: [USERS.mihai.id, USERS.elena.id] });
    assert(!group.error, 'a group with friends must be created');
    const groupId = group.data.id;
    const members = await server.rpc('get_conversation_members', { _conversation_id: groupId });
    const anaRow = members.data.filter(m => m.user_id === USERS.ana.id)[0];
    const mihaiRow = members.data.filter(m => m.user_id === USERS.mihai.id)[0];
    assert.strictEqual(anaRow.role, 'admin', 'the creator must be the group admin');
    assert.strictEqual(mihaiRow.role, 'member', 'invited friends are plain members');

    server.as(USERS.mihai.id);
    const notAdmin = await server.rpc('rename_conversation', { _conversation_id: groupId, _title: 'Alt nume' });
    assert.strictEqual(notAdmin.error.message, 'ADMIN_ONLY', 'only the admin renames the group');
    const notAdminRemove = await server.rpc('remove_conversation_member', { _conversation_id: groupId, _user_id: USERS.elena.id });
    assert.strictEqual(notAdminRemove.error.message, 'ADMIN_ONLY', 'only the admin removes members');

    server.as(USERS.ana.id);
    const renamed = await server.rpc('rename_conversation', { _conversation_id: groupId, _title: 'Echipa DetectLab' });
    assert(!renamed.error && renamed.data.title === 'Echipa DetectLab', 'the admin can rename the group');
    const removed = await server.rpc('remove_conversation_member', { _conversation_id: groupId, _user_id: USERS.elena.id });
    assert(!removed.error, 'the admin can remove a member');

    // A group event: create it from the group thread and invite every member.
    const eventRow = {
        id: 'ev-1', creator_id: USERS.ana.id, creator_name: 'Ana Pop', title: 'Detectat la Feleacu',
        latitude: 46.72, longitude: 23.65, event_date: new Date(Date.now() + 6 * 86400000).toISOString(),
        max_attendees: null, created_at: new Date().toISOString()
    };
    server.tables.events.push(eventRow);
    const invited = await server.rpc('invite_friends_to_event', { _event_id: 'ev-1', _friend_ids: [USERS.mihai.id, USERS.vlad.id] });
    const results = {};
    invited.data.forEach(r => { results[r.result] = (results[r.result] || 0) + 1; });
    assert.strictEqual(results.invited, 1, 'the friend must be invited');
    assert.strictEqual(results.not_friend, 1, 'a non-friend cannot be invited');
    const mihaiNotif = server.tables.event_notifications.filter(n => n.user_id === USERS.mihai.id && n.kind === 'friend_event_invite');
    assert.strictEqual(mihaiNotif.length, 1, 'the invited friend receives a friend_event_invite notification');
    assert(mihaiNotif[0].inquiry_id, 'the invite is backed by a real participation request');
    ok('group chat: title required, friends only, creator is admin, admin-only rename/remove, invites reach friends only');

    /* ── Per-account local mirror ── */
    const anaKey = 'detectlab_social_v1:' + USERS.ana.id;
    const cacheRaw = sandbox._storage[anaKey];
    assert(cacheRaw, 'the mirror must be stored under detectlab_social_v1:<userId>');
    const cache = JSON.parse(cacheRaw);
    assert.strictEqual(cache.userId, USERS.ana.id, 'the mirror is bound to the account');
    assert(Array.isArray(cache.friends) && cache.friends.length >= 1, 'friends are mirrored');
    assert(Array.isArray(cache.conversations), 'conversations are mirrored');

    // Media never enters the mirror (it would blow the browser quota).
    server.as(USERS.ana.id);
    await server.rpc('send_conversation_message', {
        _conversation_id: convId, _body: '', _media_url: 'data:image/jpeg;base64,' + 'D'.repeat(2048),
        _media_type: 'image', _media_bytes: 2048
    });
    sandbox._authUser = () => USERS.ana;
    await sandbox._openSocialConversation(convId);
    await flush(10);
    const cacheAfter = JSON.parse(sandbox._storage[anaKey]);
    const mirrored = cacheAfter.messages[convId] || [];
    assert(mirrored.length > 0, 'messages are mirrored per conversation');
    assert(mirrored.every(m => !m.media_url), 'media data URLs must never be mirrored locally');

    // A second account on the same device gets its own mirror.
    sandbox._authUser = () => USERS.mihai;
    server.as(USERS.mihai.id);
    sandbox._fireWindowEvent('detectlab:authchange', { user: USERS.mihai });
    await sandbox._flushTimers();
    await flush(12);
    const mihaiKey = 'detectlab_social_v1:' + USERS.mihai.id;
    assert(sandbox._storage[mihaiKey], 'the second account gets its own mirror');
    const mihaiCache = JSON.parse(sandbox._storage[mihaiKey]);
    assert.strictEqual(mihaiCache.userId, USERS.mihai.id);
    assert(mihaiCache.friends.some(f => f.user_id === USERS.ana.id), 'Mihai sees Ana as a friend');
    ok('the local mirror is keyed per account, holds no media, and accounts never mix');

    /* ── Missing backend is reported, not silently ignored ── */
    const brokenServer = createSocialServer({ missingFunctions: true });
    const dom2 = createDom();
    const sandbox2 = createSandbox(brokenServer, USERS.ana, dom2);
    runInSandbox(sandbox2, [{ code: FRIENDS_JS, name: 'js/friends.js' }]);
    brokenServer.as(USERS.ana.id);
    sandbox2._fireWindowEvent('detectlab:authchange', { user: USERS.ana });
    await sandbox2._flushTimers();
    await flush(10);
    assert.strictEqual(sandbox2.DetectLabFriends.backendAvailable(), false, 'a missing function must mark the backend as unavailable');
    await sandbox2.openFriends('friends');
    await flush(10);
    const notice = dom2.document.getElementById('frTabFriends');
    assert(notice.innerHTML.indexOf('20260915') !== -1, 'the panel must point at the missing migrations');
    ok('an unmigrated database shows a clear notice instead of an empty panel');

    return { server: server, dom: dom, sandbox: sandbox };
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 2 — js/events.js integration (Add friends box, quotas, invite modal)
══════════════════════════════════════════════════════════════════════════ */

async function partTwo() {
    console.log('\n[2] js/events.js — "Adaugă prieteni", event quotas and the invite notification');

    const server = createSocialServer();
    const dom = createDom();

    // A scripted social API: the real module is covered in part 1, here we only
    // need to prove events.js calls it correctly.
    const socialCalls = { invited: [], pickers: [], quotaLoads: 0 };
    const socialStub = {
        getLimits: () => Object.assign({}, LIMITS),
        loadLimits: async () => LIMITS,
        getEventQuota: async function () {
            socialCalls.quotaLoads++;
            return socialStub._quota;
        },
        _quota: { created: 2, createdMax: 10, attending: 1, attendingMax: 15, deadlineDays: 365 },
        loadFriends: async () => [],
        getFriends: () => [],
        renderFriendPicker: function (container, opts) {
            socialCalls.pickers.push({ container: container, selected: opts.selected });
            container._dlPickerSelected = opts.selected;
            container.innerHTML = '<div class="fr-picker">picker</div>';
        },
        readFriendPicker: function (container) { return Object.keys(container._dlPickerSelected || {}); },
        inviteFriendsToEvent: async function (eventId, ids) {
            socialCalls.invited.push({ eventId: eventId, ids: ids });
            return { ok: true, results: ids.map(id => ({ user_id: id, result: 'invited' })) };
        },
        summariseInviteResults: function (rows) {
            const counts = {};
            rows.forEach(r => { counts[r.result] = (counts[r.result] || 0) + 1; });
            return counts;
        },
        inviteSummaryText: function (counts) { return (counts.invited || 0) + ' prieteni invitați'; }
    };

    const L = {
        layerGroup() { const g = { addTo() { return g; }, clearLayers() {}, addLayer() {}, removeLayer() {}, eachLayer() {} }; return g; },
        divIcon(o) { return { options: o, html: o && o.html }; },
        marker() { return { bindPopup() { return this; }, on() { return this; } }; },
        DomEvent: { stop() {} }
    };

    const sandbox = createSandbox(server, USERS.ana, dom, {
        L: L,
        DetectLabFriends: socialStub,
        openAuth: function () {},
        _dlMap: { getCenter: () => ({ lat: 46.77, lng: 23.62 }), closePopup() {}, hasLayer: () => false, removeLayer() {} }
    });
    sandbox.DetectLabFriends = socialStub;
    runInSandbox(sandbox, [{ code: EVENTS_JS, name: 'js/events.js' }]);
    sandbox.DetectLabFriends = socialStub;
    server.as(USERS.ana.id);

    /* ── The create-event form renders the friends box and invites the ticked friends ── */
    const dateInput = dom.document.getElementById('ceDate');
    const titleInput = dom.document.getElementById('ceTitle');
    const submitBtn = dom.document.getElementById('ceSubmitBtn');

    sandbox.openCreateEventModal(46.77, 23.62, null, '', {
        preselectedFriendIds: [USERS.mihai.id],
        showCoordinates: true,
        showFriendsPicker: true,
        sourceConversationId: 'conv-1'
    });
    await flush(6);

    assert(socialCalls.pickers.length >= 1, 'the create-event form must render the "Adaugă prieteni" picker');
    assert(socialCalls.pickers[0].selected[USERS.mihai.id], 'friends passed by the chat must be preselected');

    titleInput.value = 'Detectat la Feleacu';
    dateInput.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    dom.document.getElementById('ceTime').value = '09:00';

    let createdHook = null;
    await submitBtn.fire('click', { target: submitBtn });
    await flush(12);

    assert.strictEqual(socialCalls.invited.length, 1, 'saving must invite the ticked friends');
    assert.deepStrictEqual(socialCalls.invited[0].ids, [USERS.mihai.id], 'exactly the ticked friends are invited');
    const savedEvent = server.tables.events.filter(e => e.title === 'Detectat la Feleacu')[0];
    assert(savedEvent, 'the event must be stored');
    assert.strictEqual(socialCalls.invited[0].eventId, savedEvent.id, 'the invite targets the new event');
    assert(sandbox._alerts.some(a => a.indexOf('prieten') !== -1 || a.indexOf('invita') !== -1 || a.indexOf('creat') !== -1),
        'the creator is told what happened with the invites');
    ok('the create-event form invites exactly the friends ticked in "Adaugă prieteni"');

    /* ── A quota refusal from the DB must not leave a local ghost event ── */
    const before = server.tables.events.length;
    // Simulate trigger_guard_event_limits rejecting the upsert.
    const originalFrom = server.from.bind(server);
    server.from = function (table) {
        const api = originalFrom(table);
        if (table === 'events') {
            const originalUpsert = api.upsert.bind(api);
            api.upsert = function (rows, o) {
                return Promise.resolve({
                    data: null,
                    error: { code: 'P0001', message: 'EVENT_CREATION_LIMIT:10' }
                });
            };
            void originalUpsert;
        }
        return api;
    };

    const ghostTitle = 'Eveniment blocat de cotă';
    dom.document.getElementById('ceTitle').value = ghostTitle;
    dom.document.getElementById('ceDate').value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    sandbox.openCreateEventModal(46.77, 23.62, null, '', {});
    await flush(4);
    dom.document.getElementById('ceTitle').value = ghostTitle;
    dom.document.getElementById('ceDate').value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    dom.document.getElementById('ceTime').value = '10:00';
    const submit2 = dom.document.getElementById('ceSubmitBtn');
    await submit2.fire('click', { target: submit2 });
    await flush(12);

    assert.strictEqual(server.tables.events.length, before, 'no event row may be added when the DB refuses');
    const errEl = dom.document.getElementById('ceError');
    assert(errEl.textContent.indexOf('maxim') !== -1 || errEl.textContent.indexOf('10') !== -1,
        'the form must explain the quota refusal, got: ' + errEl.textContent);
    const localEvents = JSON.parse(sandbox._storage['detectlab_events'] || '[]');
    assert(!localEvents.some(e => e.title === ghostTitle), 'a refused event must not be cached locally either');
    ok('a DB quota refusal is surfaced in the form and never cached as a ghost event');
    server.from = originalFrom;

    /* ── Deadline cap comes from app_limits, not a hard-coded year ── */
    socialStub._quota = { created: 0, createdMax: 10, attending: 0, attendingMax: 15, deadlineDays: 30 };
    sandbox.openCreateEventModal(46.77, 23.62, null, '', {});
    await flush(4);
    dom.document.getElementById('ceTitle').value = 'Prea departe';
    dom.document.getElementById('ceDate').value = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
    dom.document.getElementById('ceTime').value = '10:00';
    const submit3 = dom.document.getElementById('ceSubmitBtn');
    await submit3.fire('click', { target: submit3 });
    await flush(8);
    const farError = dom.document.getElementById('ceError').textContent;
    assert(farError.indexOf('30') !== -1, 'the deadline cap must be read from app_limits, got: ' + farError);
    ok('the maximum event deadline is driven by public.app_limits (30 days in this test)');
    socialStub._quota = { created: 0, createdMax: 10, attending: 0, attendingMax: 15, deadlineDays: 365 };

    /* ── The friend invite notification offers accept / decline ── */
    server.as(USERS.mihai.id);
    sandbox._authUser = () => USERS.mihai;
    const event2 = {
        id: 'ev-2', creator_id: USERS.ana.id, creator_name: 'Ana Pop', title: 'Detectat la Turda',
        latitude: 46.56, longitude: 23.78, event_date: new Date(Date.now() + 9 * 86400000).toISOString(),
        created_at: new Date().toISOString()
    };
    server.tables.events.push(event2);
    const inquiry = {
        id: 'inq-2', event_id: 'ev-2', user_id: USERS.mihai.id, user_name: 'Mihai Ionescu',
        message: 'Invitație de la Ana', status: 'pending', created_at: new Date().toISOString()
    };
    server.tables.event_inquiries.push(inquiry);
    server.tables.event_notifications.push({
        id: 'notif-2', user_id: USERS.mihai.id, event_id: 'ev-2', inquiry_id: 'inq-2',
        sender_id: USERS.ana.id, sender_name: 'Ana Pop', message: 'Ana te-a invitat', read: false,
        kind: 'friend_event_invite', created_at: new Date().toISOString()
    });

    await sandbox._checkEventNotifications();
    await flush(14);

    const modal = dom.document.getElementById('eventNotifModal');
    assert(modal.innerHTML.indexOf('Invitație de la un prieten') !== -1, 'the invite modal must be rendered, got: ' + modal.innerHTML.slice(0, 120));
    assert(modal.innerHTML.indexOf('notifInviteAcceptBtn') !== -1, 'the invite must offer Accept');
    assert(modal.innerHTML.indexOf('notifInviteDeclineBtn') !== -1, 'the invite must offer Decline');
    assert(modal.innerHTML.indexOf('Detectat la Turda') !== -1, 'the invited event title must be shown');

    const acceptBtn = modal.querySelector('#notifInviteAcceptBtn');
    await acceptBtn.fire('click', { target: acceptBtn });
    await flush(14);

    const attendee = server.tables.event_attendees.filter(a => a.event_id === 'ev-2' && a.user_id === USERS.mihai.id)[0];
    assert(attendee, 'accepting the invite must add the friend as an attendee');
    const inquiryAfter = server.tables.event_inquiries.filter(i => i.id === 'inq-2')[0];
    assert.strictEqual(inquiryAfter.status, 'accepted', 'the participation request must flip to accepted');
    ok('a friend_event_invite notification shows the event and accepting joins it');
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 3 — the menus actually expose the Friends button
══════════════════════════════════════════════════════════════════════════ */

function partThree() {
    console.log('\n[3] index.html / translations / service worker wiring');

    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const translations = fs.readFileSync(path.join(__dirname, 'js/translations.js'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

    assert(html.indexOf('onclick="openFriends()"') !== -1, 'a nav entry must call openFriends()');
    assert((html.match(/onclick="openFriends\(\)"/g) || []).length >= 2, 'both the desktop menu and the PWA dropdown need the button');
    assert(html.indexOf('data-key="nav_friends"') !== -1, 'the button must be translatable');
    assert(html.indexOf('js/friends.js') !== -1, 'index.html must load js/friends.js');
    assert(html.indexOf('js/friends.js') > html.indexOf('js/events.js'), 'friends.js must load after events.js');

    assert(translations.indexOf("nav_friends: 'Prieteni'") !== -1, 'Romanian label must be "Prieteni"');
    assert(translations.indexOf("nav_friends: 'Friends'") !== -1, 'English label must be "Friends"');

    assert(sw.indexOf("'js/friends.js?v=20260915-social'") !== -1, 'the PWA must precache js/friends.js');
    // CACHE_NAME is re-bumped by every release (the visibility prompt bumped
    // it to v87, the tile governor to v100), so assert it is at least the
    // social one (v86) rather than pinning a version that is already stale.
    const friendsCache = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1] || 0);
    assert(friendsCache >= 86, 'the service worker cache must be bumped (got: ' + friendsCache + ')');
    ok('nav button (desktop + PWA), RO/EN labels, script order and PWA precache are in place');

    const migrations = fs.readdirSync(path.join(__dirname, 'supabase/migrations'))
        .filter(f => f.indexOf('20260915') === 0);
    assert.strictEqual(migrations.length, 4, 'the four social migrations must exist, found: ' + migrations.join(', '));
    const all = migrations.map(f => fs.readFileSync(path.join(__dirname, 'supabase/migrations', f), 'utf8')).join('\n');
    [
        'create table if not exists public.app_limits',
        'create table if not exists public.friend_requests',
        'create table if not exists public.friendships',
        'create table if not exists public.conversations',
        'create table if not exists public.conversation_messages',
        'create or replace function public.send_friend_request',
        'create or replace function public.respond_friend_request',
        'create or replace function public.create_group_conversation',
        'create or replace function public.send_conversation_message',
        'create or replace function public.invite_friends_to_event',
        'create or replace function public.cleanup_social_messages',
        'trigger_guard_event_limits',
        'trigger_guard_event_attendance_limits'
    ].forEach(function (needle) {
        assert(all.indexOf(needle) !== -1, 'migrations must contain: ' + needle);
    });
    ok('migrations define the tables, the quota triggers and the cleanup jobs');

    // The search fix needs its own migration: the directory must be a
    // projection of what the app already knows, and a blank query must browse
    // instead of matching the empty substring nowhere.
    const unified = ['20260916010000_social_unified_search.sql', '20260916020000_social_directory_projection.sql']
        .map(f => fs.readFileSync(path.join(__dirname, 'supabase/migrations', f), 'utf8')).join('\n');
    assert(/create or replace function public\.search_normalise/.test(unified),
        'search_normalise() must fold case and diacritics');
    assert(/coalesce\(cardinality\(v_tokens\), 0\) = 0/.test(unified),
        'a blank query must be the "no text filter" branch (an empty array, not [""])');
    assert(/v_tokens text\[\] := case when v_q = '' then null/.test(unified),
        'tokens must be built from a NULL query, not from splitting an empty string');
    assert(/create or replace function public\.mirror_social_profile/.test(unified),
        'the directory must be mirrored from the tables the app already writes');
    assert(/create trigger user_last_locations_mirror_social_profile/.test(unified) &&
           /create trigger detector_presence_mirror_social_profile/.test(unified),
        'both location tables must keep the searchable directory up to date');
    ok('the directory is mirrored from user_last_locations / detector_presence and browses on a blank query');
}

(async function main() {
    try {
        await partOne();
        await partTwo();
        partThree();
        console.log('\n✅ test-friends-social.js passed (' + passed + ' checks): friends, requests, group chat admin rights,');
        console.log('   message/attachment/rate/retention limits, per-account storage and the event invite flow.\n');
        process.exit(0);
    } catch (e) {
        console.error('\n❌ test-friends-social.js FAILED:');
        console.error(e && e.stack ? e.stack : e);
        process.exit(1);
    }
})();
