/* ══════════════════════════════════════════════════════════════════════════
   DetectLab Social — "Prieteni" / "Friends"
   ──────────────────────────────────────────────────────────────────────────
   • Friends panel (nav → Prieteni, under Events / Manage Account) with three
     tabs: friends, friend requests and chats.
   • Search by e-mail, display name or account id + a county (județ) filter.
   • Accepting a request puts the user in the friends list with a 💬 chat
     button; chats are private (1:1) or group threads with a title, invited
     members and an admin (the creator).
   • From a chat the creator can start an event with that friend (1:1) or with
     the whole group, and the create-event form gained an "Adaugă prieteni /
     Add friends" box — invited friends receive a participation request they
     can accept or decline.
   • STORAGE MODEL: messages live in Postgres keyed by ACCOUNT (conversations +
     conversation_members + conversation_messages, RLS = members only), so the
     same thread is there after logging into the same account on another
     device. On top of that every account gets its own localStorage mirror
     (detectlab_social_v1:<userId>) used for instant offline rendering and for
     drafts. Media data URLs are never mirrored locally — they are too big for
     the browser quota — and everything ages out server-side after
     app_limits.message_retention_days.
   • Every quota (friends, requests/day, message length, messages per thread,
     messages per minute/day, attachment size, thread + account storage) is
     enforced by the SECURITY DEFINER functions of migrations
     20260915000000 … 20260915030000; this file mirrors them for instant
     feedback and prints them next to the inputs.
══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ── Constants ─────────────────────────────────────────────────────── */

    var CACHE_PREFIX = 'detectlab_social_v1:';
    var CACHE_VERSION = 1;
    var CACHED_MESSAGES_PER_CONVERSATION = 60;
    var CACHE_BYTE_BUDGET = 3 * 1024 * 1024;   // ~3 MB per account mirror
    var MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
    var IMAGE_MAX_EDGE = 1280;
    var IMAGE_QUALITY = 0.72;
    var COUNTER_POLL_MS = 20000;
    var CHAT_POLL_MS = 6000;

    // Mirrors the defaults of public.app_limits; the real values are fetched
    // with get_app_limits() as soon as the panel opens.
    var DEFAULT_LIMITS = {
        max_events_created_active: 10,
        max_events_attending_active: 15,
        max_event_deadline_days: 365,
        max_event_invites_per_event: 50,
        max_friends: 1000,
        max_friend_requests_per_day: 50,
        max_friend_request_message_len: 200,
        max_group_conversations: 50,
        max_group_members: 100,
        max_conversation_title_len: 60,
        max_message_length: 2000,
        max_messages_per_conversation: 5000,
        max_messages_per_minute: 60,
        max_messages_per_day: 2000,
        message_retention_days: 90,
        max_attachment_bytes: MAX_ATTACHMENT_BYTES,
        max_conversation_storage_bytes: 209715200,
        max_user_storage_bytes: 524288000,
        event_chat_message_length: 2000,
        event_chat_retention_days: 90
    };

    /* ── State ─────────────────────────────────────────────────────────── */

    var state = {
        limits: Object.assign({}, DEFAULT_LIMITS),
        limitsLoaded: false,
        backend: 'unknown',          // 'ok' | 'missing' | 'error'
        backendDetail: '',
        profileReady: false,
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        conversations: [],
        counties: [],
        counters: { pending_requests: 0, unread_messages: 0, friends: 0, conversations: 0 },
        quota: null,
        search: { query: '', county: '', results: [], loading: false, searched: false },
        activeTab: 'friends',
        panelOpen: false,
        chat: null,                  // { id, kind, title, status, my_role, other_user_id, other_user_name }
        chatMessages: [],
        chatMembers: [],
        chatLoading: false,
        groupDraft: null,            // { title, selected: {} }
        countersTimer: null,
        chatPollTimer: null,
        realtimeChannel: null,
        realtimeConvId: null,
        sendTimestamps: []
    };

    /* ── Tiny helpers ──────────────────────────────────────────────────── */

    function sb() { return window.supabaseClient || null; }

    function currentUser() {
        try { return window._authUser ? window._authUser() : null; } catch (e) { return null; }
    }

    function isRo() {
        try { return window._currentLang ? window._currentLang() === 'ro' : true; } catch (e) { return true; }
    }

    function t(roText, enText) { return isRo() ? roText : enText; }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function genUuid() {
        try {
            if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
        } catch (e) {}
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function fmtDateTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        try {
            return d.toLocaleString(isRo() ? 'ro-RO' : 'en-US', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return d.toString(); }
    }

    function fmtShortTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var now = new Date();
        var sameDay = d.toDateString() === now.toDateString();
        try {
            if (sameDay) {
                return d.toLocaleTimeString(isRo() ? 'ro-RO' : 'en-US', { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString(isRo() ? 'ro-RO' : 'en-US', { day: '2-digit', month: '2-digit' });
        } catch (e) { return d.toLocaleString(); }
    }

    function fmtBytes(bytes) {
        var n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function initials(name) {
        var parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function avatarHue(seed) {
        var s = String(seed || 'x');
        var h = 0;
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
        return h;
    }

    function maskEmail(email) {
        var e = String(email || '');
        if (!e || e.indexOf('@') === -1) return e;
        var parts = e.split('@');
        var name = parts[0];
        var shown = name.length <= 2 ? name.charAt(0) : name.charAt(0) + '…' + name.slice(-2);
        return shown + '@' + parts[1];
    }

    function normaliseCounty(raw) {
        var s = String(raw || '').toLowerCase();
        try {
            s = s.replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't');
        } catch (e) {}
        s = s.replace(/\b(judetul|judet|jud|county|province|voivodeship|region|regiunea|municipiul)\b/g, ' ');
        return s.replace(/\s+/g, ' ').trim();
    }

    function titleCase(s) {
        return String(s || '').replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
    }

    /* ── Per-account local mirror ──────────────────────────────────────── */

    function cacheKey(userId) { return CACHE_PREFIX + userId; }

    function readCache() {
        var user = currentUser();
        if (!user || !user.id) return null;
        try {
            var raw = localStorage.getItem(cacheKey(user.id));
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || parsed.v !== CACHE_VERSION || parsed.userId !== user.id) return null;
            return parsed;
        } catch (e) { return null; }
    }

    function writeCache(patch) {
        var user = currentUser();
        if (!user || !user.id) return;
        var cache = readCache() || {
            v: CACHE_VERSION, userId: user.id, savedAt: null,
            limits: null, friends: [], incomingRequests: [], outgoingRequests: [],
            conversations: [], counties: [], messages: {}, counters: null
        };
        Object.assign(cache, patch || {});
        cache.userId = user.id;
        cache.savedAt = new Date().toISOString();

        // Media data URLs never enter the mirror (they would blow the browser
        // quota in a handful of photos) and the mirror itself is bounded.
        var msgMap = cache.messages || {};
        Object.keys(msgMap).forEach(function (convId) {
            msgMap[convId] = (msgMap[convId] || [])
                .slice(-CACHED_MESSAGES_PER_CONVERSATION)
                .map(function (m) {
                    if (m && m.media_type && m.media_type !== 'none') {
                        return Object.assign({}, m, { media_url: null, media_cached: false });
                    }
                    return m;
                });
        });
        cache.messages = msgMap;

        try {
            var serialised = JSON.stringify(cache);
            if (serialised.length > CACHE_BYTE_BUDGET) {
                // Oldest threads first: keep the 12 most recent conversations.
                var keep = (cache.conversations || []).slice(0, 12).map(function (c) { return c.id; });
                var trimmed = {};
                keep.forEach(function (id) { if (msgMap[id]) trimmed[id] = msgMap[id].slice(-25); });
                cache.messages = trimmed;
                serialised = JSON.stringify(cache);
            }
            localStorage.setItem(cacheKey(user.id), serialised);
        } catch (e) {
            // Quota exceeded or private mode: the mirror is a convenience, the
            // server stays the source of truth.
            try { localStorage.removeItem(cacheKey(user.id)); } catch (e2) {}
        }
    }

    function cacheMessages(convId, messages) {
        if (!convId) return;
        var cache = readCache();
        var map = (cache && cache.messages) || {};
        map[convId] = (messages || []).slice(-CACHED_MESSAGES_PER_CONVERSATION);
        writeCache({ messages: map });
    }

    function cachedMessages(convId) {
        var cache = readCache();
        return (cache && cache.messages && cache.messages[convId]) || [];
    }

    /* ── Supabase access + graceful degradation ────────────────────────── */

    function isMissingBackendError(err) {
        var code = String((err && (err.code || (err.details && err.details.code))) || '');
        var msg = String((err && (err.message || err.hint)) || err || '').toLowerCase();
        if (code === '42883' || code === '42P01' || code === 'PGRST202' || code === 'PGRST201') return true;
        return /could not find the function|function .* does not exist|relation .* does not exist|does not exist|schema cache/i.test(msg);
    }

    function noteBackendProblem(err) {
        if (isMissingBackendError(err)) {
            state.backend = 'missing';
            state.backendDetail = String((err && err.message) || err || '');
            console.warn('[Friends] Social backend not installed yet:', state.backendDetail);
            return true;
        }
        if (state.backend !== 'missing') state.backend = 'error';
        return false;
    }

    function backendMissing() { return state.backend === 'missing' || state.backend === 'no-client'; }

    function backendNoticeHtml() {
        if (state.backend === 'no-client') {
            return '<div class="fr-notice">⚠️ ' + escapeHtml(t(
                'Conexiunea la serverul DetectLab nu este disponibilă, deci prietenii și chat-urile nu pot fi încărcate. Verifică internetul și reîncearcă.',
                'The DetectLab server connection is unavailable, so friends and chats cannot be loaded. Check your connection and try again.'
            )) + '</div>';
        }
        if (state.backend !== 'missing') return '';
        return '<div class="fr-notice">⚠️ ' + escapeHtml(t(
            'Modulul social nu este încă activ pe server: rulează migrațiile supabase/migrations/20260915*.sql. Până atunci prietenii și chat-urile nu pot fi salvate pe contul tău.',
            'The social module is not installed on the server yet: run the supabase/migrations/20260915*.sql migrations. Friends and chats cannot be stored on your account until then.'
        )) + '</div>';
    }

    async function rpc(name, params) {
        var client = sb();
        if (!client || typeof client.rpc !== 'function') {
            state.backend = 'no-client';
            state.backendDetail = 'supabase client unavailable';
            return { data: null, error: { message: 'no-client', code: 'NO_CLIENT' } };
        }
        try {
            var res = await client.rpc(name, params || {});
            if (res && res.error) {
                noteBackendProblem(res.error);
                return { data: null, error: res.error };
            }
            if (state.backend !== 'ok') { state.backend = 'ok'; state.backendDetail = ''; }
            return { data: res ? res.data : null, error: null };
        } catch (e) {
            noteBackendProblem(e);
            return { data: null, error: e };
        }
    }

    async function selectFrom(table, builder) {
        var client = sb();
        if (!client) {
            state.backend = 'no-client';
            return { data: null, error: { message: 'no-client' } };
        }
        try {
            var q = client.from(table);
            var res = await builder(q);
            if (res && res.error) {
                noteBackendProblem(res.error);
                return { data: null, error: res.error };
            }
            return { data: res ? res.data : null, error: null };
        } catch (e) {
            noteBackendProblem(e);
            return { data: null, error: e };
        }
    }

    /* Maps the codes raised by the migration functions onto UI copy. */
    function friendlyError(err) {
        var raw = String((err && (err.message || err.description)) || err || '');
        var code = raw.split(':')[0].trim().toUpperCase();
        var arg = raw.indexOf(':') !== -1 ? raw.split(':').slice(1).join(':').trim() : '';
        var table = {
            'NOT_SIGNED_IN': t('Trebuie să fii autentificat.', 'You must be signed in.'),
            'CANNOT_ADD_SELF': t('Nu te poți adăuga pe tine ca prieten.', 'You cannot add yourself as a friend.'),
            'USER_NOT_FOUND': t('Contul căutat nu are încă profil social.', 'That account has no social profile yet.'),
            'USER_NOT_DISCOVERABLE': t('Acest utilizator nu poate fi găsit prin căutare.', 'This user cannot be found through search.'),
            'ALREADY_FRIENDS': t('Sunteți deja prieteni.', 'You are already friends.'),
            'REQUEST_ALREADY_PENDING': t('Există deja o cerere în așteptare între voi.', 'A request between you is already pending.'),
            'REQUEST_NOT_FOUND': t('Cererea nu a fost găsită.', 'Request not found.'),
            'NOT_YOUR_REQUEST': t('Nu poți răspunde la această cerere.', 'This request is not addressed to you.'),
            'NOT_FRIENDS': t('Trebuie să fiți prieteni pentru asta.', 'You must be friends to do that.'),
            'NOT_A_MEMBER': t('Nu faci parte din această conversație.', 'You are not a member of this conversation.'),
            'ADMIN_ONLY': t('Doar administratorul grupului poate face asta.', 'Only the group admin can do that.'),
            'LAST_ADMIN': t('Grupul trebuie să aibă un administrator.', 'The group must keep an admin.'),
            'MEMBER_NOT_FOUND': t('Membrul nu a fost găsit.', 'Member not found.'),
            'USE_LEAVE_INSTEAD': t('Folosește „Ieși din grup” pentru a te elimina.', 'Use "Leave group" to remove yourself.'),
            'CONVERSATION_NOT_FOUND': t('Conversația nu a fost găsită.', 'Conversation not found.'),
            'CONVERSATION_CLOSED': t('Conversația este închisă și nu mai primește mesaje.', 'This conversation is closed and no longer accepts messages.'),
            'DIRECT_CONVERSATION_FIXED': t('Chat-ul privat are fix doi participanți.', 'A private chat has exactly two participants.'),
            'TITLE_REQUIRED': t('Titlul grupului este obligatoriu.', 'The group title is required.'),
            'NO_MEMBERS_SELECTED': t('Selectează cel puțin un prieten.', 'Select at least one friend.'),
            'EMPTY_MESSAGE': t('Mesajul este gol.', 'The message is empty.'),
            'UNSUPPORTED_MEDIA_TYPE': t('Tip de atașament nesuportat.', 'Unsupported attachment type.'),
            'EVENT_NOT_FOUND': t('Evenimentul nu a fost găsit.', 'Event not found.'),
            'NOT_EVENT_CREATOR': t('Doar creatorul evenimentului poate invita prieteni.', 'Only the event creator can invite friends.'),
            'EVENT_EXPIRED': t('Evenimentul a expirat.', 'The event has expired.'),
            'REQUEST_ALREADY_HANDLED': t('Cererea a fost deja procesată.', 'This request was already handled.')
        };
        if (table[code]) return table[code];

        if (code.indexOf('FRIEND_LIMIT_REACHED') === 0) {
            return t('Limita de prieteni a fost atinsă (max ' + arg + ').', 'Friend limit reached (max ' + arg + ').');
        }
        if (code.indexOf('ADDRESSEE_FRIEND_LIMIT_REACHED') === 0) {
            return t('Celălalt utilizator are deja numărul maxim de prieteni (' + arg + ').', 'That user already has the maximum number of friends (' + arg + ').');
        }
        if (code.indexOf('DAILY_REQUEST_LIMIT_REACHED') === 0) {
            return t('Ai trimis deja ' + arg + ' cereri astăzi. Încearcă mâine.', 'You already sent ' + arg + ' requests today. Try again tomorrow.');
        }
        if (code.indexOf('GROUP_TOO_LARGE') === 0) {
            return t('Grupul poate avea maximum ' + arg + ' membri.', 'A group can have at most ' + arg + ' members.');
        }
        if (code.indexOf('GROUP_LIMIT_REACHED') === 0) {
            return t('Ai deja ' + arg + ' grupuri active.', 'You already have ' + arg + ' active groups.');
        }
        if (code.indexOf('MESSAGE_TOO_LONG') === 0) {
            return t('Mesajul depășește ' + arg + ' caractere.', 'The message exceeds ' + arg + ' characters.');
        }
        if (code.indexOf('ATTACHMENT_TOO_LARGE') === 0) {
            return t('Atașamentul depășește ' + fmtBytes(arg) + '.', 'The attachment exceeds ' + fmtBytes(arg) + '.');
        }
        if (code.indexOf('RATE_LIMIT_MINUTE') === 0) {
            return t('Prea multe mesaje într-un minut (max ' + arg + '). Așteaptă puțin.', 'Too many messages in a minute (max ' + arg + '). Please wait.');
        }
        if (code.indexOf('RATE_LIMIT_DAY') === 0) {
            return t('Ai atins limita zilnică de mesaje (' + arg + ').', 'You reached the daily message limit (' + arg + ').');
        }
        if (code.indexOf('CONVERSATION_STORAGE_FULL') === 0) {
            return t('Conversația a atins limita de stocare (' + fmtBytes(arg) + ').', 'This conversation reached its storage limit (' + fmtBytes(arg) + ').');
        }
        if (code.indexOf('USER_STORAGE_FULL') === 0) {
            return t('Ai atins limita de stocare a chat-urilor (' + fmtBytes(arg) + ').', 'You reached your chat storage limit (' + fmtBytes(arg) + ').');
        }
        if (code.indexOf('EVENT_CREATION_LIMIT') === 0) {
            return t('Ai deja numărul maxim de evenimente active (' + arg + '). Șterge unul înainte să creezi altul.',
                'You already have the maximum number of active events (' + arg + '). Delete one before creating another.');
        }
        if (code.indexOf('EVENT_ATTENDANCE_LIMIT') === 0) {
            return t('Ai atins numărul maxim de evenimente la care participi (' + arg + ').',
                'You reached the maximum number of events you can attend (' + arg + ').');
        }
        if (code.indexOf('EVENT_DEADLINE_TOO_FAR') === 0) {
            return t('Un eveniment poate fi programat cel mult ' + arg + ' zile în viitor.',
                'An event can be scheduled at most ' + arg + ' days in the future.');
        }
        if (code === 'NO_CLIENT') {
            return t('Conexiunea la server nu este disponibilă.', 'The server connection is not available.');
        }
        return raw || t('A apărut o eroare.', 'Something went wrong.');
    }

    /* ── Loading limits / profile / lists ──────────────────────────────── */

    async function loadLimits(force) {
        if (state.limitsLoaded && !force) return state.limits;
        var res = await rpc('get_app_limits', {});
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (res.error || !row) {
            state.limits = Object.assign({}, DEFAULT_LIMITS);
            state.limitsLoaded = false;
            return state.limits;
        }
        state.limits = Object.assign({}, DEFAULT_LIMITS, row);
        state.limitsLoaded = true;
        return state.limits;
    }

    function limits() { return state.limits; }

    async function ensureProfile(force) {
        var user = currentUser();
        if (!user || !user.id) return null;
        if (state.profileReady && !force) return user;

        var county = null;
        var city = null;
        try {
            var LL = window.DetectLabLastLocation;
            var mine = LL && LL.getMyLastLocation ? LL.getMyLastLocation() : null;
            if (mine) { county = mine.county || null; city = mine.city || null; }
        } catch (e) {}

        var name = user.name || (user.email ? user.email.split('@')[0] : '');
        var res = await rpc('upsert_my_social_profile', {
            _display_name: name,
            _email: user.email || '',
            _county: county,
            _city: city
        });
        state.profileReady = !res.error;
        if (county) {
            writeCache({ myCounty: county, myCity: city });
        }
        return res.data;
    }

    async function loadFriends() {
        var res = await rpc('list_my_friends', {});
        if (res.error || !Array.isArray(res.data)) {
            var cache = readCache();
            state.friends = (cache && cache.friends) || [];
            return state.friends;
        }
        state.friends = res.data.map(function (f) {
            return {
                user_id: f.user_id,
                display_name: f.display_name || 'Detectorist',
                email: f.email || '',
                county: f.county || '',
                city: f.city || '',
                friends_since: f.friends_since,
                conversation_id: f.conversation_id || null
            };
        });
        writeCache({ friends: state.friends });
        refreshDetectorPopups();
        return state.friends;
    }

    async function loadRequests() {
        var incoming = await rpc('list_my_friend_requests', { _direction: 'incoming' });
        var outgoing = await rpc('list_my_friend_requests', { _direction: 'outgoing' });
        if (!incoming.error && Array.isArray(incoming.data)) {
            state.incomingRequests = incoming.data.filter(function (r) { return r.status === 'pending'; });
        }
        if (!outgoing.error && Array.isArray(outgoing.data)) {
            state.outgoingRequests = outgoing.data.filter(function (r) { return r.status === 'pending'; });
        }
        if (!incoming.error || !outgoing.error) {
            writeCache({ incomingRequests: state.incomingRequests, outgoingRequests: state.outgoingRequests });
        } else {
            var cache = readCache();
            if (cache) {
                state.incomingRequests = cache.incomingRequests || [];
                state.outgoingRequests = cache.outgoingRequests || [];
            }
        }
        state.counters.pending_requests = state.incomingRequests.length;
        refreshDetectorPopups();
        return { incoming: state.incomingRequests, outgoing: state.outgoingRequests };
    }

    async function loadConversations() {
        var res = await rpc('list_my_conversations', {});
        if (res.error || !Array.isArray(res.data)) {
            var cache = readCache();
            state.conversations = (cache && cache.conversations) || [];
            return state.conversations;
        }
        state.conversations = res.data;
        writeCache({ conversations: state.conversations });
        var unread = 0;
        res.data.forEach(function (c) { unread += Number(c.unread_count) || 0; });
        state.counters.unread_messages = unread;
        state.counters.conversations = res.data.length;
        return state.conversations;
    }

    async function loadCounties() {
        var res = await rpc('list_social_counties', {});
        if (!res.error && Array.isArray(res.data)) {
            state.counties = res.data;
            writeCache({ counties: res.data });
        } else {
            var cache = readCache();
            state.counties = (cache && cache.counties) || [];
        }
        // Always offer the counties of the people we already know, even when
        // list_social_counties() is not installed yet.
        var seen = {};
        state.counties.forEach(function (c) { seen[normaliseCounty(c.county)] = true; });
        state.friends.forEach(function (f) {
            var n = normaliseCounty(f.county);
            if (n && !seen[n]) { seen[n] = true; state.counties.push({ county: titleCase(n), members: 1 }); }
        });
        return state.counties;
    }

    async function loadCounters() {
        var res = await rpc('get_social_counters', {});
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!res.error && row) {
            state.counters = {
                pending_requests: Number(row.pending_requests) || 0,
                unread_messages: Number(row.unread_messages) || 0,
                friends: Number(row.friends) || 0,
                conversations: Number(row.conversations) || 0
            };
            writeCache({ counters: state.counters });
        } else {
            var cache = readCache();
            if (cache && cache.counters) state.counters = cache.counters;
        }
        updateBadges();
        return state.counters;
    }

    async function loadEventQuota(force) {
        if (state.quota && !force) return state.quota;
        var res = await rpc('get_my_event_quota', {});
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!res.error && row) {
            state.quota = {
                created: Number(row.events_created_active) || 0,
                createdMax: Number(row.events_created_max) || limits().max_events_created_active,
                attending: Number(row.events_attending_active) || 0,
                attendingMax: Number(row.events_attending_max) || limits().max_events_attending_active,
                deadlineDays: Number(row.max_deadline_days) || limits().max_event_deadline_days
            };
        } else {
            state.quota = null;
        }
        return state.quota;
    }

    /* ── Search ────────────────────────────────────────────────────────── */

    async function runSearch() {
        var user = currentUser();
        if (!user) return [];
        state.search.loading = true;
        renderSearchResults();

        var res = await rpc('search_social_users', {
            _query: state.search.query || '',
            _county: state.search.county || null,
            _limit_n: 25
        });

        state.search.loading = false;
        state.search.searched = true;

        if (res.error || !Array.isArray(res.data)) {
            state.search.results = [];
            renderSearchResults();
            return [];
        }
        state.search.results = res.data;
        renderSearchResults();
        return res.data;
    }

    /* ── Relationship to another account ───────────────────────────────── */

    // ONE place that answers "what can I do with this account?" so the Friends
    // panel, the search results and the detectorist map pins never disagree.
    //   anonymous        – nobody is signed in
    //   self             – that pin is another device of my own account
    //   friend           – already friends            → send a message
    //   request_sent     – my request is pending      → cancel it
    //   request_received – their request is pending   → accept it
    //   none             – stranger                   → send a friend request
    function relationFor(userId) {
        var user = currentUser();
        if (!user || !user.id) return { state: 'anonymous' };
        if (!userId) return { state: 'unknown' };
        if (String(userId) === String(user.id)) return { state: 'self' };

        var friend = state.friends.filter(function (f) { return String(f.user_id) === String(userId); })[0];
        if (friend) return { state: 'friend', friend: friend };

        var outgoing = state.outgoingRequests.filter(function (r) { return String(r.other_id) === String(userId); })[0];
        if (outgoing) return { state: 'request_sent', requestId: outgoing.id };

        var incoming = state.incomingRequests.filter(function (r) { return String(r.other_id) === String(userId); })[0];
        if (incoming) return { state: 'request_received', requestId: incoming.id };

        return { state: 'none' };
    }

    function requestIdFor(userId, direction) {
        var list = direction === 'outgoing' ? state.outgoingRequests : state.incomingRequests;
        var row = (list || []).filter(function (r) { return String(r.other_id) === String(userId); })[0];
        return row ? row.id : null;
    }

    /* ── Actions ───────────────────────────────────────────────────────── */

    async function sendFriendRequest(userId, message) {
        await ensureProfile();
        var res = await rpc('send_friend_request', { _addressee_id: userId, _message: message || '' });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await Promise.all([loadRequests(), loadCounters()]);
        return { ok: true, data: res.data };
    }

    async function cancelFriendRequest(requestId) {
        var res = await rpc('cancel_friend_request', { _request_id: requestId });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await Promise.all([loadRequests(), loadCounters()]);
        return { ok: true };
    }

    async function respondFriendRequest(requestId, accept) {
        var res = await rpc('respond_friend_request', { _request_id: requestId, _accept: !!accept });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await Promise.all([loadFriends(), loadRequests(), loadCounters(), loadConversations()]);
        return { ok: true };
    }

    async function removeFriend(userId) {
        var ok = window.confirm(t(
            'Sigur vrei să ștergi acest prieten? Chat-ul privat cu el se va închide.',
            'Remove this friend? Your private chat with them will be closed.'));
        if (!ok) return { ok: false, cancelled: true };
        var res = await rpc('remove_friend', { _friend_id: userId });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await Promise.all([loadFriends(), loadConversations(), loadCounters()]);
        return { ok: true };
    }

    /* ══════════════════════════════════════════════════════════════════════
       MAP POPUP ACTIONS — live (orange) and offline (black/white) pins
    ══════════════════════════════════════════════════════════════════════ */

    // Both detectorist pins on the map carry an EMPTY .detector-social-actions
    // slot (js/map-app.js → detectorSocialSlotHtml()). The slot is filled here,
    // every time the popup opens, with the single action that matches the
    // relationship: "Adaugă prietenie" for a stranger, "Acceptă" when they
    // already asked us, "Cerere trimisă / Anulează" while ours is pending and
    // "Trimite mesaj" for an existing friend. Nothing is rendered when nobody
    // is signed in or when the pin is another device of our own account.

    var MAP_STATE_TTL_MS = 15000;
    var mapStateLoadedAt = 0;
    var mapStatePromise = null;

    function detectorActionsHtml(userId, opts) {
        opts = opts || {};
        var rel = opts.relation || relationFor(userId);
        var uid = escapeHtml(userId);
        var uname = escapeHtml(opts.name || '');

        function btn(action, cls, label) {
            return '<button type="button" class="detector-social-btn' + (cls ? ' ' + cls : '') + '"' +
                ' data-social-action="' + action + '"' +
                ' data-user-id="' + uid + '"' +
                ' data-user-name="' + uname + '">' + escapeHtml(label) + '</button>';
        }

        if (rel.state === 'friend') {
            return btn('message', 'chat', '💬 ' + t('Trimite mesaj', 'Send message'));
        }
        if (rel.state === 'request_sent') {
            return '<span class="detector-social-note">⏳ ' +
                escapeHtml(t('Cerere de prietenie trimisă', 'Friend request sent')) + '</span>' +
                btn('cancel', 'ghost', t('Anulează', 'Cancel'));
        }
        if (rel.state === 'request_received') {
            return btn('accept', 'ok', '✓ ' + t('Acceptă cererea', 'Accept request'));
        }
        if (rel.state === 'none') {
            return btn('add', '', '＋ ' + t('Adaugă prietenie', 'Add friend'));
        }
        if (rel.state === 'self') {
            return '<span class="detector-social-note">👤 ' +
                escapeHtml(t('Un alt dispozitiv al contului tău', 'Another device of your account')) + '</span>';
        }
        return '';
    }

    function renderDetectorActions(slot) {
        if (!slot || typeof slot.setAttribute !== 'function') return false;
        // Never repaint a slot whose action is still in flight.
        if (slot.getAttribute('data-social-busy') === '1') return false;

        var userId = slot.getAttribute('data-user-id');
        var name = slot.getAttribute('data-user-name') || '';
        var rel = relationFor(userId);
        slot.setAttribute('data-social-state', rel.state);

        if (rel.state === 'anonymous' || rel.state === 'unknown' || !userId) {
            slot.innerHTML = '';
            return false;
        }

        slot.innerHTML =
            '<div class="detector-social-row">' + detectorActionsHtml(userId, { relation: rel, name: name }) + '</div>' +
            '<div class="detector-social-msg" data-social-msg></div>';
        return true;
    }

    function detectorSlots(root) {
        var scope = (root && typeof root.querySelectorAll === 'function') ? root : null;
        if (!scope && typeof document !== 'undefined' && document.querySelectorAll) scope = document;
        if (!scope) return [];
        try { return Array.prototype.slice.call(scope.querySelectorAll('.detector-social-actions')); }
        catch (e) { return []; }
    }

    function slotStillInDocument(slot) {
        try {
            if (!slot || !document.body || typeof document.body.contains !== 'function') return true;
            return document.body.contains(slot);
        } catch (e) { return true; }
    }

    // Repaint every open detectorist popup (after a request was sent, accepted
    // or cancelled, the button of that person changes immediately).
    function refreshDetectorPopups() {
        detectorSlots(document).forEach(function (slot) { renderDetectorActions(slot); });
    }

    // Friend list + requests are enough to answer "what can I do with them?";
    // cached in memory for MAP_STATE_TTL_MS so opening several pins in a row
    // does not hit the network every time.
    function ensureDetectorSocialState(force) {
        var user = currentUser();
        if (!user || !user.id) return Promise.resolve(false);
        if (!force && mapStateLoadedAt && Date.now() - mapStateLoadedAt < MAP_STATE_TTL_MS) {
            return Promise.resolve(true);
        }
        if (mapStatePromise) return mapStatePromise;
        mapStatePromise = Promise.all([loadFriends(), loadRequests()]).then(function () {
            mapStateLoadedAt = Date.now();
            mapStatePromise = null;
            return true;
        }, function () {
            mapStatePromise = null;
            return false;
        });
        return mapStatePromise;
    }

    // Called by js/map-app.js on the map's 'popupopen' event with the popup
    // element. Paints the slot from the mirrored state right away (instant, no
    // flash of a wrong button) and repaints once the fresh lists arrive.
    function decorateDetectorPopup(root) {
        var slots = detectorSlots(root);
        if (!slots.length) return 0;
        slots.forEach(function (slot) { renderDetectorActions(slot); });
        ensureDetectorSocialState().then(function () {
            slots.forEach(function (slot) {
                if (!slotStillInDocument(slot)) return;
                renderDetectorActions(slot);
            });
        });
        return slots.length;
    }

    function setDetectorMessage(slot, text, kind) {
        if (!slot || typeof slot.querySelector !== 'function') return;
        var msg = slot.querySelector('[data-social-msg]');
        if (!msg) return;
        msg.className = 'detector-social-msg' + (kind ? ' ' + kind : '');
        msg.textContent = text || '';
        if (msg._socialTimer) { clearTimeout(msg._socialTimer); msg._socialTimer = null; }
        if (text) {
            msg._socialTimer = setTimeout(function () {
                msg.textContent = '';
                msg.className = 'detector-social-msg';
                msg._socialTimer = null;
            }, 6000);
        }
    }

    function closeDetectorPopup() {
        try {
            var m = window._dlMap || window.map;
            if (m && typeof m.closePopup === 'function') m.closePopup();
        } catch (e) {}
    }

    // One delegated listener for every open popup: Leaflet rebuilds the popup
    // DOM on each open and the buttons live inside it, so per-button listeners
    // would be lost (and would stack up). Capture phase, because Leaflet stops
    // pointer events on its popups.
    async function onDetectorSocialAction(e) {
        var target = e && e.target;
        var btn = target && target.closest ? target.closest('[data-social-action]') : null;
        if (!btn) return;

        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        try { if (window.L && L.DomEvent && L.DomEvent.stop) L.DomEvent.stop(e); } catch (_) {}

        var action = btn.getAttribute('data-social-action');
        var slot = btn.closest ? btn.closest('.detector-social-actions') : null;
        var userId = btn.getAttribute('data-user-id') || (slot && slot.getAttribute('data-user-id')) || '';
        if (!userId) return;

        var user = currentUser();
        if (!user || !user.id) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }

        if (action === 'message') {
            closeDetectorPopup();
            await openChatWithUser(userId);
            return;
        }

        if (btn.disabled) return;
        btn.disabled = true;
        if (slot && typeof slot.setAttribute === 'function') slot.setAttribute('data-social-busy', '1');

        var res = { ok: false, message: '' };
        var okText = '';
        try {
            if (action === 'add') {
                res = await sendFriendRequest(userId, '');
                okText = t('Cerere de prietenie trimisă.', 'Friend request sent.');
            } else if (action === 'cancel') {
                var requestId = requestIdFor(userId, 'outgoing');
                res = requestId
                    ? await cancelFriendRequest(requestId)
                    : { ok: false, message: t('Cererea nu mai există.', 'That request no longer exists.') };
                okText = t('Cerere anulată.', 'Request cancelled.');
            } else if (action === 'accept') {
                var incomingId = requestIdFor(userId, 'incoming');
                res = incomingId
                    ? await respondFriendRequest(incomingId, true)
                    : { ok: false, message: t('Cererea nu mai există.', 'That request no longer exists.') };
                okText = t('Sunteți prieteni acum.', 'You are friends now.');
            }
        } catch (err) {
            res = { ok: false, message: friendlyError(err) };
        }

        if (slot && typeof slot.setAttribute === 'function') slot.setAttribute('data-social-busy', '0');
        // Success: the lists were reloaded by the action itself, so the slot now
        // shows the next state ("Cerere trimisă" / "Trimite mesaj").
        refreshDetectorPopups();
        if (btn.disabled) btn.disabled = false;
        setDetectorMessage(slot, res.ok ? okText : (res.message || ''), res.ok ? 'ok' : 'error');
    }

    async function openDirectConversation(userId) {
        var res = await rpc('start_direct_conversation', { _other_user: userId });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await loadConversations();
        return { ok: true, conversation: res.data };
    }

    async function createGroupConversation(title, memberIds) {
        await ensureProfile();
        var res = await rpc('create_group_conversation', { _title: title, _member_ids: memberIds || [] });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await loadConversations();
        await loadCounters();
        return { ok: true, conversation: res.data };
    }

    async function loadConversationMessages(convId) {
        var res = await selectFrom('conversation_messages', function (q) {
            return q.select('id,conversation_id,sender_id,sender_name,body,media_url,media_type,media_bytes,created_at')
                .eq('conversation_id', convId)
                .order('created_at', { ascending: true })
                .limit(400);
        });
        if (res.error || !Array.isArray(res.data)) {
            return cachedMessages(convId);
        }
        state.chatMessages = res.data;
        cacheMessages(convId, res.data);
        return res.data;
    }

    async function loadConversationMembers(convId) {
        var res = await rpc('get_conversation_members', { _conversation_id: convId });
        if (!res.error && Array.isArray(res.data)) {
            state.chatMembers = res.data;
            return res.data;
        }
        state.chatMembers = [];
        return [];
    }

    async function markConversationRead(convId) {
        if (!convId) return;
        await rpc('mark_conversation_read', { _conversation_id: convId });
        state.conversations = state.conversations.map(function (c) {
            return c.id === convId ? Object.assign({}, c, { unread_count: 0 }) : c;
        });
        writeCache({ conversations: state.conversations });
        updateBadges();
    }

    function clientRateLimitHit() {
        var now = Date.now();
        state.sendTimestamps = state.sendTimestamps.filter(function (ts) { return now - ts < 60000; });
        return state.sendTimestamps.length >= (limits().max_messages_per_minute || 60);
    }

    async function sendMessage(convId, body, media) {
        var user = currentUser();
        if (!user) return { ok: false, message: t('Trebuie să fii autentificat.', 'You must be signed in.') };

        var text = String(body == null ? '' : body);
        var maxLen = limits().max_message_length || 2000;
        if (text.length > maxLen) {
            return { ok: false, message: t('Mesajul depășește ' + maxLen + ' caractere.', 'The message exceeds ' + maxLen + ' characters.') };
        }
        if (!text.trim() && !(media && media.url)) {
            return { ok: false, message: t('Scrie un mesaj sau atașează o imagine.', 'Write a message or attach an image.') };
        }
        if (clientRateLimitHit()) {
            return { ok: false, message: t('Prea multe mesaje într-un minut. Așteaptă puțin.', 'Too many messages in a minute. Please wait a little.') };
        }

        var res = await rpc('send_conversation_message', {
            _conversation_id: convId,
            _body: text,
            _media_url: (media && media.url) || null,
            _media_type: (media && media.type) || 'none',
            _media_bytes: (media && media.bytes) || 0
        });

        if (res.error) return { ok: false, message: friendlyError(res.error) };

        state.sendTimestamps.push(Date.now());
        if (res.data) {
            state.chatMessages.push(res.data);
            cacheMessages(convId, state.chatMessages);
        }
        await markConversationRead(convId);
        return { ok: true, message: res.data };
    }

    async function renameConversation(convId, title) {
        var res = await rpc('rename_conversation', { _conversation_id: convId, _title: title });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await loadConversations();
        return { ok: true };
    }

    async function addConversationMembers(convId, memberIds) {
        var res = await rpc('add_conversation_members', { _conversation_id: convId, _member_ids: memberIds || [] });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await Promise.all([loadConversationMembers(convId), loadConversations()]);
        return { ok: true, added: res.data };
    }

    async function removeConversationMember(convId, userId) {
        var res = await rpc('remove_conversation_member', { _conversation_id: convId, _user_id: userId });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await loadConversationMembers(convId);
        return { ok: true };
    }

    async function leaveConversation(convId) {
        var res = await rpc('leave_conversation', { _conversation_id: convId });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await Promise.all([loadConversations(), loadCounters()]);
        return { ok: true };
    }

    async function deleteConversation(convId) {
        var res = await rpc('delete_conversation', { _conversation_id: convId });
        if (res.error) return { ok: false, message: friendlyError(res.error) };
        await Promise.all([loadConversations(), loadCounters()]);
        return { ok: true };
    }

    /* ── Event integration ─────────────────────────────────────────────── */

    async function inviteFriendsToEvent(eventId, friendIds) {
        if (!eventId || !friendIds || !friendIds.length) return { ok: true, results: [] };
        var res = await rpc('invite_friends_to_event', { _event_id: eventId, _friend_ids: friendIds });
        if (res.error) return { ok: false, message: friendlyError(res.error), results: [] };
        var rows = Array.isArray(res.data) ? res.data : [];
        return { ok: true, results: rows };
    }

    function summariseInviteResults(rows) {
        var counts = { invited: 0, already_pending: 0, already_attending: 0, not_friend: 0, event_full: 0, invite_limit: 0 };
        (rows || []).forEach(function (r) {
            var key = String(r && r.result || '');
            if (counts[key] == null) counts[key] = 0;
            counts[key]++;
        });
        return counts;
    }

    function inviteSummaryText(counts) {
        var bits = [];
        if (counts.invited) bits.push(t(counts.invited + ' prieteni invitați', counts.invited + ' friends invited'));
        if (counts.already_pending) bits.push(t(counts.already_pending + ' aveau deja cerere', counts.already_pending + ' already had a request'));
        if (counts.already_attending) bits.push(t(counts.already_attending + ' participau deja', counts.already_attending + ' already attending'));
        if (counts.not_friend) bits.push(t(counts.not_friend + ' nu mai sunt prieteni', counts.not_friend + ' are no longer friends'));
        if (counts.event_full) bits.push(t('evenimentul este plin', 'the event is full'));
        if (counts.invite_limit) bits.push(t('limita de invitații atinsă', 'invite limit reached'));
        return bits.join(' • ');
    }

    /* ── Media: downscale before it becomes a data URL ─────────────────── */

    function readFileAsDataURL(file) {
        return new Promise(function (resolve, reject) {
            try {
                var reader = new FileReader();
                reader.onload = function (e) { resolve(e.target.result); };
                reader.onerror = function () { reject(new Error('read-error')); };
                reader.readAsDataURL(file);
            } catch (e) { reject(e); }
        });
    }

    function loadImage(dataUrl) {
        return new Promise(function (resolve, reject) {
            try {
                var img = new Image();
                img.onload = function () { resolve(img); };
                img.onerror = function () { reject(new Error('image-error')); };
                img.src = dataUrl;
            } catch (e) { reject(e); }
        });
    }

    // A 12 MP phone photo would land in the DB as a ~8 MB base64 string, so
    // images are resized/re-encoded in the browser before they are sent. The
    // 5 MB attachment cap then almost never trips.
    async function prepareImage(file) {
        var raw = await readFileAsDataURL(file);
        try {
            var img = await loadImage(raw);
            var scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width || 1, img.height || 1));
            var w = Math.max(1, Math.round((img.width || 1) * scale));
            var h = Math.max(1, Math.round((img.height || 1) * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var out = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
            if (out && out.length < raw.length) raw = out;
        } catch (e) {
            // Canvas unavailable (old PWA webview): send the original file.
        }
        return { url: raw, type: 'image', bytes: raw ? raw.length : 0 };
    }

    async function prepareAttachment(file) {
        if (!file) return null;
        var maxBytes = limits().max_attachment_bytes || MAX_ATTACHMENT_BYTES;
        // Media travels as a base64 data URL, which is ~4/3 of the file size,
        // and THAT is what the database measures against the cap.
        var encoded = Math.ceil((Number(file.size) || 0) * 4 / 3);
        if (encoded > maxBytes) {
            return { error: t('Fișierul are ' + fmtBytes(file.size) + ' (≈' + fmtBytes(encoded) +
                    ' după codare), iar limita este ' + fmtBytes(maxBytes) + '.',
                'The file is ' + fmtBytes(file.size) + ' (≈' + fmtBytes(encoded) +
                    ' once encoded) and the limit is ' + fmtBytes(maxBytes) + '.') };
        }
        if (String(file.type || '').indexOf('image/') === 0) {
            var image = await prepareImage(file);
            if (image && image.bytes > maxBytes) {
                return { error: t('Imaginea rămâne prea mare după comprimare (limita ' + fmtBytes(maxBytes) + ').',
                    'The image is still too large after compression (limit ' + fmtBytes(maxBytes) + ').') };
            }
            return image;
        }
        if (String(file.type || '').indexOf('video/') === 0) {
            var url = await readFileAsDataURL(file);
            var bytes = url ? url.length : (Number(file.size) || 0);
            if (bytes > maxBytes) {
                return { error: t('Videoclipul codat depășește limita de ' + fmtBytes(maxBytes) + '.',
                    'The encoded video exceeds the ' + fmtBytes(maxBytes) + ' limit.') };
            }
            return { url: url, type: 'video', bytes: bytes };
        }
        return { error: t('Se acceptă doar imagini și video.', 'Only images and videos are accepted.') };
    }

    /* ── Realtime + polling for the open thread ────────────────────────── */

    function stopChatLiveUpdates() {
        if (state.chatPollTimer) { clearInterval(state.chatPollTimer); state.chatPollTimer = null; }
        if (state.realtimeChannel) {
            try {
                var client = sb();
                if (client && typeof client.removeChannel === 'function') client.removeChannel(state.realtimeChannel);
            } catch (e) {}
            state.realtimeChannel = null;
            state.realtimeConvId = null;
        }
    }

    function startChatLiveUpdates(convId) {
        stopChatLiveUpdates();
        if (!convId) return;
        var client = sb();
        if (client && typeof client.channel === 'function') {
            try {
                var channel = client.channel('dl-social-' + convId);
                channel.on('postgres_changes', {
                    event: 'INSERT', schema: 'public', table: 'conversation_messages',
                    filter: 'conversation_id=eq.' + convId
                }, function (payload) {
                    var row = payload && payload.new;
                    if (!row) return;
                    if (!state.chatMessages.some(function (m) { return m.id === row.id; })) {
                        state.chatMessages.push(row);
                        state.chatMessages.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
                        cacheMessages(convId, state.chatMessages);
                        renderChatMessages();
                        markConversationRead(convId);
                    }
                });
                channel.subscribe(function (status) {
                    if (status === 'SUBSCRIBED' && state.chat && state.chat.id === convId) {
                        refreshChatMessages(convId);
                    }
                });
                state.realtimeChannel = channel;
                state.realtimeConvId = convId;
            } catch (e) {
                console.warn('[Friends] realtime subscribe failed', e);
            }
        }
        // Mobile browsers suspend websockets in the background: a light poll
        // keeps the thread fresh either way.
        state.chatPollTimer = setInterval(function () {
            if (state.chat && state.chat.id === convId) refreshChatMessages(convId);
        }, CHAT_POLL_MS);
    }

    async function refreshChatMessages(convId) {
        if (!convId) return;
        var msgs = await loadConversationMessages(convId);
        if (state.chat && state.chat.id === convId) {
            state.chatMessages = msgs;
            renderChatMessages();
        }
        return msgs;
    }

    /* ══════════════════════════════════════════════════════════════════════
       STYLES
    ══════════════════════════════════════════════════════════════════════ */

    (function injectStyles() {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.getElementById('detectlab-social-style')) return;
        var style = document.createElement('style');
        style.id = 'detectlab-social-style';
        style.textContent = [
            '.event-notif-badge{position:absolute;top:-6px;right:-6px;background:#C42B2B;color:#fff;font-size:0.62rem;font-weight:800;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid rgba(10,20,42,0.95);z-index:5;line-height:1;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.45);}',
            '.event-notif-badge.hidden{display:none !important;}',
            '#friendsManagerPanel{position:fixed;inset:0;z-index:3500;background:rgba(4,10,22,0.94);backdrop-filter:blur(14px);display:flex;flex-direction:column;padding:16px;overflow-y:auto;color:#F5F0EB;font-family:"Outfit",sans-serif;}',
            'html.is-pwa #friendsManagerPanel,body.is-pwa #friendsManagerPanel{padding-top:calc(16px + max(32px, env(safe-area-inset-top, 0px)));background:#060D1D;}',
            '#friendsManagerPanel .fr-wrap{max-width:640px;width:100%;margin:0 auto;display:flex;flex-direction:column;gap:14px;padding-bottom:32px;}',
            '.fr-header-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
            '.fr-title{font-family:"Cinzel",serif;font-size:1.3rem;color:var(--sky,#B8D8F0);margin:0;}',
            '.fr-back-btn{background:rgba(255,255,255,0.07);border:1px solid rgba(184,216,240,0.2);border-radius:8px;color:#F5F0EB;padding:7px 12px;font-size:0.78rem;cursor:pointer;}',
            '.fr-tabs{display:flex;gap:8px;flex-wrap:wrap;}',
            '.fr-tab{flex:1;min-width:110px;background:rgba(255,255,255,0.05);border:1px solid rgba(184,216,240,0.18);border-radius:8px;color:rgba(245,240,235,0.75);padding:9px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;position:relative;}',
            '.fr-tab.active{background:rgba(107,63,160,0.35);border-color:rgba(196,160,240,0.55);color:#fff;}',
            '.fr-tab .fr-tab-count{opacity:0.75;font-weight:500;font-size:0.72rem;margin-left:4px;}',
            '.fr-card{background:rgba(10,20,42,0.72);border:1px solid rgba(184,216,240,0.16);border-radius:10px;padding:12px;}',
            '.fr-search-row{display:flex;gap:8px;flex-wrap:wrap;}',
            '.fr-input,.fr-select{background:rgba(255,255,255,0.06);border:1px solid rgba(184,216,240,0.25);border-radius:8px;color:#F5F0EB;padding:9px 10px;font-size:0.82rem;font-family:"Outfit",sans-serif;box-sizing:border-box;}',
            '.fr-input{flex:1;min-width:160px;}',
            '.fr-select{min-width:150px;appearance:auto;-webkit-appearance:menulist;}',
            '.fr-btn{background:#6B3FA0;border:none;border-radius:8px;color:#fff;font-weight:600;padding:9px 14px;font-size:0.8rem;cursor:pointer;}',
            '.fr-btn.secondary{background:rgba(255,255,255,0.08);border:1px solid rgba(184,216,240,0.22);color:#F5F0EB;}',
            '.fr-btn.danger{background:#C42B2B;}',
            '.fr-btn.ok{background:#2E9E4F;}',
            '.fr-btn.chat{background:#0D2B5E;border:1px solid rgba(184,216,240,0.3);color:var(--sky,#B8D8F0);}',
            '.fr-btn:disabled{opacity:0.5;cursor:default;}',
            '.fr-person{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(184,216,240,0.12);}',
            '.fr-person + .fr-person{margin-top:8px;}',
            '.fr-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.8rem;color:#fff;flex:0 0 auto;}',
            '.fr-person-main{flex:1;min-width:0;}',
            '.fr-person-name{font-weight:700;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.fr-person-meta{font-size:0.72rem;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.fr-person-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}',
            '.fr-section-label{font-family:"Cinzel",serif;font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;color:rgba(184,216,240,0.5);margin:4px 0;}',
            '.fr-empty{font-size:0.82rem;opacity:0.65;padding:14px;text-align:center;border:1px dashed rgba(184,216,240,0.2);border-radius:10px;}',
            '.fr-notice{font-size:0.76rem;line-height:1.5;padding:10px;border-radius:8px;background:rgba(230,168,23,0.12);border:1px solid rgba(230,168,23,0.4);color:#f0d9a0;}',
            '.fr-limits{font-size:0.7rem;opacity:0.6;line-height:1.5;}',
            '.fr-chat-panel{position:fixed;inset:0;z-index:3600;background:rgba(4,10,22,0.97);display:flex;flex-direction:column;color:#F5F0EB;font-family:"Outfit",sans-serif;}',
            '.fr-chat-header{background:rgba(6,14,30,0.96);border-bottom:1px solid rgba(184,216,240,0.15);padding:10px 14px;display:flex;align-items:center;gap:10px;flex:0 0 auto;}',
            '.fr-chat-header-main{flex:1;min-width:0;}',
            '.fr-chat-title{font-weight:700;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.fr-chat-sub{font-size:0.7rem;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.fr-chat-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch;}',
            '.fr-msg{max-width:78%;padding:8px 11px;border-radius:12px;font-size:0.84rem;line-height:1.45;word-break:break-word;}',
            '.fr-msg.mine{align-self:flex-end;background:#6B3FA0;border-bottom-right-radius:4px;}',
            '.fr-msg.theirs{align-self:flex-start;background:rgba(255,255,255,0.08);border:1px solid rgba(184,216,240,0.14);border-bottom-left-radius:4px;}',
            '.fr-msg-sender{font-size:0.68rem;font-weight:700;opacity:0.8;margin-bottom:2px;}',
            '.fr-msg-time{font-size:0.62rem;opacity:0.6;margin-top:3px;text-align:right;}',
            '.fr-msg img,.fr-msg video{max-width:100%;max-height:260px;border-radius:8px;display:block;margin-top:4px;}',
            '.fr-msg-media-missing{font-size:0.7rem;opacity:0.6;font-style:italic;}',
            '.fr-day-sep{align-self:center;font-size:0.66rem;opacity:0.55;margin:6px 0;letter-spacing:0.08em;text-transform:uppercase;}',
            '.fr-chat-composer{background:rgba(6,14,30,0.96);border-top:1px solid rgba(184,216,240,0.15);padding:10px;display:flex;gap:8px;align-items:flex-end;flex:0 0 auto;}',
            '.fr-chat-composer textarea{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(184,216,240,0.25);border-radius:8px;padding:9px 11px;color:#F5F0EB;font-size:0.85rem;font-family:"Outfit",sans-serif;resize:none;min-height:40px;max-height:120px;box-sizing:border-box;}',
            '.fr-chat-actions{display:flex;gap:8px;padding:8px 14px 0;flex-wrap:wrap;}',
            '.fr-attach{cursor:pointer;background:rgba(184,216,240,0.1);border:1px solid rgba(184,216,240,0.25);border-radius:8px;padding:9px 10px;display:flex;align-items:center;justify-content:center;}',
            '.fr-modal{position:fixed;inset:0;z-index:4200;background:rgba(4,10,22,0.86);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:16px;}',
            '.fr-modal-box{background:rgba(10,20,42,0.98);border:1px solid rgba(184,216,240,0.25);border-radius:12px;width:100%;max-width:460px;max-height:88vh;overflow-y:auto;padding:18px;color:#F5F0EB;font-family:"Outfit",sans-serif;box-shadow:0 10px 40px rgba(0,0,0,0.6);}',
            '.fr-modal-title{margin:0 0 12px;font-size:1.05rem;color:var(--sky,#B8D8F0);font-family:"Cinzel",serif;}',
            '.fr-picker{max-height:220px;overflow-y:auto;border:1px solid rgba(184,216,240,0.18);border-radius:8px;padding:8px;background:rgba(255,255,255,0.03);}',
            '.fr-picker-row{display:flex;align-items:center;gap:8px;padding:6px 4px;border-radius:6px;font-size:0.82rem;cursor:pointer;}',
            '.fr-picker-row:hover{background:rgba(184,216,240,0.08);}',
            '.fr-picker-row input{accent-color:#6B3FA0;}',
            '.fr-picker-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.fr-picker-meta{font-size:0.68rem;opacity:0.6;}',
            '.fr-error{font-size:0.76rem;color:#ff8a8a;margin:8px 0;min-height:1em;}',
            '.fr-ok{font-size:0.76rem;color:#7fd694;margin:8px 0;min-height:1em;}',
            '#userMenu button[onclick*="openFriends"],#pwaUserDropdown button[onclick*="openFriends"]{position:relative !important;}'
        ].join('\n');
        document.head.appendChild(style);
    })();

    /* ══════════════════════════════════════════════════════════════════════
       PANEL RENDERING
    ══════════════════════════════════════════════════════════════════════ */

    function closeMenus() {
        try {
            var menu = document.getElementById('userMenu');
            if (menu) menu.classList.add('hidden');
            document.querySelectorAll('#pwaBottomBar .pwa-dropdown').forEach(function (dd) { dd.classList.remove('open'); });
            document.querySelectorAll('#pwaBottomBar .pwa-bar-trigger').forEach(function (tr) { tr.classList.remove('active'); });
        } catch (e) {}
    }

    function limitsHtml() {
        var L = limits();
        return '<div class="fr-limits">' +
            '🛡 ' + escapeHtml(t('Limite active: ', 'Active limits: ')) +
            escapeHtml(t(
                L.max_friends + ' prieteni • ' + L.max_friend_requests_per_day + ' cereri/zi • mesaj ' + L.max_message_length + ' caractere • ' +
                L.max_messages_per_conversation + ' mesaje/chat • ' + L.max_messages_per_minute + '/min • retenție ' + L.message_retention_days + ' zile • atașament ' + fmtBytes(L.max_attachment_bytes),
                L.max_friends + ' friends • ' + L.max_friend_requests_per_day + ' requests/day • message ' + L.max_message_length + ' chars • ' +
                L.max_messages_per_conversation + ' messages/chat • ' + L.max_messages_per_minute + '/min • retention ' + L.message_retention_days + ' days • attachment ' + fmtBytes(L.max_attachment_bytes)
            )) + '</div>';
    }

    function personAvatarHtml(seed, name) {
        var hue = avatarHue(seed || name);
        return '<div class="fr-avatar" style="background:hsl(' + hue + ',42%,38%);">' + escapeHtml(initials(name)) + '</div>';
    }

    function personMeta(friend) {
        var bits = [];
        if (friend.county) bits.push('📍 ' + titleCase(normaliseCounty(friend.county)));
        if (friend.email) bits.push(maskEmail(friend.email));
        return bits.join(' • ');
    }

    function renderFriendsTab() {
        var el = document.getElementById('frTabFriends');
        if (!el) return;
        var L = limits();

        var friendsHtml = '';
        if (!state.friends.length) {
            friendsHtml = '<div class="fr-empty">' + escapeHtml(t(
                'Încă nu ai prieteni. Caută detectoriști după e-mail, nume sau ID și trimite o cerere.',
                'No friends yet. Search detectorists by e-mail, name or id and send a request.'
            )) + '</div>';
        } else {
            state.friends.forEach(function (f) {
                friendsHtml += '<div class="fr-person" data-friend="' + escapeHtml(f.user_id) + '">' +
                    personAvatarHtml(f.user_id, f.display_name) +
                    '<div class="fr-person-main"><div class="fr-person-name">' + escapeHtml(f.display_name) + '</div>' +
                    '<div class="fr-person-meta">' + escapeHtml(personMeta(f)) + '</div></div>' +
                    '<div class="fr-person-actions">' +
                    '<button type="button" class="fr-btn chat" data-action="chat" data-id="' + escapeHtml(f.user_id) + '">💬 ' + escapeHtml(t('Chat', 'Chat')) + '</button>' +
                    '<button type="button" class="fr-btn secondary" data-action="remove" data-id="' + escapeHtml(f.user_id) + '" title="' + escapeHtml(t('Șterge prietenul', 'Remove friend')) + '">✕</button>' +
                    '</div></div>';
            });
        }

        el.innerHTML =
            '<div class="fr-card">' +
                '<div class="fr-section-label">' + escapeHtml(t('Caută detectoriști', 'Search detectorists')) + '</div>' +
                '<div class="fr-search-row">' +
                    '<input type="text" class="fr-input" id="frSearchInput" autocomplete="off" placeholder="' +
                        escapeHtml(t('Caută după e-mail, nume sau ID…', 'Search by e-mail, name or id…')) + '" value="' + escapeHtml(state.search.query) + '">' +
                    '<select class="fr-select" id="frCountySelect">' +
                        '<option value="">' + escapeHtml(t('Toate județele', 'All counties')) + '</option>' +
                        countyOptionsHtml() +
                    '</select>' +
                    '<button type="button" class="fr-btn" id="frSearchBtn">🔍 ' + escapeHtml(t('Caută', 'Search')) + '</button>' +
                '</div>' +
                '<div id="frSearchResults"></div>' +
            '</div>' +
            '<div class="fr-card">' +
                '<div class="fr-header-row">' +
                    '<div class="fr-section-label" style="margin:0;">' + escapeHtml(t('Prietenii tăi', 'Your friends')) +
                        ' <span class="fr-tab-count">(' + state.friends.length + '/' + L.max_friends + ')</span></div>' +
                    '<button type="button" class="fr-btn secondary" id="frNewGroupBtn">👥 ' + escapeHtml(t('Grup nou', 'New group')) + '</button>' +
                '</div>' +
                '<div id="frFriendsList">' + friendsHtml + '</div>' +
            '</div>' +
            backendNoticeHtml() +
            limitsHtml();

        bindFriendsTab();
        renderSearchResults();
    }

    function countyOptionsHtml() {
        var selected = normaliseCounty(state.search.county);
        return state.counties.map(function (c) {
            var norm = normaliseCounty(c.county);
            if (!norm) return '';
            return '<option value="' + escapeHtml(c.county) + '"' + (norm === selected ? ' selected' : '') + '>' +
                escapeHtml(titleCase(norm)) + (c.members ? ' (' + c.members + ')' : '') + '</option>';
        }).join('');
    }

    function bindFriendsTab() {
        var input = document.getElementById('frSearchInput');
        var county = document.getElementById('frCountySelect');
        var btn = document.getElementById('frSearchBtn');
        var groupBtn = document.getElementById('frNewGroupBtn');
        var list = document.getElementById('frFriendsList');

        if (input) {
            input.addEventListener('input', function () { state.search.query = input.value; });
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
        }
        if (county) {
            county.addEventListener('change', function () { state.search.county = county.value; runSearch(); });
        }
        if (btn) btn.addEventListener('click', function () { runSearch(); });
        if (groupBtn) groupBtn.addEventListener('click', function () { openGroupModal(); });
        if (list) {
            list.addEventListener('click', async function (e) {
                var target = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
                if (!target) return;
                var action = target.getAttribute('data-action');
                var id = target.getAttribute('data-id');
                if (action === 'chat') await openChatWithUser(id);
                if (action === 'remove') {
                    var res = await removeFriend(id);
                    if (!res.ok && !res.cancelled) window.alert(res.message);
                    renderCurrentTab();
                }
            });
        }
    }

    function renderSearchResults() {
        var el = document.getElementById('frSearchResults');
        if (!el) return;
        if (state.search.loading) {
            el.innerHTML = '<div class="fr-empty">' + escapeHtml(t('Se caută…', 'Searching…')) + '</div>';
            return;
        }
        if (!state.search.searched) { el.innerHTML = ''; return; }
        if (!state.search.results.length) {
            el.innerHTML = '<div class="fr-empty">' + escapeHtml(t(
                'Niciun rezultat. Verifică ortografia sau alege alt județ.',
                'No results. Check the spelling or pick another county.')) + '</div>';
            return;
        }
        var html = '<div class="fr-section-label" style="margin-top:10px;">' + escapeHtml(t('Rezultate', 'Results')) + '</div>';
        state.search.results.forEach(function (r) {
            var actionBtn = '';
            if (r.relationship === 'friend') {
                actionBtn = '<button type="button" class="fr-btn chat" data-search-action="chat" data-id="' + escapeHtml(r.user_id) + '">💬 ' + escapeHtml(t('Chat', 'Chat')) + '</button>';
            } else if (r.relationship === 'request_sent') {
                actionBtn = '<button type="button" class="fr-btn secondary" data-search-action="cancel" data-request="' + escapeHtml(r.request_id || '') + '">' + escapeHtml(t('Anulează cererea', 'Cancel request')) + '</button>';
            } else if (r.relationship === 'request_received') {
                actionBtn = '<button type="button" class="fr-btn ok" data-search-action="accept" data-request="' + escapeHtml(r.request_id || '') + '">' + escapeHtml(t('Acceptă', 'Accept')) + '</button>';
            } else {
                actionBtn = '<button type="button" class="fr-btn" data-search-action="add" data-id="' + escapeHtml(r.user_id) + '">＋ ' + escapeHtml(t('Adaugă', 'Add')) + '</button>';
            }
            html += '<div class="fr-person">' +
                personAvatarHtml(r.user_id, r.display_name) +
                '<div class="fr-person-main"><div class="fr-person-name">' + escapeHtml(r.display_name || 'Detectorist') + '</div>' +
                '<div class="fr-person-meta">' + escapeHtml(personMeta({ county: r.county, email: r.email })) + '</div>' +
                '<div class="fr-person-meta" style="font-size:0.66rem;opacity:0.5;">' + escapeHtml(r.user_id) + '</div></div>' +
                '<div class="fr-person-actions">' + actionBtn + '</div></div>';
        });
        el.innerHTML = html;

        el.onclick = async function (e) {
            var target = e.target && e.target.closest ? e.target.closest('[data-search-action]') : null;
            if (!target) return;
            var action = target.getAttribute('data-search-action');
            var id = target.getAttribute('data-id');
            var requestId = target.getAttribute('data-request');
            target.disabled = true;
            var res;
            if (action === 'add') res = await sendFriendRequest(id, '');
            else if (action === 'cancel') res = await cancelFriendRequest(requestId);
            else if (action === 'accept') res = await respondFriendRequest(requestId, true);
            else if (action === 'chat') { await openChatWithUser(id); return; }
            if (res && !res.ok) window.alert(res.message);
            await Promise.all([loadFriends(), runSearch()]);
            renderCurrentTab();
        };
    }

    function renderRequestsTab() {
        var el = document.getElementById('frTabRequests');
        if (!el) return;

        function requestRow(r, isIncoming) {
            var actions = isIncoming
                ? '<button type="button" class="fr-btn ok" data-req-action="accept" data-id="' + escapeHtml(r.id) + '">' + escapeHtml(t('Acceptă', 'Accept')) + '</button>' +
                  '<button type="button" class="fr-btn danger" data-req-action="decline" data-id="' + escapeHtml(r.id) + '">' + escapeHtml(t('Refuză', 'Decline')) + '</button>'
                : '<button type="button" class="fr-btn secondary" data-req-action="cancel" data-id="' + escapeHtml(r.id) + '">' + escapeHtml(t('Retrage', 'Withdraw')) + '</button>';
            return '<div class="fr-person">' +
                personAvatarHtml(r.other_id, r.other_name) +
                '<div class="fr-person-main"><div class="fr-person-name">' + escapeHtml(r.other_name || 'Detectorist') + '</div>' +
                '<div class="fr-person-meta">' + escapeHtml(personMeta({ county: r.other_county, email: r.other_email })) + '</div>' +
                (r.message ? '<div class="fr-person-meta" style="font-style:italic;opacity:0.85;">„' + escapeHtml(r.message) + '”</div>' : '') +
                '<div class="fr-person-meta" style="font-size:0.66rem;opacity:0.55;">' + escapeHtml(fmtDateTime(r.created_at)) + '</div></div>' +
                '<div class="fr-person-actions">' + actions + '</div></div>';
        }

        var incomingHtml = state.incomingRequests.length
            ? state.incomingRequests.map(function (r) { return requestRow(r, true); }).join('')
            : '<div class="fr-empty">' + escapeHtml(t('Nicio cerere primită.', 'No incoming requests.')) + '</div>';
        var outgoingHtml = state.outgoingRequests.length
            ? state.outgoingRequests.map(function (r) { return requestRow(r, false); }).join('')
            : '<div class="fr-empty">' + escapeHtml(t('Nu ai trimis cereri în așteptare.', 'No pending requests sent.')) + '</div>';

        el.innerHTML =
            '<div class="fr-card">' +
                '<div class="fr-section-label">' + escapeHtml(t('Cereri primite', 'Incoming requests')) + ' (' + state.incomingRequests.length + ')</div>' +
                '<div id="frIncomingList">' + incomingHtml + '</div>' +
            '</div>' +
            '<div class="fr-card">' +
                '<div class="fr-section-label">' + escapeHtml(t('Trimise de tine', 'Sent by you')) + ' (' + state.outgoingRequests.length + ')</div>' +
                '<div id="frOutgoingList">' + outgoingHtml + '</div>' +
            '</div>' +
            backendNoticeHtml();

        // onclick (not addEventListener): this container survives re-renders,
        // so listeners would otherwise stack up and answer a tap twice.
        el.onclick = async function (e) {
            var target = e.target && e.target.closest ? e.target.closest('[data-req-action]') : null;
            if (!target) return;
            var action = target.getAttribute('data-req-action');
            var id = target.getAttribute('data-id');
            target.disabled = true;
            var res;
            if (action === 'accept') res = await respondFriendRequest(id, true);
            else if (action === 'decline') res = await respondFriendRequest(id, false);
            else res = await cancelFriendRequest(id);
            if (res && !res.ok) window.alert(res.message);
            renderCurrentTab();
        };
    }

    function conversationLabel(c) {
        if (c.kind === 'group') return c.title || t('Grup', 'Group');
        return c.other_user_name || t('Chat privat', 'Private chat');
    }

    function renderChatsTab() {
        var el = document.getElementById('frTabChats');
        if (!el) return;

        var rows = '';
        if (!state.conversations.length) {
            rows = '<div class="fr-empty">' + escapeHtml(t(
                'Nicio conversație încă. Deschide chat-ul cu un prieten sau creează un grup.',
                'No conversations yet. Open a chat with a friend or create a group.')) + '</div>';
        } else {
            state.conversations.forEach(function (c) {
                var unread = Number(c.unread_count) || 0;
                var preview = c.last_message_body
                    ? c.last_message_body
                    : (c.last_media_type && c.last_media_type !== 'none'
                        ? (c.last_media_type === 'video' ? '🎥 ' + t('video', 'video') : '🖼 ' + t('imagine', 'image'))
                        : t('Fără mesaje încă', 'No messages yet'));
                rows += '<div class="fr-person" style="' + (unread ? 'border-color:rgba(196,43,43,0.5);background:rgba(196,43,43,0.08);' : '') + '">' +
                    personAvatarHtml(c.kind === 'group' ? c.id : (c.other_user_id || c.id), conversationLabel(c)) +
                    '<div class="fr-person-main">' +
                        '<div class="fr-person-name">' + (c.kind === 'group' ? '👥 ' : '💬 ') + escapeHtml(conversationLabel(c)) + '</div>' +
                        '<div class="fr-person-meta">' + escapeHtml(preview.slice(0, 80)) + ' • ' + escapeHtml(fmtShortTime(c.last_message_at)) + '</div>' +
                        '<div class="fr-person-meta" style="font-size:0.66rem;opacity:0.55;">' +
                            escapeHtml(t(c.kind === 'group' ? 'Grup • ' + c.member_count + ' membri' : 'Chat privat',
                                c.kind === 'group' ? 'Group • ' + c.member_count + ' members' : 'Private chat')) +
                            (c.status === 'closed' ? ' • ' + escapeHtml(t('închis', 'closed')) : '') +
                        '</div>' +
                        (unread ? '<div class="fr-person-meta" style="color:#ff8a8a;font-weight:700;">● ' + unread + ' ' + escapeHtml(t('necitite', 'unread')) + '</div>' : '') +
                    '</div>' +
                    '<div class="fr-person-actions">' +
                        '<button type="button" class="fr-btn chat" data-conv-action="open" data-id="' + escapeHtml(c.id) + '">' + escapeHtml(t('Deschide', 'Open')) + '</button>' +
                    '</div></div>';
            });
        }

        el.innerHTML =
            '<div class="fr-card">' +
                '<div class="fr-header-row">' +
                    '<div class="fr-section-label" style="margin:0;">' + escapeHtml(t('Conversațiile tale', 'Your conversations')) + '</div>' +
                    '<button type="button" class="fr-btn" id="frNewGroupBtn2">👥 ' + escapeHtml(t('Creează grup', 'Create group')) + '</button>' +
                '</div>' +
                '<div id="frConversationsList">' + rows + '</div>' +
            '</div>' +
            backendNoticeHtml() +
            limitsHtml();

        var g2 = document.getElementById('frNewGroupBtn2');
        if (g2) g2.addEventListener('click', function () { openGroupModal(); });
        var list = document.getElementById('frConversationsList');
        if (list) {
            list.addEventListener('click', function (e) {
                var target = e.target && e.target.closest ? e.target.closest('[data-conv-action="open"]') : null;
                if (!target) return;
                openConversationById(target.getAttribute('data-id'));
            });
        }
    }

    function renderCurrentTab() {
        if (state.activeTab === 'friends') renderFriendsTab();
        else if (state.activeTab === 'requests') renderRequestsTab();
        else renderChatsTab();
        updateTabCounts();
    }

    function updateTabCounts() {
        var f = document.getElementById('frTabCountFriends');
        var r = document.getElementById('frTabCountRequests');
        var c = document.getElementById('frTabCountChats');
        if (f) f.textContent = '(' + state.friends.length + ')';
        if (r) {
            r.textContent = '(' + state.incomingRequests.length + ')';
            r.style.color = state.incomingRequests.length ? '#ffd27f' : '';
        }
        if (c) c.textContent = '(' + state.conversations.length + ')';
    }

    async function openFriends(tab) {
        closeMenus();
        var user = currentUser();
        if (!user || !user.id) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }

        var existing = document.getElementById('friendsManagerPanel');
        if (existing) existing.remove();

        state.activeTab = tab || 'friends';
        state.panelOpen = true;

        var panel = document.createElement('div');
        panel.id = 'friendsManagerPanel';
        panel.innerHTML =
            '<div class="fr-wrap">' +
                '<div class="fr-header-row">' +
                    '<button type="button" class="fr-back-btn" id="frBackBtn">← ' + escapeHtml(t('Înapoi la hartă', 'Back to map')) + '</button>' +
                    '<button type="button" class="fr-back-btn" id="frRefreshBtn">⟳ ' + escapeHtml(t('Reîmprospătează', 'Refresh')) + '</button>' +
                '</div>' +
                '<h2 class="fr-title">👥 ' + escapeHtml(t('Prieteni', 'Friends')) + '</h2>' +
                '<div class="fr-tabs">' +
                    '<button type="button" class="fr-tab" data-tab="friends">👤 ' + escapeHtml(t('Prieteni', 'Friends')) + ' <span class="fr-tab-count" id="frTabCountFriends"></span></button>' +
                    '<button type="button" class="fr-tab" data-tab="requests">🔔 ' + escapeHtml(t('Cereri', 'Requests')) + ' <span class="fr-tab-count" id="frTabCountRequests"></span></button>' +
                    '<button type="button" class="fr-tab" data-tab="chats">💬 ' + escapeHtml(t('Chat-uri', 'Chats')) + ' <span class="fr-tab-count" id="frTabCountChats"></span></button>' +
                '</div>' +
                '<div id="frTabFriends" style="display:flex;flex-direction:column;gap:12px;"></div>' +
                '<div id="frTabRequests" style="display:none;flex-direction:column;gap:12px;"></div>' +
                '<div id="frTabChats" style="display:none;flex-direction:column;gap:12px;"></div>' +
            '</div>';
        document.body.appendChild(panel);

        panel.querySelector('#frBackBtn').addEventListener('click', closeFriendsPanel);
        panel.querySelector('#frRefreshBtn').addEventListener('click', function () { refreshAll(true); });
        Array.prototype.forEach.call(panel.querySelectorAll('.fr-tab'), function (btn) {
            btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
        });

        await refreshAll(true);
    }

    function closeFriendsPanel() {
        var panel = document.getElementById('friendsManagerPanel');
        if (panel) panel.remove();
        state.panelOpen = false;
    }

    function switchTab(tab) {
        state.activeTab = tab;
        ['friends', 'requests', 'chats'].forEach(function (name) {
            var el = document.getElementById('frTab' + name.charAt(0).toUpperCase() + name.slice(1));
            var btn = document.querySelector('#friendsManagerPanel .fr-tab[data-tab="' + name + '"]');
            if (el) el.style.display = (name === tab) ? 'flex' : 'none';
            if (btn) btn.classList.toggle('active', name === tab);
        });
        renderCurrentTab();
    }

    async function refreshAll(render) {
        var user = currentUser();
        if (!user) return;
        await loadLimits();
        await ensureProfile();
        await Promise.all([loadFriends(), loadRequests(), loadConversations(), loadCounters(), loadEventQuota(true)]);
        // The county dropdown also offers the counties of the people we already
        // know, so it is built after the friend list is in.
        await loadCounties();
        if (render !== false) {
            if (!state.panelOpen) return;
            switchTab(state.activeTab);
        }
    }

    /* ── Group creation modal ──────────────────────────────────────────── */

    function openGroupModal(prefillIds) {
        var existing = document.getElementById('frGroupModal');
        if (existing) existing.remove();

        state.groupDraft = { title: '', selected: {} };
        (prefillIds || []).forEach(function (id) { state.groupDraft.selected[id] = true; });

        if (!state.friends.length) {
            window.alert(t('Ai nevoie de cel puțin un prieten ca să creezi un grup.', 'You need at least one friend to create a group.'));
            return;
        }

        var L = limits();
        var modal = document.createElement('div');
        modal.id = 'frGroupModal';
        modal.className = 'fr-modal';
        modal.innerHTML =
            '<div class="fr-modal-box">' +
                '<h3 class="fr-modal-title">👥 ' + escapeHtml(t('Creează un chat de grup', 'Create a group chat')) + '</h3>' +
                '<label style="display:block;font-size:0.76rem;margin-bottom:4px;">' + escapeHtml(t('Titlul grupului *', 'Group title *')) + '</label>' +
                '<input type="text" class="fr-input" id="frGroupTitle" style="width:100%;margin-bottom:10px;" maxlength="' + L.max_conversation_title_len + '" placeholder="' + escapeHtml(t('Ex: Vânătoare sâmbăta', 'Ex: Saturday hunt')) + '">' +
                '<label style="display:block;font-size:0.76rem;margin-bottom:4px;">' + escapeHtml(t('Invită membri (doar prieteni)', 'Invite members (friends only)')) + '</label>' +
                '<input type="text" class="fr-input" id="frGroupFilter" style="width:100%;margin-bottom:6px;" placeholder="' + escapeHtml(t('Filtrează prietenii…', 'Filter friends…')) + '">' +
                '<div class="fr-picker" id="frGroupPicker"></div>' +
                '<div class="fr-error" id="frGroupError"></div>' +
                '<div style="display:flex;gap:10px;margin-top:6px;">' +
                    '<button type="button" class="fr-btn" id="frGroupCreate" style="flex:1;">' + escapeHtml(t('Creează grupul', 'Create group')) + '</button>' +
                    '<button type="button" class="fr-btn secondary" id="frGroupCancel">' + escapeHtml(t('Anulează', 'Cancel')) + '</button>' +
                '</div>' +
                '<div class="fr-limits" style="margin-top:8px;">' + escapeHtml(t(
                    'Tu ești administratorul grupului: doar tu redenumești grupul, adaugi sau elimini membri și îl poți șterge. Maximum ' + L.max_group_members + ' membri.',
                    'You are the group admin: only you can rename it, add or remove members and delete it. Maximum ' + L.max_group_members + ' members.')) + '</div>' +
            '</div>';
        document.body.appendChild(modal);

        function renderPicker(filter) {
            var picker = modal.querySelector('#frGroupPicker');
            if (!picker) return;
            var q = String(filter || '').toLowerCase();
            var rows = state.friends.filter(function (f) {
                if (!q) return true;
                return String(f.display_name).toLowerCase().indexOf(q) !== -1 ||
                       String(f.email).toLowerCase().indexOf(q) !== -1 ||
                       String(f.county).toLowerCase().indexOf(q) !== -1;
            });
            if (!rows.length) {
                picker.innerHTML = '<div class="fr-empty">' + escapeHtml(t('Niciun prieten găsit.', 'No friend found.')) + '</div>';
                return;
            }
            picker.innerHTML = rows.map(function (f) {
                var checked = state.groupDraft.selected[f.user_id] ? ' checked' : '';
                return '<label class="fr-picker-row"><input type="checkbox" data-member="' + escapeHtml(f.user_id) + '"' + checked + '>' +
                    '<span class="fr-picker-name">' + escapeHtml(f.display_name) + '</span>' +
                    '<span class="fr-picker-meta">' + escapeHtml(titleCase(normaliseCounty(f.county))) + '</span></label>';
            }).join('');
            Array.prototype.forEach.call(picker.querySelectorAll('input[data-member]'), function (input) {
                input.addEventListener('change', function () {
                    var id = input.getAttribute('data-member');
                    if (input.checked) state.groupDraft.selected[id] = true;
                    else delete state.groupDraft.selected[id];
                });
            });
        }

        renderPicker('');
        modal.querySelector('#frGroupFilter').addEventListener('input', function (e) { renderPicker(e.target.value); });
        modal.querySelector('#frGroupCancel').addEventListener('click', function () { modal.remove(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
        modal.querySelector('#frGroupCreate').addEventListener('click', async function () {
            var errEl = modal.querySelector('#frGroupError');
            var title = modal.querySelector('#frGroupTitle').value.trim();
            var ids = Object.keys(state.groupDraft.selected);
            errEl.textContent = '';
            if (!title) { errEl.textContent = t('Scrie un titlu pentru grup.', 'Give the group a title.'); return; }
            if (!ids.length) { errEl.textContent = t('Selectează cel puțin un prieten.', 'Select at least one friend.'); return; }
            if (ids.length + 1 > L.max_group_members) {
                errEl.textContent = t('Grupul poate avea maximum ' + L.max_group_members + ' membri.', 'A group can have at most ' + L.max_group_members + ' members.');
                return;
            }
            var btn = modal.querySelector('#frGroupCreate');
            btn.disabled = true;
            btn.textContent = t('Se creează…', 'Creating…');
            var res = await createGroupConversation(title, ids);
            if (!res.ok) {
                errEl.textContent = res.message;
                btn.disabled = false;
                btn.textContent = t('Creează grupul', 'Create group');
                return;
            }
            modal.remove();
            if (res.conversation && res.conversation.id) openConversationById(res.conversation.id);
            else { switchTab('chats'); }
        });
    }

    /* ══════════════════════════════════════════════════════════════════════
       CHAT VIEW
    ══════════════════════════════════════════════════════════════════════ */

    async function openChatWithUser(userId) {
        if (!userId) return;
        var res = await openDirectConversation(userId);
        if (!res.ok) { window.alert(res.message); return; }
        var conv = res.conversation;
        if (conv && conv.id) openConversationById(conv.id);
    }

    async function openConversationById(convId) {
        if (!convId) return;
        var conv = state.conversations.filter(function (c) { return c.id === convId; })[0];
        if (!conv) {
            await loadConversations();
            conv = state.conversations.filter(function (c) { return c.id === convId; })[0];
        }
        if (!conv) {
            window.alert(t('Conversația nu a fost găsită.', 'Conversation not found.'));
            return;
        }

        state.chat = conv;
        state.chatMessages = cachedMessages(convId);
        state.chatLoading = true;

        var existing = document.getElementById('friendChatPanel');
        if (existing) existing.remove();

        var L = limits();
        var panel = document.createElement('div');
        panel.id = 'friendChatPanel';
        panel.className = 'fr-chat-panel';
        panel.innerHTML =
            '<div class="fr-chat-header">' +
                '<button type="button" class="fr-back-btn" id="frChatBack">←</button>' +
                personAvatarHtml(conv.kind === 'group' ? conv.id : (conv.other_user_id || conv.id), conversationLabel(conv)) +
                '<div class="fr-chat-header-main">' +
                    '<div class="fr-chat-title" id="frChatTitle">' + (conv.kind === 'group' ? '👥 ' : '💬 ') + escapeHtml(conversationLabel(conv)) + '</div>' +
                    '<div class="fr-chat-sub" id="frChatSub">' + escapeHtml(t('Se încarcă…', 'Loading…')) + '</div>' +
                '</div>' +
                '<button type="button" class="fr-back-btn" id="frChatMenu" title="' + escapeHtml(t('Setări conversație', 'Conversation settings')) + '">⋯</button>' +
            '</div>' +
            '<div class="fr-chat-actions" id="frChatActions"></div>' +
            '<div class="fr-chat-messages" id="frChatMessages"></div>' +
            '<div class="fr-chat-composer">' +
                '<label class="fr-attach" title="' + escapeHtml(t('Atașează foto/video (max ' + fmtBytes(L.max_attachment_bytes) + ')', 'Attach photo/video (max ' + fmtBytes(L.max_attachment_bytes) + ')')) + '">' +
                    '📎<input type="file" id="frChatFile" accept="image/*,video/*" style="display:none;">' +
                '</label>' +
                '<textarea id="frChatInput" rows="1" maxlength="' + L.max_message_length + '" placeholder="' + escapeHtml(t('Scrie un mesaj…', 'Type a message…')) + '"></textarea>' +
                '<button type="button" class="fr-btn" id="frChatSend">➤</button>' +
            '</div>';
        document.body.appendChild(panel);

        panel.querySelector('#frChatBack').addEventListener('click', closeChatView);
        panel.querySelector('#frChatMenu').addEventListener('click', openConversationSettings);
        panel.querySelector('#frChatSend').addEventListener('click', submitChatMessage);

        var input = panel.querySelector('#frChatInput');
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitChatMessage(); }
        });
        panel.querySelector('#frChatFile').addEventListener('change', async function (e) {
            var file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            var prepared = await prepareAttachment(file);
            if (!prepared) return;
            if (prepared.error) { window.alert(prepared.error); return; }
            var res = await sendMessage(convId, '', prepared);
            if (!res.ok) window.alert(res.message);
            renderChatMessages();
        });

        await Promise.all([loadConversationMessages(convId), loadConversationMembers(convId)]);
        state.chatLoading = false;
        renderChatMessages();
        renderChatHeader();
        renderChatActions();
        await markConversationRead(convId);
        startChatLiveUpdates(convId);
        input.focus();
    }

    function closeChatView() {
        stopChatLiveUpdates();
        var panel = document.getElementById('friendChatPanel');
        if (panel) panel.remove();
        state.chat = null;
        if (state.panelOpen) {
            loadConversations().then(function () { renderCurrentTab(); });
        }
    }

    function renderChatHeader() {
        var conv = state.chat;
        if (!conv) return;
        var sub = document.getElementById('frChatSub');
        var title = document.getElementById('frChatTitle');
        if (title) title.innerHTML = (conv.kind === 'group' ? '👥 ' : '💬 ') + escapeHtml(conversationLabel(conv));
        if (!sub) return;
        var bits = [];
        if (conv.kind === 'group') {
            bits.push(t('Grup', 'Group') + ' • ' + state.chatMembers.length + ' ' + t('membri', 'members'));
            if (conv.my_role === 'admin') bits.push(t('tu ești admin', 'you are the admin'));
        } else {
            bits.push(t('Chat privat', 'Private chat'));
            if (conv.other_user_county) bits.push('📍 ' + titleCase(normaliseCounty(conv.other_user_county)));
        }
        if (conv.status === 'closed') bits.push(t('conversație închisă', 'conversation closed'));
        sub.textContent = bits.join(' • ');
    }

    function renderChatActions() {
        var wrap = document.getElementById('frChatActions');
        if (!wrap) return;
        var conv = state.chat;
        if (!conv) return;
        var html = '<button type="button" class="fr-btn secondary" id="frChatCreateEvent">📅 ' +
            escapeHtml(conv.kind === 'group'
                ? t('Creează eveniment cu grupul', 'Create event with the group')
                : t('Creează eveniment cu acest prieten', 'Create event with this friend')) + '</button>';
        if (conv.kind === 'group' && conv.my_role === 'admin') {
            html += '<button type="button" class="fr-btn secondary" id="frChatAddMembers">＋ ' + escapeHtml(t('Adaugă membri', 'Add members')) + '</button>';
        }
        if (conv.kind === 'direct' && conv.other_user_id) {
            html += '<button type="button" class="fr-btn secondary" id="frChatOpenProfile">👤 ' + escapeHtml(t('Vezi prietenul', 'View friend')) + '</button>';
        }
        wrap.innerHTML = html;

        var createBtn = wrap.querySelector('#frChatCreateEvent');
        if (createBtn) createBtn.addEventListener('click', createEventFromChat);
        var addBtn = wrap.querySelector('#frChatAddMembers');
        if (addBtn) addBtn.addEventListener('click', function () { openAddMembersModal(); });
        var profileBtn = wrap.querySelector('#frChatOpenProfile');
        if (profileBtn) {
            profileBtn.addEventListener('click', function () {
                closeChatView();
                switchTab('friends');
            });
        }
    }

    function renderChatMessages() {
        var list = document.getElementById('frChatMessages');
        if (!list) return;
        var user = currentUser();
        var msgs = state.chatMessages || [];

        if (state.chatLoading && !msgs.length) {
            list.innerHTML = '<div class="fr-empty">' + escapeHtml(t('Se încarcă mesajele…', 'Loading messages…')) + '</div>';
            return;
        }
        if (!msgs.length) {
            list.innerHTML = '<div class="fr-empty">' + escapeHtml(t(
                'Niciun mesaj încă. Scrie primul mesaj — conversația se păstrează pe contul tău și pe celelalte dispozitive.',
                'No messages yet. Say hello — this thread is stored on your account and follows you to other devices.')) + '</div>';
            return;
        }

        var html = '';
        var lastDay = '';
        msgs.forEach(function (m) {
            var day = String(m.created_at || '').slice(0, 10);
            if (day && day !== lastDay) {
                lastDay = day;
                html += '<div class="fr-day-sep">' + escapeHtml(day) + '</div>';
            }
            var mine = user && m.sender_id === user.id;
            var mediaHtml = '';
            if (m.media_type === 'image' && m.media_url) {
                mediaHtml = '<img src="' + escapeHtml(m.media_url) + '" alt="image" loading="lazy">';
            } else if (m.media_type === 'video' && m.media_url) {
                mediaHtml = '<video controls playsinline src="' + escapeHtml(m.media_url) + '"></video>';
            } else if (m.media_type && m.media_type !== 'none' && !m.media_url) {
                mediaHtml = '<div class="fr-msg-media-missing">' + escapeHtml(t(
                    'Atașamentul nu este în cache-ul local — reconectează-te ca să îl vezi.',
                    'The attachment is not in the local cache — reconnect to view it.')) + '</div>';
            }
            html += '<div class="fr-msg ' + (mine ? 'mine' : 'theirs') + '">' +
                (!mine && state.chat && state.chat.kind === 'group'
                    ? '<div class="fr-msg-sender">' + escapeHtml(m.sender_name || 'Detectorist') + '</div>' : '') +
                (m.body ? '<div>' + escapeHtml(m.body).replace(/\n/g, '<br>') + '</div>' : '') +
                mediaHtml +
                '<div class="fr-msg-time">' + escapeHtml(fmtShortTime(m.created_at)) + '</div>' +
                '</div>';
        });
        list.innerHTML = html;
        list.scrollTop = list.scrollHeight;
    }

    async function submitChatMessage() {
        var input = document.getElementById('frChatInput');
        var conv = state.chat;
        if (!input || !conv) return;
        var text = input.value;
        if (!text.trim()) return;
        input.value = '';
        var res = await sendMessage(conv.id, text, null);
        if (!res.ok) {
            input.value = text;
            window.alert(res.message);
            return;
        }
        renderChatMessages();
    }

    /* ── Conversation settings (admin powers) ──────────────────────────── */

    function openConversationSettings() {
        var conv = state.chat;
        if (!conv) return;
        var existing = document.getElementById('frConvSettings');
        if (existing) existing.remove();

        var isAdmin = conv.my_role === 'admin';
        var modal = document.createElement('div');
        modal.id = 'frConvSettings';
        modal.className = 'fr-modal';
        var membersHtml = state.chatMembers.map(function (m) {
            return '<div class="fr-person" style="padding:8px;">' +
                personAvatarHtml(m.user_id, m.display_name) +
                '<div class="fr-person-main"><div class="fr-person-name">' + escapeHtml(m.display_name) +
                (m.role === 'admin' ? ' <span style="font-size:0.66rem;color:#c4a0f0;">★ admin</span>' : '') + '</div>' +
                '<div class="fr-person-meta">' + escapeHtml(personMeta({ county: m.county, email: m.email })) + '</div></div>' +
                (isAdmin && conv.kind === 'group' && m.user_id !== (currentUser() || {}).id
                    ? '<div class="fr-person-actions"><button type="button" class="fr-btn danger" data-remove-member="' + escapeHtml(m.user_id) + '">✕</button></div>'
                    : '') +
                '</div>';
        }).join('');

        modal.innerHTML =
            '<div class="fr-modal-box">' +
                '<h3 class="fr-modal-title">' + escapeHtml(conv.kind === 'group' ? t('Setări grup', 'Group settings') : t('Detalii chat', 'Chat details')) + '</h3>' +
                (conv.kind === 'group' && isAdmin
                    ? '<label style="display:block;font-size:0.76rem;margin-bottom:4px;">' + escapeHtml(t('Titlul grupului', 'Group title')) + '</label>' +
                      '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
                      '<input type="text" class="fr-input" id="frRenameInput" style="flex:1;" maxlength="' + limits().max_conversation_title_len + '" value="' + escapeHtml(conv.title || '') + '">' +
                      '<button type="button" class="fr-btn" id="frRenameBtn">' + escapeHtml(t('Salvează', 'Save')) + '</button></div>'
                    : '') +
                '<div class="fr-section-label">' + escapeHtml(t('Membri', 'Members')) + ' (' + state.chatMembers.length + ')</div>' +
                '<div class="fr-picker" style="max-height:260px;">' + (membersHtml || '<div class="fr-empty">—</div>') + '</div>' +
                '<div class="fr-error" id="frSettingsError"></div>' +
                '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">' +
                    (isAdmin && conv.kind === 'group' ? '<button type="button" class="fr-btn danger" id="frDeleteConv">' + escapeHtml(t('Șterge grupul', 'Delete group')) + '</button>' : '') +
                    '<button type="button" class="fr-btn secondary" id="frLeaveConv">' + escapeHtml(conv.kind === 'group' ? t('Ieși din grup', 'Leave group') : t('Închide chat-ul', 'Close chat')) + '</button>' +
                    '<button type="button" class="fr-btn secondary" id="frCloseSettings">' + escapeHtml(t('Închide', 'Close')) + '</button>' +
                '</div>' +
                '<div class="fr-limits" style="margin-top:8px;">' + escapeHtml(t(
                    'Mesajele se păstrează ' + limits().message_retention_days + ' zile, apoi sunt șterse automat. Atașamentele sunt limitate la ' +
                    fmtBytes(limits().max_attachment_bytes) + ' fiecare și ' + fmtBytes(limits().max_conversation_storage_bytes) + ' per conversație.',
                    'Messages are kept for ' + limits().message_retention_days + ' days, then deleted automatically. Attachments are limited to ' +
                    fmtBytes(limits().max_attachment_bytes) + ' each and ' + fmtBytes(limits().max_conversation_storage_bytes) + ' per conversation.')) + '</div>' +
            '</div>';
        document.body.appendChild(modal);

        modal.querySelector('#frCloseSettings').addEventListener('click', function () { modal.remove(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

        var renameBtn = modal.querySelector('#frRenameBtn');
        if (renameBtn) {
            renameBtn.addEventListener('click', async function () {
                var errEl = modal.querySelector('#frSettingsError');
                var res = await renameConversation(conv.id, modal.querySelector('#frRenameInput').value.trim());
                if (!res.ok) { errEl.textContent = res.message; return; }
                conv.title = modal.querySelector('#frRenameInput').value.trim();
                renderChatHeader();
                modal.remove();
            });
        }

        Array.prototype.forEach.call(modal.querySelectorAll('[data-remove-member]'), function (btn) {
            btn.addEventListener('click', async function () {
                var errEl = modal.querySelector('#frSettingsError');
                var res = await removeConversationMember(conv.id, btn.getAttribute('data-remove-member'));
                if (!res.ok) { errEl.textContent = res.message; return; }
                modal.remove();
                openConversationSettings();
            });
        });

        var delBtn = modal.querySelector('#frDeleteConv');
        if (delBtn) {
            delBtn.addEventListener('click', async function () {
                if (!window.confirm(t('Ștergi grupul și toate mesajele lui?', 'Delete the group and all of its messages?'))) return;
                var res = await deleteConversation(conv.id);
                if (!res.ok) { modal.querySelector('#frSettingsError').textContent = res.message; return; }
                modal.remove();
                closeChatView();
                renderCurrentTab();
            });
        }

        modal.querySelector('#frLeaveConv').addEventListener('click', async function () {
            if (!window.confirm(t(
                conv.kind === 'group' ? 'Ieși din acest grup?' : 'Închizi chat-ul privat? Istoricul rămâne până la expirarea perioadei de retenție.',
                conv.kind === 'group' ? 'Leave this group?' : 'Close this private chat? The history stays until the retention period ends.'))) return;
            var res = await leaveConversation(conv.id);
            if (!res.ok) { modal.querySelector('#frSettingsError').textContent = res.message; return; }
            modal.remove();
            closeChatView();
            renderCurrentTab();
        });
    }

    function openAddMembersModal() {
        var conv = state.chat;
        if (!conv) return;
        var memberIds = {};
        state.chatMembers.forEach(function (m) { memberIds[m.user_id] = true; });
        var candidates = state.friends.filter(function (f) { return !memberIds[f.user_id]; });
        if (!candidates.length) {
            window.alert(t('Toți prietenii tăi sunt deja în acest grup.', 'All of your friends are already in this group.'));
            return;
        }

        var existing = document.getElementById('frAddMembersModal');
        if (existing) existing.remove();
        var selected = {};
        var L = limits();

        var modal = document.createElement('div');
        modal.id = 'frAddMembersModal';
        modal.className = 'fr-modal';
        modal.innerHTML =
            '<div class="fr-modal-box">' +
                '<h3 class="fr-modal-title">＋ ' + escapeHtml(t('Adaugă membri în grup', 'Add members to the group')) + '</h3>' +
                '<div class="fr-picker">' + candidates.map(function (f) {
                    return '<label class="fr-picker-row"><input type="checkbox" data-add-member="' + escapeHtml(f.user_id) + '">' +
                        '<span class="fr-picker-name">' + escapeHtml(f.display_name) + '</span>' +
                        '<span class="fr-picker-meta">' + escapeHtml(titleCase(normaliseCounty(f.county))) + '</span></label>';
                }).join('') + '</div>' +
                '<div class="fr-error" id="frAddMembersError"></div>' +
                '<div style="display:flex;gap:10px;margin-top:8px;">' +
                    '<button type="button" class="fr-btn" id="frAddMembersOk" style="flex:1;">' + escapeHtml(t('Adaugă', 'Add')) + '</button>' +
                    '<button type="button" class="fr-btn secondary" id="frAddMembersCancel">' + escapeHtml(t('Anulează', 'Cancel')) + '</button>' +
                '</div>' +
                '<div class="fr-limits" style="margin-top:8px;">' + escapeHtml(t(
                    'Maximum ' + L.max_group_members + ' membri în grup.', 'At most ' + L.max_group_members + ' members per group.')) + '</div>' +
            '</div>';
        document.body.appendChild(modal);

        Array.prototype.forEach.call(modal.querySelectorAll('[data-add-member]'), function (input) {
            input.addEventListener('change', function () {
                var id = input.getAttribute('data-add-member');
                if (input.checked) selected[id] = true; else delete selected[id];
            });
        });
        modal.querySelector('#frAddMembersCancel').addEventListener('click', function () { modal.remove(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
        modal.querySelector('#frAddMembersOk').addEventListener('click', async function () {
            var ids = Object.keys(selected);
            var errEl = modal.querySelector('#frAddMembersError');
            if (!ids.length) { errEl.textContent = t('Selectează cel puțin un prieten.', 'Select at least one friend.'); return; }
            var res = await addConversationMembers(conv.id, ids);
            if (!res.ok) { errEl.textContent = res.message; return; }
            modal.remove();
            renderChatHeader();
        });
    }

    /* ── Creating an event straight from a chat ────────────────────────── */

    async function createEventFromChat() {
        var conv = state.chat;
        var user = currentUser();
        if (!conv || !user) return;

        var quota = await loadEventQuota(true);
        if (quota && quota.created >= quota.createdMax) {
            window.alert(t(
                'Ai deja ' + quota.created + ' din ' + quota.createdMax + ' evenimente active. Șterge unul înainte să creezi altul.',
                'You already have ' + quota.created + ' of ' + quota.createdMax + ' active events. Delete one before creating another.'));
            return;
        }

        var inviteIds = [];
        if (conv.kind === 'direct' && conv.other_user_id) {
            inviteIds = [conv.other_user_id];
        } else {
            state.chatMembers.forEach(function (m) {
                if (m.user_id !== user.id && m.is_friend) inviteIds.push(m.user_id);
            });
        }
        if (!inviteIds.length) {
            window.alert(t('Nu există prieteni de invitat în această conversație.', 'There are no friends to invite in this conversation.'));
            return;
        }

        var lat = null;
        var lng = null;
        try {
            var map = window._dlMap || window.map;
            if (map && typeof map.getCenter === 'function') {
                var c = map.getCenter();
                lat = c.lat; lng = c.lng;
            }
        } catch (e) {}
        if (lat == null || lng == null) {
            var LL = window.DetectLabLastLocation;
            var mine = LL && LL.getMyLastLocation ? LL.getMyLastLocation() : null;
            if (mine && mine.latitude != null) { lat = mine.latitude; lng = mine.longitude; }
        }
        if (lat == null || lng == null) { lat = 46.7712; lng = 23.6236; }   // Cluj-Napoca fallback

        if (typeof window.openCreateEventModal !== 'function') {
            window.alert(t('Modulul de evenimente nu este încă încărcat.', 'The events module is not loaded yet.'));
            return;
        }

        // The events panel is not open here, so remember which thread asked for
        // the event: after the save the invited friends get a participation
        // request and the chat gets a link to the new event.
        window.openCreateEventModal(lat, lng, null, '', {
            preselectedFriendIds: inviteIds,
            showFriendsPicker: true,
            showCoordinates: true,
            sourceConversationId: conv.id,
            onCreated: async function (event) {
                var res = await inviteFriendsToEvent(event.id, inviteIds);
                if (res.ok) {
                    var counts = summariseInviteResults(res.results);
                    if (counts.invited) {
                        var summary = inviteSummaryText(counts);
                        try {
                            await sendMessage(conv.id,
                                t('📅 Am creat evenimentul „' + event.title + '”. ' + summary + '.',
                                  '📅 I created the event "' + event.title + '". ' + summary + '.'), null);
                        } catch (e) {}
                    }
                } else {
                    window.alert(res.message);
                }
                if (typeof window._fetchEvents === 'function') { try { window._fetchEvents(); } catch (e) {} }
                if (typeof window.refreshEventsMap === 'function') { try { window.refreshEventsMap(); } catch (e) {} }
            }
        });
    }

    /* ══════════════════════════════════════════════════════════════════════
       FRIEND PICKER used by the create-event form ("Adaugă prieteni")
    ══════════════════════════════════════════════════════════════════════ */

    function renderFriendPicker(container, options) {
        if (!container) return;
        var opts = options || {};
        var selected = opts.selected || {};
        var friends = state.friends.slice();

        container.innerHTML =
            '<div class="fr-section-label" style="margin:0 0 6px;">' + escapeHtml(t('Adaugă prieteni la eveniment', 'Add friends to the event')) + '</div>' +
            '<input type="text" class="fr-input" data-picker-filter style="width:100%;margin-bottom:6px;" placeholder="' + escapeHtml(t('Filtrează prietenii…', 'Filter friends…')) + '">' +
            '<div class="fr-picker" data-picker-list></div>' +
            '<div class="fr-limits" data-picker-info style="margin-top:6px;"></div>';

        var list = container.querySelector('[data-picker-list]');
        var filter = container.querySelector('[data-picker-filter]');
        var info = container.querySelector('[data-picker-info]');

        function paint(q) {
            var query = String(q || '').toLowerCase();
            var rows = friends.filter(function (f) {
                if (!query) return true;
                return String(f.display_name).toLowerCase().indexOf(query) !== -1 ||
                       String(f.email).toLowerCase().indexOf(query) !== -1 ||
                       String(f.county).toLowerCase().indexOf(query) !== -1;
            });
            if (!rows.length) {
                list.innerHTML = '<div class="fr-empty">' + escapeHtml(friends.length
                    ? t('Niciun prieten găsit.', 'No friend found.')
                    : t('Nu ai încă prieteni. Adaugă-i din tabul „Prieteni”.', 'You have no friends yet. Add some from the "Friends" tab.')) + '</div>';
                return;
            }
            list.innerHTML = rows.map(function (f) {
                return '<label class="fr-picker-row"><input type="checkbox" data-friend-id="' + escapeHtml(f.user_id) + '"' + (selected[f.user_id] ? ' checked' : '') + '>' +
                    '<span class="fr-picker-name">' + escapeHtml(f.display_name) + '</span>' +
                    '<span class="fr-picker-meta">' + escapeHtml(titleCase(normaliseCounty(f.county)) || maskEmail(f.email)) + '</span></label>';
            }).join('');
            Array.prototype.forEach.call(list.querySelectorAll('input[data-friend-id]'), function (input) {
                input.addEventListener('change', function () {
                    var id = input.getAttribute('data-friend-id');
                    if (input.checked) selected[id] = true; else delete selected[id];
                    paintInfo();
                    if (typeof opts.onChange === 'function') opts.onChange(Object.keys(selected));
                });
            });
        }

        function paintInfo() {
            var n = Object.keys(selected).length;
            info.textContent = t(
                n + ' prieteni selectați • vor primi o cerere de participare pe care o pot accepta sau refuza. Maximum ' + limits().max_event_invites_per_event + ' invitații per eveniment.',
                n + ' friends selected • they will receive a participation request they can accept or decline. At most ' + limits().max_event_invites_per_event + ' invites per event.'
            );
        }

        filter.addEventListener('input', function () { paint(filter.value); });
        paint('');
        paintInfo();
        container._dlPickerSelected = selected;
    }

    function readFriendPicker(container) {
        if (!container) return [];
        var selected = container._dlPickerSelected || {};
        return Object.keys(selected).filter(function (id) { return selected[id]; });
    }

    /* ══════════════════════════════════════════════════════════════════════
       BADGES on the nav entries
    ══════════════════════════════════════════════════════════════════════ */

    function ensureBadges() {
        try {
            var specs = [
                { host: '#userMenu button[onclick*="openFriends"]', id: 'navFriendsBadge' },
                { host: '#pwaUserDropdown button[onclick*="openFriends"]', id: 'pwaFriendsBadge' }
            ];
            specs.forEach(function (spec) {
                var host = document.querySelector(spec.host);
                if (!host) return;
                host.style.position = 'relative';
                if (host.querySelector('#' + spec.id)) return;
                var badge = document.createElement('span');
                badge.id = spec.id;
                badge.className = 'event-notif-badge hidden';
                badge.textContent = '0';
                host.appendChild(badge);
            });
        } catch (e) {}
    }

    function setBadge(id, count) {
        var el = document.getElementById(id);
        if (!el) return;
        var n = Number(count) || 0;
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.toggle('hidden', n <= 0);
    }

    function updateBadges() {
        ensureBadges();
        var total = (Number(state.counters.pending_requests) || 0) + (Number(state.counters.unread_messages) || 0);
        setBadge('navFriendsBadge', total);
        setBadge('pwaFriendsBadge', total);
    }

    /* ══════════════════════════════════════════════════════════════════════
       BOOTSTRAP: polling, auth changes, public API
    ══════════════════════════════════════════════════════════════════════ */

    // pg_cron is best-effort (some environments do not expose it), so the
    // browser also triggers the retention/volume cleanup — at most once every
    // six hours per session, exactly like the event-chat cleanup does.
    var CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
    var lastCleanupAt = 0;

    async function maybeCleanupRemote(force) {
        var now = Date.now();
        if (!force && now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
        lastCleanupAt = now;
        await rpc('cleanup_social_messages', {});
        await rpc('cleanup_event_chat_messages', {});
    }

    async function pollCounters() {
        if (!currentUser()) return;
        try {
            maybeCleanupRemote(false);
            await loadCounters();
            if (state.panelOpen && !state.chat) {
                // Keep the visible lists honest without stealing focus.
                await Promise.all([loadRequests(), loadConversations()]);
                updateTabCounts();
                if (state.activeTab === 'chats') renderChatsTab();
            }
        } catch (e) {
            console.warn('[Friends] counter poll failed', e);
        }
    }

    function startCounters() {
        if (state.countersTimer) clearInterval(state.countersTimer);
        state.countersTimer = setInterval(pollCounters, COUNTER_POLL_MS);
    }

    function onAuthChange() {
        var user = currentUser();
        stopChatLiveUpdates();
        // A fresh session (login, logout, account switch) must re-read the
        // friend lists before the map pins can rely on them again.
        mapStateLoadedAt = 0;
        if (!user) {
            state.friends = [];
            state.incomingRequests = [];
            state.outgoingRequests = [];
            state.conversations = [];
            state.counters = { pending_requests: 0, unread_messages: 0, friends: 0, conversations: 0 };
            closeFriendsPanel();
            var chat = document.getElementById('friendChatPanel');
            if (chat) chat.remove();
            updateBadges();
            return;
        }
        // Restore this account's mirror instantly (it is keyed by user id, so
        // two accounts on the same device never see each other's threads).
        var cache = readCache();
        if (cache) {
            state.friends = cache.friends || [];
            state.incomingRequests = cache.incomingRequests || [];
            state.outgoingRequests = cache.outgoingRequests || [];
            state.conversations = cache.conversations || [];
            state.counties = cache.counties || [];
            if (cache.counters) state.counters = cache.counters;
            if (cache.limits) state.limits = Object.assign({}, DEFAULT_LIMITS, cache.limits);
        }
        updateBadges();
        refreshAll(state.panelOpen);
        pollCounters();
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                ensureBadges();
                setTimeout(onAuthChange, 1200);
                startCounters();
            });
        } else {
            ensureBadges();
            setTimeout(onAuthChange, 1200);
            startCounters();
        }
        window.addEventListener('detectlab:authchange', function () { setTimeout(onAuthChange, 60); });
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                pollCounters();
                if (state.chat) refreshChatMessages(state.chat.id);
            }
        });
        // Buttons inside the detectorist map popups (friend request / accept /
        // send message). One delegated capture-phase listener survives every
        // Leaflet popup rebuild and every re-render of the map pins.
        document.addEventListener('click', onDetectorSocialAction, true);
        // No MutationObserver here on purpose: both nav entries live in
        // index.html, so ensureBadges() only has to run on boot, on auth
        // changes and before a badge update. Observing the whole body would
        // fire on every Leaflet frame for no benefit.
    }

    /* ── Public surface ────────────────────────────────────────────────── */

    window.openFriends = function (tab) { return openFriends(tab); };
    window._closeFriendsPanel = closeFriendsPanel;
    window._openFriendChat = openChatWithUser;
    window._openSocialConversation = openConversationById;
    window._createSocialGroup = function () { return openGroupModal(); };

    window.DetectLabFriends = {
        open: openFriends,
        close: closeFriendsPanel,
        refresh: refreshAll,
        isReady: function () { return !!currentUser(); },
        backendAvailable: function () { return state.backend === 'ok' || state.backend === 'unknown'; },
        backendState: function () { return state.backend; },
        getLimits: limits,
        loadLimits: loadLimits,
        getFriends: function () { return state.friends.slice(); },
        getFriendIds: function () { return state.friends.map(function (f) { return f.user_id; }); },
        getFriend: function (id) {
            return state.friends.filter(function (f) { return f.user_id === id; })[0] || null;
        },
        getCounters: function () { return Object.assign({}, state.counters); },
        getEventQuota: loadEventQuota,
        loadFriends: loadFriends,
        openChatWithUser: openChatWithUser,
        renderFriendPicker: renderFriendPicker,
        readFriendPicker: readFriendPicker,
        inviteFriendsToEvent: inviteFriendsToEvent,
        summariseInviteResults: summariseInviteResults,
        inviteSummaryText: inviteSummaryText,
        prepareAttachment: prepareAttachment,
        friendlyError: friendlyError,
        updateBadges: updateBadges,
        // Map pins (live + offline detectorists): the popup slot is filled with
        // the action that matches the relationship with that account.
        decorateDetectorPopup: decorateDetectorPopup,
        refreshDetectorPopups: refreshDetectorPopups,
        detectorRelation: function (userId) { return relationFor(userId).state; },
        cleanupRemote: function (force) { return maybeCleanupRemote(force !== false); }
    };
})();
