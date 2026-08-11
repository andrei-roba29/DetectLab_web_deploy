/* ══════════════════════════════════════════════
   DetectLab Events System ('events'/'evenimente')
   - Pin location -> Create event
   - Warrior helmet markers colored by expiration (Red <3d, Yellow 4-7d, Green >7d)
   - Manage Account -> Events / Events Panel
   - 1 event per day attendance limit check
   - 1-year creation limit check
   - Inquiries with 100-word text
   - In-app / windows notification for creator with accept/decline
   - Automatic chat creation on accept, with timer, photo/video attachments, and add-to-calendar (.ics)
   - Creator delete event & kick out attendees
══════════════════════════════════════════════ */
(function () {
    let eventsLayer = null;
    let eventsData = [];
    let activeChatEventId = null;
    let activeChatDeadlineTimer = null;

    // Helper: get current user
    function getCurrentUser() {
        return window._authUser ? window._authUser() : null;
    }

    // Helper: format date for display
    function formatDate(isoStr) {
        if (!isoStr) return '';
        try {
            var d = new Date(isoStr);
            return d.toLocaleString();
        } catch (e) {
            return isoStr;
        }
    }

    // Helper: get date string YYYY-MM-DD
    function getDateString(isoStr) {
        if (!isoStr) return '';
        try {
            var d = new Date(isoStr);
            return d.toISOString().split('T')[0];
        } catch (e) {
            return String(isoStr).substring(0, 10);
        }
    }

    // Storage fallback using localStorage if Supabase is offline/unconfigured
    function getLocalEvents() {
        try {
            return JSON.parse(localStorage.getItem('detectlab_events') || '[]');
        } catch (e) { return []; }
    }
    function saveLocalEvents(arr) {
        try { localStorage.setItem('detectlab_events', JSON.stringify(arr)); } catch (e) {}
    }

    function getLocalInquiries() {
        try { return JSON.parse(localStorage.getItem('detectlab_inquiries') || '[]'); } catch (e) { return []; }
    }
    function saveLocalInquiries(arr) {
        try { localStorage.setItem('detectlab_inquiries', JSON.stringify(arr)); } catch (e) {}
    }

    function getLocalAttendees() {
        try { return JSON.parse(localStorage.getItem('detectlab_attendees') || '[]'); } catch (e) { return []; }
    }
    function saveLocalAttendees(arr) {
        try { localStorage.setItem('detectlab_attendees', JSON.stringify(arr)); } catch (e) {}
    }

    function getLocalMessages() {
        try { return JSON.parse(localStorage.getItem('detectlab_chat_msgs') || '[]'); } catch (e) { return []; }
    }
    function saveLocalMessages(arr) {
        try { localStorage.setItem('detectlab_chat_msgs', JSON.stringify(arr)); } catch (e) {}
    }

    function getLocalChats() {
        try { return JSON.parse(localStorage.getItem('detectlab_event_chats') || '[]'); } catch (e) { return []; }
    }
    function saveLocalChats(arr) {
        try { localStorage.setItem('detectlab_event_chats', JSON.stringify(arr)); } catch (e) {}
    }

    function getLocalNotifications() {
        try { return JSON.parse(localStorage.getItem('detectlab_notifications') || '[]'); } catch (e) { return []; }
    }
    function saveLocalNotifications(arr) {
        try { localStorage.setItem('detectlab_notifications', JSON.stringify(arr)); } catch (e) {}
    }

    function genUuid() {
        try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) {}
        // fallback uuid v4
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }

    function getEventById(eventId) {
        var found = eventsData.find(function (e) { return e.id === eventId; });
        if (found) return found;
        var localEvents = getLocalEvents();
        for (var i = 0; i < localEvents.length; i++) {
            if (localEvents[i] && localEvents[i].id === eventId) return localEvents[i];
        }
        return null;
    }

    function isEventExpired(eventOrDate) {
        var iso = eventOrDate && eventOrDate.event_date ? eventOrDate.event_date : eventOrDate;
        if (!iso) return false;
        var deadline = new Date(iso).getTime();
        return !isNaN(deadline) && deadline <= Date.now();
    }

    function isActiveEventChat(chat) {
        return !!(chat && chat.event_id && chat.status !== 'expired' && !isEventExpired(chat.expires_at));
    }

    function upsertLocalChat(chat) {
        if (!chat || !chat.event_id) return;
        var chats = getLocalChats();
        var idx = chats.findIndex(function (item) { return item.event_id === chat.event_id; });
        if (idx === -1) {
            chats.push(chat);
        } else {
            chats[idx] = Object.assign({}, chats[idx], chat);
        }
        saveLocalChats(chats);
    }

    function removeLocalChatArtifacts(eventId) {
        if (!eventId) return;
        saveLocalChats(getLocalChats().filter(function (chat) { return chat.event_id !== eventId; }));
        saveLocalMessages(getLocalMessages().filter(function (msg) { return msg.event_id !== eventId; }));
    }

    function cleanupExpiredLocalChats() {
        var expiredMap = {};
        getLocalChats().forEach(function (chat) {
            if (!isActiveEventChat(chat)) expiredMap[chat.event_id] = true;
        });

        var knownEvents = eventsData.slice();
        getLocalEvents().forEach(function (ev) {
            if (!knownEvents.some(function (existing) { return existing.id === ev.id; })) {
                knownEvents.push(ev);
            }
        });
        knownEvents.forEach(function (ev) {
            if (ev && ev.id && isEventExpired(ev.event_date)) expiredMap[ev.id] = true;
        });

        var expiredEventIds = Object.keys(expiredMap);
        if (expiredEventIds.length === 0) return expiredEventIds;

        saveLocalChats(getLocalChats().filter(function (chat) {
            return expiredEventIds.indexOf(chat.event_id) === -1;
        }));
        saveLocalMessages(getLocalMessages().filter(function (msg) {
            return expiredEventIds.indexOf(msg.event_id) === -1;
        }));

        if (activeChatEventId && expiredEventIds.indexOf(activeChatEventId) !== -1) {
            window._closeEventChatModal();
        }

        return expiredEventIds;
    }

    function formatChatCountdown(targetIso, isRo) {
        var remaining = Math.max(0, new Date(targetIso).getTime() - Date.now());
        var totalSeconds = Math.floor(remaining / 1000);
        var days = Math.floor(totalSeconds / 86400);
        var hours = Math.floor((totalSeconds % 86400) / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;
        var parts = [];
        if (days > 0) parts.push(days + (isRo ? 'z' : 'd'));
        if (hours > 0 || days > 0) parts.push(hours + (isRo ? 'h' : 'h'));
        if (minutes > 0 || hours > 0 || days > 0) parts.push(minutes + (isRo ? 'm' : 'm'));
        if (days === 0) parts.push(seconds + (isRo ? 's' : 's'));
        return parts.join(' ');
    }

    function clearActiveChatDeadlineTimer() {
        if (activeChatDeadlineTimer) {
            clearInterval(activeChatDeadlineTimer);
            activeChatDeadlineTimer = null;
        }
    }

    window._closeEventChatModal = function () {
        clearActiveChatDeadlineTimer();
        activeChatEventId = null;
        var modal = document.getElementById('eventChatModal');
        if (modal) modal.remove();
    };

    async function cleanupExpiredRemoteChats() {
        if (!window.supabaseClient) return;

        try {
            var rpcRes = await window.supabaseClient.rpc('cleanup_expired_event_chats');
            if (!rpcRes || !rpcRes.error) return;
        } catch (e) {}

        try {
            var nowIso = new Date().toISOString();
            var expiredRes = await window.supabaseClient
                .from('event_chats')
                .select('event_id')
                .lte('expires_at', nowIso);
            if (expiredRes && !expiredRes.error && Array.isArray(expiredRes.data) && expiredRes.data.length > 0) {
                var expiredIds = expiredRes.data.map(function (row) { return row.event_id; }).filter(Boolean);
                if (expiredIds.length > 0) {
                    await window.supabaseClient.from('event_chat_messages').delete().in('event_id', expiredIds);
                    await window.supabaseClient.from('event_chats').delete().in('event_id', expiredIds);
                }
            }
        } catch (e) {}
    }

    var lastEventChatCleanupAt = 0;
    async function maybeCleanupExpiredEventChats(force) {
        cleanupExpiredLocalChats();
        var now = Date.now();
        if (!force && now - lastEventChatCleanupAt < 60000) return;
        lastEventChatCleanupAt = now;
        await cleanupExpiredRemoteChats();
    }

    async function fetchActiveEventChats(eventIds) {
        var chatMap = {};
        var hasFilter = Array.isArray(eventIds) && eventIds.length > 0;
        var nowIso = new Date().toISOString();

        try {
            if (window.supabaseClient) {
                var query = window.supabaseClient
                    .from('event_chats')
                    .select('*')
                    .eq('status', 'active')
                    .gt('expires_at', nowIso);
                if (hasFilter) query = query.in('event_id', eventIds);
                var res = await query;
                if (!res.error && Array.isArray(res.data)) {
                    res.data.forEach(function (chat) {
                        chatMap[chat.event_id] = chat;
                    });
                }
            }
        } catch (e) {}

        getLocalChats().forEach(function (chat) {
            if (!isActiveEventChat(chat)) return;
            if (hasFilter && eventIds.indexOf(chat.event_id) === -1) return;
            if (!chatMap[chat.event_id]) chatMap[chat.event_id] = chat;
        });

        return Object.keys(chatMap).map(function (eventId) { return chatMap[eventId]; });
    }

    async function fetchAttendeeCounts(eventIds) {
        var counts = {};
        var uniqueKeys = {};
        if (!Array.isArray(eventIds) || eventIds.length === 0) return counts;

        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient
                    .from('event_attendees')
                    .select('event_id,user_id')
                    .in('event_id', eventIds);
                if (!res.error && Array.isArray(res.data)) {
                    res.data.forEach(function (att) {
                        var key = att.event_id + '::' + att.user_id;
                        if (uniqueKeys[key]) return;
                        uniqueKeys[key] = true;
                        counts[att.event_id] = (counts[att.event_id] || 0) + 1;
                    });
                }
            }
        } catch (e) {}

        getLocalAttendees().forEach(function (att) {
            if (eventIds.indexOf(att.event_id) === -1) return;
            var key = att.event_id + '::' + (att.user_id || att.id);
            if (uniqueKeys[key]) return;
            uniqueKeys[key] = true;
            counts[att.event_id] = (counts[att.event_id] || 0) + 1;
        });

        return counts;
    }

    async function isUserAcceptedAttendee(eventId, userId) {
        if (!eventId || !userId) return false;

        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient
                    .from('event_attendees')
                    .select('id')
                    .eq('event_id', eventId)
                    .eq('user_id', userId)
                    .limit(1);
                if (!res.error && Array.isArray(res.data) && res.data.length > 0) return true;
            }
        } catch (e) {}

        return getLocalAttendees().some(function (att) {
            return att.event_id === eventId && att.user_id === userId;
        });
    }

    async function ensureEventChatExists(eventOrId, attendeeCount) {
        var ev = typeof eventOrId === 'string' ? getEventById(eventOrId) : eventOrId;
        if (!ev) return null;
        if (isEventExpired(ev.event_date) || Number(attendeeCount || 0) < 1) {
            removeLocalChatArtifacts(ev.id);
            return null;
        }

        var chat = {
            event_id: ev.id,
            expires_at: ev.event_date,
            status: 'active'
        };

        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient
                    .from('event_chats')
                    .upsert([chat], { onConflict: 'event_id' })
                    .select('*');
                if (!res.error && Array.isArray(res.data) && res.data[0]) {
                    chat = res.data[0];
                }
            }
        } catch (e) {}

        upsertLocalChat(chat);
        return chat;
    }

    async function syncEventChatState(eventId) {
        var ev = getEventById(eventId);
        if (!ev) return null;
        if (isEventExpired(ev.event_date)) {
            await expireEventChat(eventId, true);
            return null;
        }
        var counts = await fetchAttendeeCounts([eventId]);
        var attendeeCount = counts[eventId] || 0;
        if (attendeeCount < 1) {
            removeLocalChatArtifacts(eventId);
            try {
                if (window.supabaseClient) {
                    await window.supabaseClient.from('event_chat_messages').delete().eq('event_id', eventId);
                    await window.supabaseClient.from('event_chats').delete().eq('event_id', eventId);
                }
            } catch (e) {}
            return null;
        }
        return ensureEventChatExists(ev, attendeeCount);
    }

    async function expireEventChat(eventId, silent) {
        if (!eventId) return;
        removeLocalChatArtifacts(eventId);

        try {
            if (window.supabaseClient) {
                var rpcRes = await window.supabaseClient.rpc('cleanup_expired_event_chats');
                if (rpcRes && rpcRes.error) throw rpcRes.error;
            }
        } catch (e) {
            try {
                if (window.supabaseClient) {
                    await window.supabaseClient.from('event_chat_messages').delete().eq('event_id', eventId);
                    await window.supabaseClient.from('event_chats').delete().eq('event_id', eventId);
                }
            } catch (_) {}
        }

        if (activeChatEventId === eventId) window._closeEventChatModal();
        if (!silent) {
            var isRo = (window._currentLang && window._currentLang() === 'ro');
            alert(isRo ? 'Chat-ul evenimentului a expirat și a fost șters.' : 'The event chat has expired and was deleted.');
        }
    }

    function startEventChatDeadlineTimer(ev) {
        clearActiveChatDeadlineTimer();
        var expiredHandled = false;

        async function tick() {
            var timerEl = document.getElementById('chatTimer');
            if (!timerEl) {
                clearActiveChatDeadlineTimer();
                return;
            }

            var isRo = (window._currentLang && window._currentLang() === 'ro');
            if (isEventExpired(ev.event_date)) {
                timerEl.textContent = isRo ? '⌛ Chat expirat. Se șterge…' : '⌛ Chat expired. Deleting…';
                clearActiveChatDeadlineTimer();
                if (!expiredHandled) {
                    expiredHandled = true;
                    await expireEventChat(ev.id, true);
                    alert(isRo ? 'Deadline-ul evenimentului a trecut. Chat-ul a fost șters automat.' : 'The event deadline has passed. The chat was deleted automatically.');
                }
                return;
            }

            timerEl.textContent = (isRo ? '⏳ Chat activ încă ' : '⏳ Chat active for ') + formatChatCountdown(ev.event_date, isRo);
        }

        tick();
        activeChatDeadlineTimer = setInterval(tick, 1000);
    }

    // Detect missing event columns so we can retry against an older `events` schema.
    // PostgREST usually reports this as PGRST204 ("Could not find the 'pin_id'
    // column ... in the schema cache"), rather than PostgreSQL's 42703. The old
    // check handled only 42703, so the fallback was never used in the deployed
    // project and every new event was left in localStorage.
    function isMissingColumnError(err) {
        if (!err) return false;
        if (err.code === '42703' || err.code === 'PGRST204') return true;
        var msg = String(err.message || err.error_description || err.hint || '').toLowerCase();
        return msg.indexOf('does not exist') !== -1 ||
            (msg.indexOf('could not find') !== -1 && msg.indexOf('column') !== -1);
    }

    // Ensure an event exists on Supabase so foreign key constraints in event_inquiries don't fail.
    // Returns { ok: true } on full sync, { ok: true, partial: true } when synced with only the base
    // columns (live table is missing pin_id/category/creator_email), or { ok: false, reason, error }.
    async function ensureEventOnServer(ev) {
        if (!window.supabaseClient || !ev || !ev.id) {
            console.warn('[Events] Supabase client not available - event saved locally only');
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
            var res = await window.supabaseClient.from('events').upsert([payload], { onConflict: 'id' });
            if (res && res.error) {
                if (isMissingColumnError(res.error)) {
                    // Schema drift: the live `events` table is missing pin_id / category / creator_email.
                    // Retry with the base columns that exist on the older table so the event row
                    // actually lands in the DB and join requests can reference it.
                    console.warn('[Events] Server events table is missing newer columns; retrying with base columns. Apply migration 20260811010000_fix_events_schema_drift.sql for full sync. Detail:', res.error.message);
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
                    var retry = await window.supabaseClient.from('events').upsert([basePayload], { onConflict: 'id' });
                    if (retry && retry.error) {
                        console.error('[Events] Failed to save event to Supabase (base payload):', retry.error);
                        return { ok: false, reason: 'server-error', error: retry.error };
                    }
                    return { ok: true, partial: true };
                }
                console.error('[Events] Failed to save event to Supabase:', res.error);
                return { ok: false, reason: 'server-error', error: res.error };
            }
            return { ok: true };
        } catch (e) {
            console.error('[Events] ensureEventOnServer error:', e);
            return { ok: false, reason: 'exception', error: e };
        }
    }

    // Load all events from Supabase or fallback – merges remote + local so that
    // locally-created events are not wiped when the remote query returns empty.
    async function fetchEvents() {
        var remote = null;
        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient.from('events').select('*').order('event_date', { ascending: true });
                if (!res.error && Array.isArray(res.data)) {
                    remote = res.data;
                } else if (res && res.error) {
                    console.warn('Supabase fetchEvents error:', res.error);
                }
            }
        } catch (err) {
            console.warn('Supabase fetchEvents error, using local:', err);
        }
        var local = getLocalEvents();
        if (remote !== null) {
            // Merge: remote is authoritative, but keep local events that are not yet on server
            var remoteIds = {};
            remote.forEach(function(e){ remoteIds[e.id] = true; });
            var merged = remote.slice();
            local.forEach(function(e){
                if (!remoteIds[e.id]) {
                    merged.push(e);
                    // Proactively sync local events to server if user is logged in
                    ensureEventOnServer(e);
                }
            });
            eventsData = merged;
            saveLocalEvents(eventsData);
        } else {
            eventsData = local;
        }
        refreshEventsMap();
        return eventsData;
    }

    // Initialize Events Layer on Map
    function initEventsLayer(map) {
        if (!map) return;
        if (!eventsLayer) {
            eventsLayer = L.layerGroup().addTo(map);
        }
        fetchEvents();
    }

    // Calculate expiration color
    // red if <3 days (72h), yellow if 4-7 days (72h-168h), green if >7 days (>168h)
    function getEventColor(eventDateStr) {
        try {
            var now = new Date().getTime();
            var evTime = new Date(eventDateStr).getTime();
            var diffHours = (evTime - now) / (1000 * 60 * 60);
            if (diffHours < 72) return '#C42B2B'; // Red
            if (diffHours <= 168) return '#E6A817'; // Yellow
            return '#2E9E4F'; // Green
        } catch (e) {
            return '#2E9E4F';
        }
    }

    function refreshEventsMap() {
        var map = window._dlMap || window.map;
        if (!map || !eventsLayer) return;
        eventsLayer.clearLayers();

        eventsData.forEach(function (ev) {
            var color = getEventColor(ev.event_date);
            var helmetSvg = '<svg width="28" height="28" viewBox="0 0 24 24" fill="' + color + '" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M12 2C8 2 5 5 5 9v4c0 3 2 5 4 6v2h6v-2c2-1 4-3 4-6V9c0-4-3-7-7-7z"/>' +
                '<path d="M8 11h8" stroke="#fff" stroke-width="1.5"/>' +
                '<path d="M12 8v6" stroke="#fff" stroke-width="1.5"/>' +
                '<path d="M10 14l2 3 2-3" stroke="#fff" stroke-width="1.5"/>' +
                '</svg>';

            var icon = L.divIcon({
                html: '<div style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); cursor: pointer;">' + helmetSvg + '</div>',
                className: 'warrior-helmet-marker',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            var marker = L.marker([ev.latitude, ev.longitude], { icon: icon });
            // Fresh popup HTML evaluated on open
            marker.bindPopup(function () { return createEventPopupHtml(ev); });
            eventsLayer.addLayer(marker);
        });
    }

    function createEventPopupHtml(ev) {
        var user = getCurrentUser();
        var isCreator = user && (user.id === ev.creator_id || (user.email && ev.creator_email && user.email === ev.creator_email));
        var color = getEventColor(ev.event_date);
        var dateStr = formatDate(ev.event_date);

        var alreadyInquired = false;
        var alreadyAttending = false;
        if (user && !isCreator) {
            var localInqs = getLocalInquiries();
            alreadyInquired = localInqs.some(function(i) { return i.event_id === ev.id && i.user_id === user.id && i.status !== 'declined'; });
            var localAtts = getLocalAttendees();
            alreadyAttending = localAtts.some(function(a) { return a.event_id === ev.id && a.user_id === user.id; });
        }

        var html = '<div style="min-width: 220px; font-family: \'Outfit\', sans-serif;">' +
            '<div style="font-weight: 700; font-size: 0.95rem; color: #F5F0EB; margin-bottom: 4px;">' + escapeHtml(ev.title) + '</div>' +
            '<div style="font-size: 0.76rem; color: rgba(184,216,240,0.8); margin-bottom: 6px;">' + escapeHtml(ev.description || '') + '</div>' +
            '<div style="font-size: 0.72rem; color: ' + color + '; font-weight: 600; margin-bottom: 4px;">📅 ' + dateStr + '</div>' +
            '<div style="font-size: 0.7rem; color: rgba(245,240,235,0.6); margin-bottom: 8px;">👤 Creator: ' + escapeHtml(ev.creator_name || 'User') + (ev.max_attendees ? ' | Max: ' + ev.max_attendees : '') + '</div>';

        if (isCreator) {
            html += '<button type="button" onclick="window._manageEvent(\'' + ev.id + '\')" style="width: 100%; background: #6B3FA0; border: none; border-radius: 4px; color: #fff; font-size: 0.75rem; padding: 6px; cursor: pointer; font-weight: 600;">Gestionează Evenimentul / Manage Event</button>';
        } else if (user) {
            if (alreadyAttending) {
                html += '<div style="width: 100%; background: rgba(46,158,79,0.2); border: 1px solid rgba(46,158,79,0.5); border-radius: 4px; color: #2E9E4F; font-size: 0.75rem; padding: 5px; text-align: center; font-weight: 600;">✓ Deja participant / Already attending</div>';
            } else if (alreadyInquired) {
                html += '<div style="width: 100%; background: rgba(232,119,42,0.15); border: 1px solid rgba(232,119,42,0.4); border-radius: 4px; color: #E8772A; font-size: 0.75rem; padding: 5px; text-align: center; font-weight: 600;">⏳ Cerere trimisă / Request pending</div>';
            } else {
                html += '<button type="button" onclick="window._openInquiryModal(\'' + ev.id + '\')" style="width: 100%; background: #E8772A; border: none; border-radius: 4px; color: #fff; font-size: 0.75rem; padding: 6px; cursor: pointer; font-weight: 600;">Trimite Cerere Participare / Send Inquiry</button>';
            }
        } else {
            html += '<div style="font-size: 0.7rem; color: #ff8a8a;">Autentifică-te pentru a participa. / Log in to attend.</div>';
        }
        html += '</div>';
        return html;
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Hook into coordinate popup in map-app.js to add "Create Event" button
    window._augmentCoordPopup = function (popupDiv, lat, lng) {
        if (!popupDiv) return;
        if (popupDiv.querySelector && popupDiv.querySelector('.pin-create-event-btn')) return;
        var pinId = popupDiv.getAttribute ? (popupDiv.getAttribute('data-pin-id') || '') : '';
        var div = document.createElement('div');
        div.style.cssText = 'margin-top: 6px;';
        div.innerHTML = '<button type="button" class="coord-popup-create-event" data-pin-id="' + String(pinId).replace(/"/g,'&quot;') + '" data-lat="' + lat + '" data-lng="' + lng + '" style="width: 100%; background: rgba(107,63,160,0.35); border: 1px solid rgba(196,160,240,0.6); border-radius: 4px; color: #c4a0f0; font-size: 0.76rem; font-family: \'Outfit\', sans-serif; padding: 5px 0; cursor: pointer; font-weight: 600;">Creează un eveniment</button>';
        var btn = div.querySelector('button');
        btn.addEventListener('click', function (e) {
            if (e) { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); if (window.L && L.DomEvent) try { L.DomEvent.stop(e); } catch(_){} }
            var curUser = getCurrentUser();
            if (!curUser) {
                if (typeof window.openAuth === 'function') window.openAuth('login');
                return;
            }
            openCreateEventModal(lat, lng, pinId || null, '');
            var m = window._dlMap || window.map;
            if (m) m.closePopup();
        });
        popupDiv.appendChild(div);
    };

    function openCreateEventModal(lat, lng, pinId, pinTitle) {
        var existing = document.getElementById('createEventModal');
        if (existing) existing.remove();

        var isRo = (window._currentLang && window._currentLang() === 'ro');
        var pinLabel = pinTitle ? escapeHtml(pinTitle) : (pinId ? ('Pin ' + pinId) : 'Location Pin');

        var modal = document.createElement('div');
        modal.id = 'createEventModal';
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 4000; background: rgba(4,10,22,0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px;';
        modal.innerHTML = '<div style="background: rgba(10,20,42,0.98); border: 1px solid rgba(184,216,240,0.25); border-radius: 12px; width: 100%; max-width: 440px; padding: 20px; color: #F5F0EB; font-family: \'Outfit\', sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,0.6);">' +
            '<h3 style="margin-top:0; font-size:1.1rem; color:var(--sky); font-family:\'Cinzel\',serif;">' + (isRo ? 'Creează un eveniment din acest Pin' : 'Create Event from this Pin') + '</h3>' +
            '<div style="background: rgba(107,63,160,0.2); border: 1px solid rgba(196,160,240,0.4); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 0.78rem; color: #E8D0FF;">' +
            '📍 <strong>' + (isRo ? 'Pin asociat:' : 'Associated Pin:') + '</strong> ' + pinLabel + ' (' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + ')' +
            '</div>' +
            '<div style="margin-bottom:10px;"><label style="display:block; font-size:0.76rem; margin-bottom:4px;">' + (isRo ? 'Titlu eveniment *' : 'Event Title *') + '</label><input type="text" id="ceTitle" placeholder="' + (isRo ? 'Ex: Căutare comori în pădure' : 'Ex: Forest metal detecting') + '" style="width:100%; padding:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.25); border-radius:6px; color:#F5F0EB; font-size:0.85rem;" autocomplete="off"></div>' +
            '<div style="margin-bottom:10px;"><label style="display:block; font-size:0.76rem; margin-bottom:4px;">' + (isRo ? 'Descriere' : 'Description') + '</label><textarea id="ceDesc" placeholder="' + (isRo ? 'Detalii despre întâlnire...' : 'Meeting details...') + '" style="width:100%; height:55px; padding:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.25); border-radius:6px; color:#F5F0EB; font-size:0.85rem; resize:none;"></textarea></div>' +
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">' +
            '<div><label style="display:block; font-size:0.76rem; margin-bottom:4px;">' + (isRo ? 'Dată *' : 'Event Date *') + '</label><input type="date" id="ceDate" style="width:100%; padding:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.25); border-radius:6px; color:#F5F0EB; font-size:0.85rem;"></div>' +
            '<div><label style="display:block; font-size:0.76rem; margin-bottom:4px;">' + (isRo ? 'Oră' : 'Event Time') + '</label><input type="time" id="ceTime" style="width:100%; padding:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.25); border-radius:6px; color:#F5F0EB; font-size:0.85rem;"></div>' +
            '</div>' +
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">' +
            '<div><label style="display:block; font-size:0.76rem; margin-bottom:4px;">' + (isRo ? 'Categorie' : 'Category') + '</label><select id="ceCategory" style="width:100%; padding:8px; background:rgba(10,20,42,0.95); border:1px solid rgba(184,216,240,0.25); border-radius:6px; color:#F5F0EB; font-size:0.82rem;"><option value="Metal Detecting">Metal Detecting</option><option value="Treasure Hunt">Treasure Hunt</option><option value="Archaeology">Archaeology</option><option value="Community Meetup">Community Meetup</option><option value="Other">Other</option></select></div>' +
            '<div><label style="display:block; font-size:0.76rem; margin-bottom:4px;">' + (isRo ? 'Max participanți' : 'Max attendees') + '</label><input type="number" id="ceMax" min="1" placeholder="' + (isRo ? 'Fără limită' : 'No limit') + '" style="width:100%; padding:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.25); border-radius:6px; color:#F5F0EB; font-size:0.85rem;"></div>' +
            '</div>' +
            '<div id="ceError" style="font-size:0.76rem; color:#ff8a8a; margin-bottom:10px;"></div>' +
            '<div style="display:flex; gap:10px;"><button type="button" id="ceSubmitBtn" style="flex:1; background:#6B3FA0; border:none; border-radius:6px; color:#fff; font-weight:600; padding:10px; cursor:pointer;">' + (isRo ? 'Salvează Evenimentul' : 'Save Event') + '</button><button type="button" id="ceCancelBtn" style="background:rgba(255,255,255,0.1); border:none; border-radius:6px; color:#F5F0EB; padding:10px; cursor:pointer;">' + (isRo ? 'Anulează' : 'Cancel') + '</button></div>' +
            '</div>';

        document.body.appendChild(modal);

        modal.querySelector('#ceCancelBtn').addEventListener('click', function () { modal.remove(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

        modal.querySelector('#ceSubmitBtn').addEventListener('click', async function () {
            var title = document.getElementById('ceTitle').value.trim();
            var desc = document.getElementById('ceDesc').value.trim();
            var dateVal = document.getElementById('ceDate').value;
            var timeVal = document.getElementById('ceTime').value || '10:00';
            var categoryVal = document.getElementById('ceCategory').value;
            var maxStr = document.getElementById('ceMax').value;
            var errEl = document.getElementById('ceError');

            if (!title || !dateVal) {
                errEl.textContent = isRo ? 'Completați titlul și data.' : 'Please fill in title and date.';
                return;
            }

            var fullDateStr = dateVal + 'T' + timeVal + ':00';
            var eventDate = new Date(fullDateStr);
            if (isNaN(eventDate.getTime())) {
                eventDate = new Date(dateVal);
            }

            var now = new Date();
            var oneYearFromNow = new Date();
            oneYearFromNow.setFullYear(now.getFullYear() + 1);

            if (eventDate > oneYearFromNow) {
                errEl.textContent = isRo
                    ? 'Evenimentele nu pot fi create mai târziu de 1 an de la data curentă.'
                    : 'Events cannot be created later than 1 year from now.';
                return;
            }

            if (eventDate <= now) {
                errEl.textContent = isRo ? 'Data evenimentului trebuie să fie în viitor.' : 'Event date must be in the future.';
                return;
            }

            var user = getCurrentUser();
            if (!user || !user.id) {
                errEl.textContent = isRo ? 'Trebuie să fii autentificat.' : 'You must be logged in.';
                return;
            }
            var submitBtn = document.getElementById('ceSubmitBtn');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = isRo ? 'Se salvează…' : 'Saving…'; }

            var newEvent = {
                id: genUuid(),
                pin_id: pinId || null,
                creator_id: user.id,
                creator_name: (user.name || (user.email ? user.email.split('@')[0] : 'User')),
                creator_email: user.email || null,
                title: title,
                description: desc,
                category: categoryVal,
                latitude: Number(lat),
                longitude: Number(lng),
                event_date: eventDate.toISOString(),
                max_attendees: maxStr ? parseInt(maxStr, 10) : null,
                created_at: new Date().toISOString()
            };

            var savedToServer = await ensureEventOnServer(newEvent);

            eventsData.push(newEvent);
            saveLocalEvents(eventsData);
            if (window.updatePinWithEvent && pinId) {
                window.updatePinWithEvent(pinId, newEvent);
            }
            refreshEventsMap();
            modal.remove();

            if (savedToServer && savedToServer.ok) {
                alert(isRo ? 'Eveniment creat cu succes!' : 'Event created successfully!');
                if (savedToServer.partial) {
                    console.warn('[Events] Event synced without pin_id/category/creator_email (older server schema).');
                }
            } else {
                alert(isRo
                    ? 'Eveniment creat local. Alți utilizatori nu îl vor vedea până când conexiunea la server nu este restabilită.'
                    : 'Event created locally. Other users will not see it until server connection is restored.');
            }
        });
    }

    // Global Pin Deletion Function
    window.deletePin = async function (pinId, btnElement) {
        if (!pinId) return;

        if (btnElement) {
            btnElement.disabled = true;
            btnElement.textContent = 'Deleting…';
        }

        var map = window._dlMap || window.map;

        // 1. Remove from window._detectLabPins
        if (window._detectLabPins) {
            var idx = window._detectLabPins.findIndex(function (p) { return String(p.id) === String(pinId); });
            if (idx !== -1) {
                var pinObj = window._detectLabPins[idx];
                if (pinObj.marker && map && map.hasLayer(pinObj.marker)) {
                    map.removeLayer(pinObj.marker);
                }
                window._detectLabPins.splice(idx, 1);
            }
        }

        // 2. Remove marker from savedLocationsLayer
        if (window._savedLocationsLayer) {
            window._savedLocationsLayer.eachLayer(function (layer) {
                if (layer.pinId === pinId || (layer.options && layer.options.pinId === pinId) || layer._pinId === pinId) {
                    window._savedLocationsLayer.removeLayer(layer);
                }
            });
        }

        // 3. Remove active temporary coordMarker
        if (window._activeCoordMarker && (window._activeCoordMarker.pinId === pinId || window._activeCoordMarker._pinId === pinId)) {
            if (map) map.removeLayer(window._activeCoordMarker);
            window._activeCoordMarker = null;
        }

        // 4. Remove from localStorage
        try {
            var local = JSON.parse(localStorage.getItem('detectlab_saved_pins') || '[]');
            var filtered = local.filter(function (p) { return String(p.id) !== String(pinId); });
            localStorage.setItem('detectlab_saved_pins', JSON.stringify(filtered));
        } catch (e) {}

        // 5. Remove from Supabase if DB row exists
        try {
            if (window.supabaseClient && pinId && !String(pinId).startsWith('temp_')) {
                await window.supabaseClient.from('saved_coordinates').delete().eq('id', pinId);
            }
        } catch (err) {
            console.warn('Could not delete pin from Supabase backend:', err);
        }

        // 6. Close active popup and notify
        if (map) map.closePopup();
        console.log('[DetectLab] Pin deleted successfully:', pinId);
    };

    // Update pin when event is linked
    window.updatePinWithEvent = function (pinId, event) {
        if (!pinId) return;
        var pins = window._detectLabPins || [];
        var pinObj = pins.find(function (p) { return String(p.id) === String(pinId); });
        if (pinObj) {
            pinObj.has_event = true;
            pinObj.event_data = event;
        }
        if (typeof window.refreshEventsMap === 'function') {
            window.refreshEventsMap();
        }
    };

    // Global Event Delegation for Delete & Create Event buttons
    function _handlePinDelegation(e) {
        // Delete Pin
        var delBtn = e.target && e.target.closest ? e.target.closest('.delete-pin-btn, .pin-delete-btn, .coord-popup-delete') : null;
        if (delBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (window.L && L.DomEvent) try { L.DomEvent.stop(e); } catch(_){}
            var pinId = (delBtn.getAttribute('data-pin-id') || delBtn.dataset.pinId || '').trim();
            if (!pinId) {
                var pinWrap = delBtn.closest ? delBtn.closest('[data-pin-id]') : null;
                if (pinWrap) pinId = pinWrap.getAttribute('data-pin-id') || '';
            }
            if (confirm('Sigur doriți să ștergeți acest pin? / Are you sure you want to delete this pin?')) {
                window.deletePin(pinId, delBtn);
            }
            return;
        }

        // Create Event from Pin
        var createBtn = e.target && e.target.closest ? e.target.closest('.pin-create-event-btn, .coord-popup-create-event') : null;
        if (createBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (window.L && L.DomEvent) try { L.DomEvent.stop(e); } catch(_){}
            var pinId2 = (createBtn.getAttribute('data-pin-id') || createBtn.dataset.pinId || '').trim();
            if (!pinId2) {
                var pinWrap2 = createBtn.closest ? createBtn.closest('[data-pin-id]') : null;
                if (pinWrap2) pinId2 = pinWrap2.getAttribute('data-pin-id') || '';
            }
            var lat2 = parseFloat(createBtn.getAttribute('data-lat') || createBtn.dataset.lat || '');
            var lng2 = parseFloat(createBtn.getAttribute('data-lng') || createBtn.dataset.lng || '');
            var title2 = createBtn.getAttribute('data-title') || createBtn.dataset.title || '';
            if (!isFinite(lat2) || !isFinite(lng2)) {
                var pinWrap3 = createBtn.closest ? createBtn.closest('.pin-popup, .map-place-popup, .coord-popup-container') : null;
                if (pinWrap3) {
                    var fallbackId = pinWrap3.getAttribute('data-pin-id') || pinId2;
                    if (fallbackId && window._detectLabPins) {
                        var found = window._detectLabPins.find(function(p){ return String(p.id)===String(fallbackId); });
                        if (found) { lat2 = Number(found.lat); lng2 = Number(found.lng); if (!title2 && found.title) title2 = found.title; pinId2 = found.id; }
                    }
                }
            }
            if (!isFinite(lat2) || !isFinite(lng2)) return;
            var user2 = getCurrentUser();
            if (!user2) {
                if (typeof window.openAuth === 'function') window.openAuth('login');
                return;
            }
            openCreateEventModal(lat2, lng2, pinId2 || null, title2 || '');
            var m2 = window._dlMap || window.map;
            if (m2) m2.closePopup();
            return;
        }
    }
    document.addEventListener('click', _handlePinDelegation, true);
    document.addEventListener('click', _handlePinDelegation, false);

    window.getEventsData = function () { return eventsData; };
    window.openCreateEventModal = openCreateEventModal;

    // Check attendance 1-event-per-day rule
    async function checkAttendanceConflict(userId, eventDateIso, excludeEventId) {
        var targetDateStr = getDateString(eventDateIso);
        var isRo = (window._currentLang && window._currentLang() === 'ro');

        var attendances = [];
        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient.from('event_attendees').select('event_id').eq('user_id', userId);
                if (!res.error && res.data) {
                    attendances = res.data;
                }
            }
        } catch (e) {}

        if (attendances.length === 0) {
            attendances = getLocalAttendees().filter(function(a) { return a.user_id === userId; });
        }

        for (var i = 0; i < attendances.length; i++) {
            var att = attendances[i];
            if (excludeEventId && att.event_id === excludeEventId) continue;
            var ev = eventsData.find(function(e) { return e.id === att.event_id; });
            if (ev) {
                if (excludeEventId && ev.id === excludeEventId) continue;
                var evDateStr = getDateString(ev.event_date);
                if (evDateStr === targetDateStr) {
                    return isRo
                        ? 'Deja participi la un eveniment în ' + evDateStr
                        : 'You are already attending to an event on ' + evDateStr;
                }
            }
        }
        return null;
    }

    // Open Inquiry Modal
    window._openInquiryModal = function (eventId) {
        var ev = eventsData.find(function (e) { return e.id === eventId; });
        if (!ev) return;
        var user = getCurrentUser();
        if (!user) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }

        var existing = document.getElementById('inquiryModal');
        if (existing) existing.remove();

        var isRo = (window._currentLang && window._currentLang() === 'ro');

        var modal = document.createElement('div');
        modal.id = 'inquiryModal';
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 4000; background: rgba(4,10,22,0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px;';
        modal.innerHTML = '<div style="background: rgba(10,20,42,0.98); border: 1px solid rgba(184,216,240,0.25); border-radius: 12px; width: 100%; max-width: 420px; padding: 20px; color: #F5F0EB; font-family: \'Outfit\', sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,0.6);">' +
            '<h3 style="margin-top:0; font-size:1.1rem; color:var(--sky); font-family:\'Cinzel\',serif;">' + (isRo ? 'Cerere de participare' : 'Attendance Inquiry') + '</h3>' +
            '<div style="font-size:0.8rem; margin-bottom:8px;"><strong>' + escapeHtml(ev.title) + '</strong></div>' +
            '<div style="font-size:0.75rem; opacity:0.7; margin-bottom:12px;">' + (isRo ? 'Scrie un mesaj scurt (max 100 cuvinte) către creator:' : 'Write a short message (max 100 words) to the creator:') + '</div>' +
            '<textarea id="inqMessage" placeholder="' + (isRo ? 'Salut, aș dori să particip...' : 'Hi, I would like to attend...') + '" style="width:100%; height:90px; padding:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.25); border-radius:6px; color:#F5F0EB; font-size:0.85rem; resize:none; margin-bottom:12px;"></textarea>' +
            '<div id="inqError" style="font-size:0.76rem; color:#ff8a8a; margin-bottom:10px;"></div>' +
            '<div style="display:flex; gap:10px;"><button type="button" id="inqSubmitBtn" style="flex:1; background:#E8772A; border:none; border-radius:6px; color:#fff; font-weight:600; padding:10px; cursor:pointer;">' + (isRo ? 'Trimite Cererea' : 'Send Inquiry') + '</button><button type="button" id="inqCancelBtn" style="background:rgba(255,255,255,0.1); border:none; border-radius:6px; color:#F5F0EB; padding:10px; cursor:pointer;">' + (isRo ? 'Anulează' : 'Cancel') + '</button></div>' +
            '</div>';

        document.body.appendChild(modal);

        modal.querySelector('#inqCancelBtn').addEventListener('click', function () { modal.remove(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

        modal.querySelector('#inqSubmitBtn').addEventListener('click', async function () {
            var msgText = document.getElementById('inqMessage').value.trim();
            var errEl = document.getElementById('inqError');
            var submitBtn = document.getElementById('inqSubmitBtn');

            var words = msgText.split(/\s+/).filter(Boolean);
            if (words.length > 100) {
                errEl.textContent = isRo ? 'Mesajul nu poate depăși 100 de cuvinte.' : 'Message cannot exceed 100 words.';
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = isRo ? 'Se trimite…' : 'Sending…';
            }

            // ── Duplicate inquiry check: one request per user per event ──
            var alreadyRequested = false;
            try {
                if (window.supabaseClient) {
                    var dupRes = await window.supabaseClient.from('event_inquiries').select('id,status').eq('event_id', ev.id).eq('user_id', user.id);
                    if (!dupRes.error && dupRes.data && dupRes.data.length > 0) {
                        var activeInq = dupRes.data.some(function(d){ return d.status !== 'declined'; });
                        if (activeInq) alreadyRequested = true;
                    }
                }
            } catch (e) {}
            if (!alreadyRequested) {
                var localDup = getLocalInquiries().filter(function(i) { return i.event_id === ev.id && i.user_id === user.id && i.status !== 'declined'; });
                if (localDup.length > 0) alreadyRequested = true;
            }

            // Check if already an accepted attendee
            var alreadyAttendee = false;
            try {
                if (window.supabaseClient) {
                    var attRes = await window.supabaseClient.from('event_attendees').select('id').eq('event_id', ev.id).eq('user_id', user.id);
                    if (!attRes.error && attRes.data && attRes.data.length > 0) alreadyAttendee = true;
                }
            } catch (e) {}
            if (!alreadyAttendee) {
                var localAttDup = getLocalAttendees().filter(function(a) { return a.event_id === ev.id && a.user_id === user.id; });
                if (localAttDup.length > 0) alreadyAttendee = true;
            }
            if (alreadyAttendee) {
                errEl.textContent = isRo ? 'Deja ești participant la acest eveniment.' : 'You are already an attendee of this event.';
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isRo ? 'Trimite Cererea' : 'Send Inquiry'; }
                return;
            }
            if (alreadyRequested) {
                errEl.textContent = isRo ? 'Ai deja o cerere trimisă pentru acest eveniment.' : 'You have already sent a request for this event.';
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isRo ? 'Trimite Cererea' : 'Send Inquiry'; }
                return;
            }

            // Check 1-event-per-day rule
            var conflictMsg = await checkAttendanceConflict(user.id, ev.event_date);
            if (conflictMsg) {
                errEl.textContent = conflictMsg;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isRo ? 'Trimite Cererea' : 'Send Inquiry'; }
                return;
            }

            // Ensure parent event exists on Supabase so foreign key constraints in event_inquiries don't fail
            var evSync = await ensureEventOnServer(ev);

            var inquiryId = genUuid();
            var inquiry = {
                id: inquiryId,
                event_id: ev.id,
                user_id: user.id,
                user_name: user.name || (user.email ? user.email.split('@')[0] : 'User'),
                message: msgText,
                status: 'pending',
                created_at: new Date().toISOString()
            };

            var notification = {
                id: genUuid(),
                user_id: ev.creator_id,
                event_id: ev.id,
                inquiry_id: inquiryId,
                sender_id: user.id,
                sender_name: inquiry.user_name,
                message: msgText,
                read: false,
                created_at: new Date().toISOString()
            };

            var hasServerClient = !!window.supabaseClient;
            var remoteInquiryOk = false;
            try {
                if (window.supabaseClient) {
                    var inqRes = await window.supabaseClient.from('event_inquiries').insert([inquiry]);
                    if (inqRes && inqRes.error) {
                        console.error('Supabase insert inquiry failed:', inqRes.error);
                    } else {
                        remoteInquiryOk = true;
                    }
                    var notifRes = await window.supabaseClient.from('event_notifications').insert([notification]);
                    if (notifRes && notifRes.error) {
                        console.error('Supabase insert notification failed:', notifRes.error);
                        if (remoteInquiryOk) {
                            console.warn('[Events] The request was stored but the creator notification row failed; the creator can still see it via Manage Event.');
                        }
                    }
                }
            } catch (err) {
                console.warn('Supabase inquiry error, storing locally:', err);
            }

            var localInqs = getLocalInquiries();
            localInqs.push(inquiry);
            saveLocalInquiries(localInqs);

            var localNotifs = getLocalNotifications();
            localNotifs.push(notification);
            saveLocalNotifications(localNotifs);

            modal.remove();
            if (remoteInquiryOk) {
                alert(isRo ? 'Cererea a fost trimisă cu succes!' : 'Inquiry sent successfully!');
            } else if (!hasServerClient) {
                alert(isRo
                    ? '⚠️ Cererea a fost salvată doar pe acest dispozitiv — fără conexiune la server, creatorul nu o va primi. Reîncearcă când conexiunea este restabilită.'
                    : '⚠️ Your request was only saved on this device — without a server connection the creator will not receive it. Try again once the connection is restored.');
            } else if (evSync && !evSync.ok) {
                alert(isRo
                    ? '⚠️ Evenimentul nu a putut fi sincronizat pe server, deci cererea a fost salvată doar local și creatorul nu o va primi. Verifică consola browserului (F12).'
                    : '⚠️ The event could not be synced to the server, so your request was only saved locally and the creator will not receive it. Check the browser console (F12).');
            } else {
                alert(isRo
                    ? '⚠️ Cererea NU a putut fi salvată pe server și a fost păstrată doar local. Verifică consola browserului (F12) pentru detalii.'
                    : '⚠️ Your request could NOT be saved to the server and was kept locally only. Check the browser console (F12) for details.');
            }
            refreshEventsMap();
        });
    };

    // Manage Event / Creator Panel
    window._manageEvent = function (eventId) {
        var ev = eventsData.find(function (e) { return e.id === eventId; });
        if (!ev) return;
        var isRo = (window._currentLang && window._currentLang() === 'ro');

        var existing = document.getElementById('manageEventModal');
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = 'manageEventModal';
        modal.setAttribute('data-event-id', eventId);
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 4000; background: rgba(4,10,22,0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px;';
        
        var modalBox = document.createElement('div');
        modalBox.style.cssText = 'background: rgba(10,20,42,0.98); border: 1px solid rgba(184,216,240,0.25); border-radius: 12px; width: 100%; max-width: 500px; max-height: 85vh; overflow-y: auto; padding: 20px; color: #F5F0EB; font-family: \'Outfit\', sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,0.6);';
        
        modalBox.innerHTML = '<h3 style="margin-top:0; font-size:1.1rem; color:var(--sky); font-family:\'Cinzel\',serif;">' + escapeHtml(ev.title) + '</h3>' +
            '<div style="font-size:0.78rem; opacity:0.7; margin-bottom:12px;">📅 ' + formatDate(ev.event_date) + '</div>' +
            '<div style="display:flex; gap:10px; margin-bottom:16px;">' +
            '<button type="button" id="meDeleteBtn" style="background:rgba(196,43,43,0.3); border:1px solid rgba(196,43,43,0.6); border-radius:6px; color:#ff8a8a; padding:6px 12px; font-size:0.76rem; cursor:pointer; font-weight:600;">' + (isRo ? 'Șterge Evenimentul' : 'Delete Event') + '</button>' +
            '<button type="button" id="meCloseBtn" style="background:rgba(255,255,255,0.1); border:none; border-radius:6px; color:#F5F0EB; padding:6px 12px; font-size:0.76rem; cursor:pointer;">' + (isRo ? 'Închide' : 'Close') + '</button>' +
            '</div>' +
            '<h4 style="font-size:0.9rem; border-bottom:1px solid rgba(184,216,240,0.15); padding-bottom:4px; margin-bottom:8px;">' + (isRo ? 'Participanți & Cereri' : 'Attendees & Inquiries') + '</h4>' +
            '<div id="meAttendeesList">Se încarcă…</div>';

        modal.appendChild(modalBox);
        document.body.appendChild(modal);

        modal.querySelector('#meCloseBtn').addEventListener('click', function () { modal.remove(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

        modal.querySelector('#meDeleteBtn').addEventListener('click', async function () {
            if (!confirm(isRo ? 'Sigur doriți să ștergeți acest eveniment?' : 'Are you sure you want to delete this event?')) return;
            try {
                if (window.supabaseClient) {
                    await window.supabaseClient.from('events').delete().eq('id', ev.id);
                }
            } catch (err) {}
            eventsData = eventsData.filter(function (e) { return e.id !== ev.id; });
            saveLocalEvents(eventsData);
            removeLocalChatArtifacts(ev.id);
            refreshEventsMap();
            modal.remove();
        });

        loadManageEventDetails(ev.id);
    };

    async function loadManageEventDetails(eventId) {
        var listEl = document.getElementById('meAttendeesList');
        if (!listEl) return;
        var isRo = (window._currentLang && window._currentLang() === 'ro');

        var inquiries = [];
        var attendees = [];
        try {
            if (window.supabaseClient) {
                var resInq = await window.supabaseClient.from('event_inquiries').select('*').eq('event_id', eventId);
                if (!resInq.error && Array.isArray(resInq.data)) inquiries = resInq.data;
                var resAtt = await window.supabaseClient.from('event_attendees').select('*').eq('event_id', eventId);
                if (!resAtt.error && Array.isArray(resAtt.data)) attendees = resAtt.data;
            }
        } catch (e) {
            console.warn('loadManageEventDetails remote fetch error:', e);
        }

        // Merge remote + local so nothing is lost
        var inqMap = {};
        inquiries.forEach(function(i) { inqMap[i.id] = i; });
        var localInqs = getLocalInquiries().filter(function(i) { return i.event_id === eventId; });
        localInqs.forEach(function(i) {
            if (!inqMap[i.id]) {
                inquiries.push(i);
                inqMap[i.id] = i;
            }
        });

        var attMap = {};
        attendees.forEach(function(a) { attMap[a.id] = a; });
        var localAtts = getLocalAttendees().filter(function(a) { return a.event_id === eventId; });
        localAtts.forEach(function(a) {
            if (!attMap[a.id]) {
                attendees.push(a);
                attMap[a.id] = a;
            }
        });

        var html = '';
        if (inquiries.length === 0 && attendees.length === 0) {
            listEl.innerHTML = '<div style="font-size:0.78rem; opacity:0.6;">' + (isRo ? 'Nicio cerere sau participant încă.' : 'No inquiries or attendees yet.') + '</div>';
            return;
        }

        html += '<div style="font-size:0.78rem; font-weight:600; color:var(--sky); margin-top:8px;">' + (isRo ? 'Cereri în așteptare:' : 'Pending Inquiries:') + '</div>';
        var pending = inquiries.filter(function(i) { return i.status === 'pending'; });
        if (pending.length === 0) {
            html += '<div style="font-size:0.75rem; opacity:0.5; margin-bottom:6px;">' + (isRo ? 'Nicio cerere în așteptare.' : 'No pending inquiries.') + '</div>';
        } else {
            pending.forEach(function(inq) {
                html += '<div style="background:rgba(255,255,255,0.04); border:1px solid rgba(184,216,240,0.15); border-radius:6px; padding:8px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">' +
                    '<div><strong>' + escapeHtml(inq.user_name) + '</strong><div style="font-size:0.72rem; opacity:0.8; margin-top:2px;">"' + escapeHtml(inq.message || '') + '"</div></div>' +
                    '<div style="display:flex; gap:6px;">' +
                    '<button type="button" onclick="window._acceptInquiry(\'' + inq.id + '\', \'' + eventId + '\')" style="background:#2E9E4F; border:none; border-radius:4px; color:#fff; padding:4px 8px; font-size:0.7rem; cursor:pointer;">' + (isRo ? 'Acceptă' : 'Accept') + '</button>' +
                    '<button type="button" onclick="window._declineInquiry(\'' + inq.id + '\')" style="background:#C42B2B; border:none; border-radius:4px; color:#fff; padding:4px 8px; font-size:0.7rem; cursor:pointer;">' + (isRo ? 'Respinge' : 'Decline') + '</button>' +
                    '</div></div>';
            });
        }

        html += '<div style="font-size:0.78rem; font-weight:600; color:var(--sky); margin-top:12px;">' + (isRo ? 'Participanți aprobați:' : 'Approved Attendees:') + '</div>';
        if (attendees.length === 0) {
            html += '<div style="font-size:0.75rem; opacity:0.5;">' + (isRo ? 'Niciun participant aprobat.' : 'No approved attendees.') + '</div>';
        } else {
            attendees.forEach(function(att) {
                html += '<div style="background:rgba(255,255,255,0.04); border:1px solid rgba(184,216,240,0.15); border-radius:6px; padding:8px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">' +
                    '<span>' + escapeHtml(att.user_name) + '</span>' +
                    '<button type="button" onclick="window._kickAttendee(\'' + att.id + '\', \'' + eventId + '\')" style="background:rgba(196,43,43,0.3); border:1px solid rgba(196,43,43,0.5); border-radius:4px; color:#ff8a8a; padding:3px 6px; font-size:0.68rem; cursor:pointer;">' + (isRo ? 'Dă afară' : 'Kick out') + '</button>' +
                    '</div>';
            });
        }

        listEl.innerHTML = html;
    }

    // Accept Inquiry
    window._acceptInquiry = async function (inquiryId, eventId) {
        var isRo = (window._currentLang && window._currentLang() === 'ro');
        var inquiries = getLocalInquiries();
        var inq = inquiries.find(function(i) { return i.id === inquiryId; });

        // Also fetch from Supabase if needed
        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient.from('event_inquiries').select('*').eq('id', inquiryId).single();
                if (!res.error && res.data) inq = res.data;
            }
        } catch (e) {}

        if (!inq) {
            try {
                if (window.supabaseClient) {
                    var resList = await window.supabaseClient.from('event_inquiries').select('*').eq('event_id', eventId);
                    if (!resList.error && resList.data) {
                        inq = resList.data.find(function(i) { return i.id === inquiryId; });
                    }
                }
            } catch (e) {}
        }

        if (!inq) {
            alert(isRo ? 'Cererea nu a fost găsită.' : 'Inquiry not found.');
            return;
        }

        // Check 1-event-per-day rule for the attendee
        var ev = eventsData.find(function(e) { return e.id === eventId; });
        if (ev) {
            if (isEventExpired(ev.event_date)) {
                alert(isRo ? 'Evenimentul a expirat deja.' : 'This event has already expired.');
                await expireEventChat(eventId, true);
                return;
            }
            var conflict = await checkAttendanceConflict(inq.user_id, ev.event_date, eventId);
            if (conflict) {
                alert(conflict);
                return;
            }
        }

        inq.status = 'accepted';

        var attendee = null;
        try {
            if (window.supabaseClient) {
                var existingAttRes = await window.supabaseClient
                    .from('event_attendees')
                    .select('*')
                    .eq('event_id', eventId)
                    .eq('user_id', inq.user_id)
                    .limit(1);
                if (!existingAttRes.error && Array.isArray(existingAttRes.data) && existingAttRes.data[0]) {
                    attendee = existingAttRes.data[0];
                }
            }
        } catch (e) {}

        if (!attendee) {
            attendee = {
                id: genUuid(),
                event_id: eventId,
                user_id: inq.user_id,
                user_name: inq.user_name,
                joined_at: new Date().toISOString()
            };
        }

        try {
            if (window.supabaseClient) {
                var updRes = await window.supabaseClient.from('event_inquiries').update({ status: 'accepted' }).eq('id', inquiryId);
                if (updRes && updRes.error) console.error('Supabase update inquiry status failed:', updRes.error);
                if (!attendee.joined_at) attendee.joined_at = new Date().toISOString();
                if (!attendee.id || attendee.id === inquiryId) attendee.id = genUuid();
                var hasExistingRemoteAttendee = false;
                try {
                    var remoteAttCheck = await window.supabaseClient
                        .from('event_attendees')
                        .select('id')
                        .eq('event_id', eventId)
                        .eq('user_id', inq.user_id)
                        .limit(1);
                    hasExistingRemoteAttendee = !remoteAttCheck.error && Array.isArray(remoteAttCheck.data) && remoteAttCheck.data.length > 0;
                } catch (_) {}
                if (!hasExistingRemoteAttendee) {
                    var attInsRes = await window.supabaseClient.from('event_attendees').insert([attendee]);
                    if (attInsRes && attInsRes.error) console.error('Supabase insert attendee failed:', attInsRes.error);
                }
            }
        } catch (err) {
            console.error('Supabase accept inquiry error:', err);
        }

        // Update local storage
        var localInqs = getLocalInquiries();
        var inqIdx = localInqs.findIndex(function(i) { return i.id === inquiryId; });
        if (inqIdx !== -1) {
            localInqs[inqIdx].status = 'accepted';
        } else {
            localInqs.push(inq);
        }
        saveLocalInquiries(localInqs);

        var atts = getLocalAttendees();
        var existingLocalAttendeeIdx = atts.findIndex(function(a) {
            return a.event_id === eventId && a.user_id === inq.user_id;
        });
        if (existingLocalAttendeeIdx === -1) {
            atts.push(attendee);
        } else {
            atts[existingLocalAttendeeIdx] = Object.assign({}, atts[existingLocalAttendeeIdx], attendee);
        }
        saveLocalAttendees(atts);

        await syncEventChatState(eventId);
        loadManageEventDetails(eventId);
        alert(isRo ? 'Cerere acceptată! Chat-ul evenimentului a fost creat.' : 'Inquiry accepted! The event chat was created.');
    };

    // Decline Inquiry
    window._declineInquiry = async function (inquiryId) {
        try {
            if (window.supabaseClient) {
                await window.supabaseClient.from('event_inquiries').update({ status: 'declined' }).eq('id', inquiryId);
            }
        } catch (err) {
            console.error('Supabase decline inquiry error:', err);
        }
        var inquiries = getLocalInquiries();
        var found = false;
        inquiries.forEach(function(i) {
            if (i.id === inquiryId) {
                i.status = 'declined';
                found = true;
            }
        });
        if (!found) {
            inquiries.push({ id: inquiryId, status: 'declined' });
        }
        saveLocalInquiries(inquiries);

        var manageModal = document.getElementById('manageEventModal');
        if (manageModal) {
            var activeEventId = manageModal.getAttribute('data-event-id');
            if (activeEventId) loadManageEventDetails(activeEventId);
        }
    };

    // Kick Attendee
    window._kickAttendee = async function (attendeeId, eventId) {
        var isRo = (window._currentLang && window._currentLang() === 'ro');
        if (!confirm(isRo ? 'Sigur doriți să dați afară acest participant din eveniment și din chat?' : 'Are you sure you want to kick out this attendee from the event and chat?')) return;
        try {
            if (window.supabaseClient) {
                await window.supabaseClient.from('event_attendees').delete().eq('id', attendeeId);
            }
        } catch (err) {}
        var atts = getLocalAttendees().filter(function(a) { return a.id !== attendeeId; });
        saveLocalAttendees(atts);
        await syncEventChatState(eventId);
        loadManageEventDetails(eventId);
    };

    // ── NOTIFICATIONS & WINDOWS NOTIFICATION SYSTEM ──
    async function checkNotifications() {
        var user = getCurrentUser();
        if (!user || !user.id) return;

        var notifs = [];
        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient.from('event_notifications').select('*').eq('user_id', user.id).eq('read', false).order('created_at', { ascending: false });
                if (!res.error && Array.isArray(res.data)) notifs = res.data;
            }
        } catch (e) {}

        var localUnread = getLocalNotifications().filter(function(n) { return n.user_id === user.id && !n.read; });
        var remoteIds = {};
        notifs.forEach(function(n) { remoteIds[n.id] = true; });
        localUnread.forEach(function(n) { if (!remoteIds[n.id]) notifs.push(n); });

        if (notifs.length > 0) {
            showNotificationModal(notifs[0]);
        }
    }

    function showNotificationModal(notif) {
        var existing = document.getElementById('eventNotifModal');
        if (existing) existing.remove();

        var isRo = (window._currentLang && window._currentLang() === 'ro');

        var modal = document.createElement('div');
        modal.id = 'eventNotifModal';
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 5000; background: rgba(4,10,22,0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px;';
        modal.innerHTML = '<div style="background: rgba(10,20,42,0.98); border: 1px solid rgba(184,216,240,0.3); border-radius: 12px; width: 100%; max-width: 420px; padding: 20px; color: #F5F0EB; font-family: \'Outfit\', sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,0.7); animation: pwaDropUp 0.3s ease;">' +
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;"><span style="font-size:1.4rem;">🔔</span><h3 style="margin:0; font-size:1.1rem; color:var(--sky); font-family:\'Cinzel\',serif;">' + (isRo ? 'Cerere Nouă de Participare' : 'New Attendance Inquiry') + '</h3></div>' +
            '<div style="font-size:0.85rem; margin-bottom:8px;"><strong>' + escapeHtml(notif.sender_name) + '</strong> ' + (isRo ? 'vrea să participe la evenimentul tău:' : 'wants to attend your event:') + '</div>' +
            '<div style="background:rgba(255,255,255,0.05); border:1px solid rgba(184,216,240,0.2); border-radius:6px; padding:10px; font-size:0.82rem; font-style:italic; margin-bottom:14px;">"' + escapeHtml(notif.message || '') + '"</div>' +
            '<div style="display:flex; gap:10px;"><button type="button" id="notifAcceptBtn" style="flex:1; background:#2E9E4F; border:none; border-radius:6px; color:#fff; font-weight:600; padding:10px; cursor:pointer;">' + (isRo ? 'Acceptă / Accept' : 'Accept') + '</button><button type="button" id="notifDeclineBtn" style="flex:1; background:#C42B2B; border:none; border-radius:6px; color:#fff; font-weight:600; padding:10px; cursor:pointer;">' + (isRo ? 'Respinge / Decline' : 'Decline') + '</button></div>' +
            '</div>';

        document.body.appendChild(modal);

        modal.querySelector('#notifAcceptBtn').addEventListener('click', async function () {
            var btn = modal.querySelector('#notifAcceptBtn');
            if (btn) btn.disabled = true;
            if (notif.inquiry_id) {
                await window._acceptInquiry(notif.inquiry_id, notif.event_id);
            }
            await markNotifRead(notif.id);
            modal.remove();
        });

        modal.querySelector('#notifDeclineBtn').addEventListener('click', async function () {
            var btn = modal.querySelector('#notifDeclineBtn');
            if (btn) btn.disabled = true;
            if (notif.inquiry_id) {
                await window._declineInquiry(notif.inquiry_id);
            }
            await markNotifRead(notif.id);
            modal.remove();
        });
    }

    async function markNotifRead(notifId) {
        try {
            if (window.supabaseClient) {
                await window.supabaseClient.from('event_notifications').update({ read: true }).eq('id', notifId);
            }
        } catch (e) {}
        var notifs = getLocalNotifications();
        notifs.forEach(function(n) { if (n.id === notifId) n.read = true; });
        saveLocalNotifications(notifs);
    }

    // ── EVENTS PANEL (Manage Account -> Events or navbar Events) ──
    window.openEvents = function () {
        // Close desktop user menu
        var menu = document.getElementById('userMenu');
        if (menu) menu.classList.add('hidden');

        // Close PWA dropdowns
        var pwaDropdowns = document.querySelectorAll('#pwaBottomBar .pwa-dropdown');
        pwaDropdowns.forEach(function(dd) { dd.classList.remove('open'); });
        var pwaTriggers = document.querySelectorAll('#pwaBottomBar .pwa-bar-trigger');
        pwaTriggers.forEach(function(tr) { tr.classList.remove('active'); });

        var user = getCurrentUser();
        if (!user) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }

        var existing = document.getElementById('eventsManagerPanel');
        if (existing) existing.remove();

        var isRo = (window._currentLang && window._currentLang() === 'ro');

        var panel = document.createElement('div');
        panel.id = 'eventsManagerPanel';
        panel.style.cssText = 'position: fixed; inset: 0; z-index: 3500; background: rgba(4,10,22,0.94); backdrop-filter: blur(12px); display: flex; flex-direction: column; padding: 20px; overflow-y: auto; color: #F5F0EB; font-family: \'Outfit\', sans-serif;';

        panel.innerHTML = '<div style="max-width: 800px; width: 100%; margin: 0 auto;">' +
            '<button type="button" onclick="document.getElementById(\'eventsManagerPanel\').remove()" style="background:none; border:none; color:var(--sky); font-weight:600; font-size:0.9rem; cursor:pointer; margin-bottom:16px; display:flex; align-items:center; gap:6px;">← ' + (isRo ? 'Înapoi la hartă' : 'Back to map') + '</button>' +
            '<h2 style="font-family:\'Cinzel\',serif; font-size:1.6rem; color:var(--sky); margin-top:0; margin-bottom:16px;">' + (isRo ? 'Evenimente & Chat' : 'Events & Chat') + '</h2>' +
            '<div style="display:flex; gap:10px; margin-bottom:20px; border-bottom:1px solid rgba(184,216,240,0.15); padding-bottom:10px;">' +
            '<button type="button" class="ev-tab-btn active" onclick="window._switchEvTab(\'all\')" style="background:rgba(107,63,160,0.3); border:1px solid rgba(196,160,240,0.5); border-radius:6px; color:#fff; padding:8px 14px; font-weight:600; cursor:pointer; font-size:0.85rem;">' + (isRo ? 'Toate Evenimentele' : 'All Events') + '</button>' +
            '<button type="button" class="ev-tab-btn" onclick="window._switchEvTab(\'my\')" style="background:none; border:1px solid rgba(184,216,240,0.2); border-radius:6px; color:rgba(245,240,235,0.7); padding:8px 14px; font-weight:600; cursor:pointer; font-size:0.85rem;">' + (isRo ? 'Evenimentele Mele & Chat-uri' : 'My Events & Chats') + '</button>' +
            '</div>' +
            '<div id="evTabContent">Se încarcă…</div>' +
            '</div>';

        document.body.appendChild(panel);
        window._switchEvTab('all');
    };

    window._switchEvTab = async function (tab) {
        var contentEl = document.getElementById('evTabContent');
        if (!contentEl) return;
        var isRo = (window._currentLang && window._currentLang() === 'ro');
        var user = getCurrentUser();

        // Highlight active tab
        var buttons = document.querySelectorAll('.ev-tab-btn');
        if (buttons.length >= 2) {
            buttons[0].style.background = tab === 'all' ? 'rgba(107,63,160,0.3)' : 'none';
            buttons[1].style.background = tab === 'my' ? 'rgba(107,63,160,0.3)' : 'none';
        }

        await fetchEvents();
        await maybeCleanupExpiredEventChats();

        if (tab === 'all') {
            // Pre-fetch user's inquiries and attendances for accurate button state
            var userInquiries = [];
            var userAttendances = [];
            try {
                if (window.supabaseClient && user) {
                    var resUserInq = await window.supabaseClient.from('event_inquiries').select('event_id,status').eq('user_id', user.id);
                    if (!resUserInq.error && resUserInq.data) userInquiries = resUserInq.data;
                    var resUserAtt = await window.supabaseClient.from('event_attendees').select('event_id').eq('user_id', user.id);
                    if (!resUserAtt.error && resUserAtt.data) userAttendances = resUserAtt.data;
                }
            } catch (e) {}
            if (userInquiries.length === 0 && user) {
                userInquiries = getLocalInquiries().filter(function(i) { return i.user_id === user.id; });
            }
            if (userAttendances.length === 0 && user) {
                userAttendances = getLocalAttendees().filter(function(a) { return a.user_id === user.id; });
            }
            var userInqEventIds = {};
            userInquiries.forEach(function(i) { userInqEventIds[i.event_id] = i.status; });
            var userAttEventIds = {};
            userAttendances.forEach(function(a) { userAttEventIds[a.event_id] = true; });

            var html = '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px;">';
            if (eventsData.length === 0) {
                html += '<div style="opacity:0.6;">' + (isRo ? 'Nu există evenimente active.' : 'No active events.') + '</div>';
            } else {
                eventsData.forEach(function (ev) {
                    var color = getEventColor(ev.event_date);
                    var isCreator = user && (user.id === ev.creator_id || (user.email && ev.creator_email && user.email === ev.creator_email));
                    var isAttending = userAttEventIds[ev.id];
                    var hasInquiry = userInqEventIds[ev.id];
                    var isExpired = isEventExpired(ev.event_date);
                    var actionBtn = '';
                    if (isExpired) {
                        actionBtn = '<div style="background:rgba(196,43,43,0.15); border:1px solid rgba(196,43,43,0.35); border-radius:6px; color:#ff8a8a; padding:8px; text-align:center; font-weight:600; font-size:0.78rem;">⌛ ' + (isRo ? 'Eveniment expirat' : 'Event expired') + '</div>';
                    } else if (isCreator) {
                        actionBtn = '<button type="button" onclick="window._manageEvent(\'' + ev.id + '\')" style="background:#6B3FA0; border:none; border-radius:6px; color:#fff; font-weight:600; padding:8px; cursor:pointer; font-size:0.78rem;">' + (isRo ? 'Gestionează' : 'Manage') + '</button>';
                    } else if (isAttending) {
                        actionBtn = '<div style="background:rgba(46,158,79,0.2); border:1px solid rgba(46,158,79,0.5); border-radius:6px; color:#2E9E4F; padding:8px; text-align:center; font-weight:600; font-size:0.78rem;">✓ ' + (isRo ? 'Deja participant' : 'Already attending') + '</div>';
                    } else if (hasInquiry && hasInquiry !== 'declined') {
                        actionBtn = '<div style="background:rgba(232,119,42,0.15); border:1px solid rgba(232,119,42,0.4); border-radius:6px; color:#E8772A; padding:8px; text-align:center; font-weight:600; font-size:0.78rem;">⏳ ' + (isRo ? 'Cerere trimisă' : 'Request pending') + '</div>';
                    } else {
                        actionBtn = '<button type="button" onclick="window._openInquiryModal(\'' + ev.id + '\')" style="background:#E8772A; border:none; border-radius:6px; color:#fff; font-weight:600; padding:8px; cursor:pointer; font-size:0.78rem;">' + (isRo ? 'Trimite Cerere' : 'Send Inquiry') + '</button>';
                    }
                    html += '<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(184,216,240,0.18); border-radius:10px; padding:16px; display:flex; flex-direction:column; justify-content:space-between;">' +
                        '<div>' +
                        '<div style="font-size:0.7rem; color:' + color + '; font-weight:700; margin-bottom:4px;">● ' + formatDate(ev.event_date) + '</div>' +
                        '<h4 style="margin:0 0 6px 0; font-size:1rem; color:#F5F0EB;">' + escapeHtml(ev.title) + '</h4>' +
                        '<p style="margin:0 0 10px 0; font-size:0.78rem; opacity:0.8; line-height:1.4;">' + escapeHtml(ev.description || '') + '</p>' +
                        '<div style="font-size:0.72rem; opacity:0.6; margin-bottom:12px;">👤 ' + escapeHtml(ev.creator_name || 'User') + '</div>' +
                        '</div>' +
                        actionBtn +
                        '</div>';
                });
            }
            html += '</div>';
            contentEl.innerHTML = html;
        } else {
            // My events & chats
            var myEvs = eventsData.filter(function (e) {
                return e.creator_id === user.id || (user.email && e.creator_email && user.email === e.creator_email);
            });

            // Also find events where user is an accepted attendee
            var attEvents = [];
            try {
                if (window.supabaseClient) {
                    var resAtt = await window.supabaseClient.from('event_attendees').select('event_id').eq('user_id', user.id);
                    if (!resAtt.error && resAtt.data) {
                        var ids = resAtt.data.map(function(a) { return a.event_id; });
                        attEvents = eventsData.filter(function(e) { return ids.indexOf(e.id) !== -1; });
                    }
                }
            } catch (e) {}

            if (attEvents.length === 0) {
                var localAtts = getLocalAttendees().filter(function(a) { return a.user_id === user.id; });
                var localIds = localAtts.map(function(a) { return a.event_id; });
                attEvents = eventsData.filter(function(e) { return localIds.indexOf(e.id) !== -1; });
            }

            var eventIdsForChatState = [];
            myEvs.forEach(function (ev) { if (eventIdsForChatState.indexOf(ev.id) === -1) eventIdsForChatState.push(ev.id); });
            attEvents.forEach(function (ev) { if (eventIdsForChatState.indexOf(ev.id) === -1) eventIdsForChatState.push(ev.id); });

            var attendeeCounts = await fetchAttendeeCounts(eventIdsForChatState);
            var activeChats = await fetchActiveEventChats(eventIdsForChatState);
            var activeChatMap = {};
            activeChats.forEach(function (chat) {
                activeChatMap[chat.event_id] = chat;
            });

            for (var i = 0; i < eventIdsForChatState.length; i++) {
                var eventId = eventIdsForChatState[i];
                var evForChat = getEventById(eventId);
                if (!evForChat || isEventExpired(evForChat.event_date)) continue;
                if ((attendeeCounts[eventId] || 0) >= 1 && !activeChatMap[eventId]) {
                    var ensuredChat = await ensureEventChatExists(evForChat, attendeeCounts[eventId]);
                    if (ensuredChat) activeChatMap[eventId] = ensuredChat;
                }
            }

            var attendableChatEvents = attEvents.filter(function (ev) {
                return !isEventExpired(ev.event_date) && !!activeChatMap[ev.id];
            });

            var html = '<h3 style="font-size:1.05rem; color:var(--sky); margin-bottom:8px;">' + (isRo ? 'Evenimentele create de tine' : 'Events Created By You') + '</h3>';
            if (myEvs.length === 0) {
                html += '<div style="font-size:0.78rem; opacity:0.6; margin-bottom:20px;">' + (isRo ? 'Nu ai creat niciun eveniment.' : 'You have not created any events.') + '</div>';
            } else {
                html += '<div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">';
                myEvs.forEach(function (ev) {
                    var isExpired = isEventExpired(ev.event_date);
                    var attendeeCount = attendeeCounts[ev.id] || 0;
                    var chatAction = '';
                    if (isExpired) {
                        chatAction = '<div style="background:rgba(196,43,43,0.15); border:1px solid rgba(196,43,43,0.35); border-radius:6px; color:#ff8a8a; padding:6px 10px; font-size:0.72rem; font-weight:600;">⌛ ' + (isRo ? 'Expirat' : 'Expired') + '</div>';
                    } else if (activeChatMap[ev.id]) {
                        chatAction = '<button type="button" onclick="window._openEventChat(\'' + ev.id + '\')" style="background:#0D2B5E; border:1px solid rgba(184,216,240,0.3); border-radius:6px; color:var(--sky); padding:6px 10px; font-size:0.75rem; cursor:pointer; font-weight:600;">💬 Chat</button>';
                    } else {
                        chatAction = '<div style="background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.15); border-radius:6px; color:rgba(245,240,235,0.72); padding:6px 10px; font-size:0.72rem; text-align:center;">' + (attendeeCount >= 1 ? (isRo ? 'Se pregătește chat-ul…' : 'Preparing chat…') : (isRo ? 'Chat-ul se activează după primul participant acceptat' : 'Chat unlocks after the first accepted participant')) + '</div>';
                    }

                    html += '<div style="background:rgba(255,255,255,0.04); border:1px solid rgba(184,216,240,0.15); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center; gap:12px;">' +
                        '<div><strong>' + escapeHtml(ev.title) + '</strong><div style="font-size:0.72rem; opacity:0.7;">' + formatDate(ev.event_date) + ' • ' + attendeeCount + ' ' + (isRo ? 'participanți acceptați' : 'accepted attendees') + '</div></div>' +
                        '<div style="display:flex; gap:8px; align-items:center;">' +
                        '<button type="button" onclick="window._manageEvent(\'' + ev.id + '\')" style="background:#6B3FA0; border:none; border-radius:6px; color:#fff; padding:6px 10px; font-size:0.75rem; cursor:pointer; font-weight:600;">' + (isRo ? 'Gestionează' : 'Manage') + '</button>' +
                        chatAction +
                        '</div></div>';
                });
                html += '</div>';
            }

            html += '<h3 style="font-size:1.05rem; color:var(--sky); margin-bottom:8px;">' + (isRo ? 'Evenimente la care participi (Chat activ)' : 'Events You Attend (Active Chat)') + '</h3>';
            if (attendableChatEvents.length === 0) {
                html += '<div style="font-size:0.78rem; opacity:0.6;">' + (isRo ? 'Nu participi la niciun chat de eveniment activ.' : 'You are not attending any active event chat.') + '</div>';
            } else {
                html += '<div style="display:flex; flex-direction:column; gap:8px;">';
                attendableChatEvents.forEach(function (ev) {
                    html += '<div style="background:rgba(255,255,255,0.04); border:1px solid rgba(184,216,240,0.15); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">' +
                        '<div><strong>' + escapeHtml(ev.title) + '</strong><div style="font-size:0.72rem; opacity:0.7;">' + formatDate(ev.event_date) + '</div></div>' +
                        '<button type="button" onclick="window._openEventChat(\'' + ev.id + '\')" style="background:#0D2B5E; border:1px solid rgba(184,216,240,0.3); border-radius:6px; color:var(--sky); padding:6px 12px; font-size:0.75rem; cursor:pointer; font-weight:600;">💬 ' + (isRo ? 'Deschide Chat' : 'Open Chat') + '</button>' +
                        '</div>';
                });
                html += '</div>';
            }

            contentEl.innerHTML = html;
        }
    };

    // ── EVENT CHAT SYSTEM ──
    window._openEventChat = async function (eventId) {
        await maybeCleanupExpiredEventChats();

        var ev = getEventById(eventId);
        if (!ev) return;
        var isRo = (window._currentLang && window._currentLang() === 'ro');
        var user = getCurrentUser();

        if (isEventExpired(ev.event_date)) {
            await expireEventChat(eventId, true);
            alert(isRo ? 'Chat-ul nu mai este disponibil deoarece deadline-ul evenimentului a trecut.' : 'The chat is no longer available because the event deadline has passed.');
            return;
        }

        if (!user || !user.id) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }

        var isCreator = user.id === ev.creator_id || (user.email && ev.creator_email && user.email === ev.creator_email);
        var isApprovedAttendee = isCreator ? true : await isUserAcceptedAttendee(eventId, user.id);
        if (!isApprovedAttendee) {
            alert(isRo ? 'Chat-ul devine disponibil doar pentru creator și participanții acceptați.' : 'The chat is only available to the creator and accepted attendees.');
            return;
        }

        var attendeeCounts = await fetchAttendeeCounts([eventId]);
        var attendeeCount = attendeeCounts[eventId] || 0;
        if (attendeeCount < 1) {
            alert(isRo ? 'Chat-ul se creează automat după acceptarea primului participant.' : 'The chat is created automatically after the first participant is accepted.');
            return;
        }

        var chat = await ensureEventChatExists(ev, attendeeCount);
        if (!chat) {
            alert(isRo ? 'Chat-ul evenimentului nu a putut fi creat.' : 'The event chat could not be created.');
            return;
        }

        activeChatEventId = eventId;

        var existing = document.getElementById('eventChatModal');
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = 'eventChatModal';
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 4500; background: rgba(4,10,22,0.92); backdrop-filter: blur(12px); display: flex; flex-direction: column; padding: 16px;';

        var box = document.createElement('div');
        box.style.cssText = 'max-width: 600px; width: 100%; margin: 0 auto; height: 100%; display: flex; flex-direction: column; background: rgba(10,20,42,0.98); border: 1px solid rgba(184,216,240,0.25); border-radius: 12px; overflow: hidden;';

        box.innerHTML = '<div style="background: rgba(6,14,30,0.95); padding: 12px 16px; border-bottom: 1px solid rgba(184,216,240,0.15); display: flex; flex-direction: column; gap: 6px;">' +
            '<div style="display: flex; justify-content: space-between; align-items: center;">' +
            '<strong style="font-size: 1rem; color: #F5F0EB;">' + escapeHtml(ev.title) + '</strong>' +
            '<button type="button" onclick="window._closeEventChatModal()" style="background:none; border:none; color:var(--sky); font-size:1.2rem; cursor:pointer;">✕</button>' +
            '</div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem; gap:8px;">' +
            '<span id="chatTimer" style="color: #ffc832; font-weight: 600;">⏳ ' + (isRo ? 'Se verifică deadline-ul chat-ului…' : 'Checking chat deadline…') + '</span>' +
            '<button type="button" onclick="window._addToCalendar(\'' + ev.id + '\')" style="background: rgba(107,63,160,0.35); border: 1px solid rgba(196,160,240,0.5); border-radius: 4px; color: #c4a0f0; padding: 3px 8px; font-size: 0.7rem; cursor: pointer; font-weight: 600;">📅 ' + (isRo ? 'Adaugă în Calendar' : 'Add to Calendar') + '</button>' +
            '</div>' +
            '</div>' +
            '<div id="chatMessagesList" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;"></div>' +
            '<div style="background: rgba(6,14,30,0.95); padding: 12px; border-top: 1px solid rgba(184,216,240,0.15); display: flex; gap: 8px; align-items: center;">' +
            '<label style="cursor: pointer; background: rgba(184,216,240,0.1); border: 1px solid rgba(184,216,240,0.25); border-radius: 6px; padding: 8px; display: flex; align-items: center; justify-content: center;" title="' + (isRo ? 'Atașare foto/video' : 'Attach photo/video') + '">' +
            '📎<input type="file" id="chatMediaInput" accept="image/*,video/*" style="display:none;" onchange="window._handleChatMedia(this)">' +
            '</label>' +
            '<input type="text" id="chatInput" placeholder="' + (isRo ? 'Scrie un mesaj...' : 'Type a message...') + '" style="flex:1; background:rgba(255,255,255,0.06); border:1px solid rgba(184,216,240,0.25); border-radius:6px; padding:8px 12px; color:#F5F0EB; font-size:0.85rem;" autocomplete="off">' +
            '<button type="button" onclick="window._sendChatMessage()" style="background:#6B3FA0; border:none; border-radius:6px; color:#fff; font-weight:600; padding:8px 16px; cursor:pointer;">' + (isRo ? 'Trimite' : 'Send') + '</button>' +
            '</div>';

        modal.appendChild(box);
        document.body.appendChild(modal);

        await loadChatMessages(eventId);
        startEventChatDeadlineTimer(ev);

        var chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') window._sendChatMessage();
            });
        }
    };

    async function loadChatMessages(eventId) {
        var listEl = document.getElementById('chatMessagesList');
        if (!listEl) return;
        var user = getCurrentUser();
        var ev = getEventById(eventId);
        var isRo = (window._currentLang && window._currentLang() === 'ro');

        if (ev && isEventExpired(ev.event_date)) {
            await expireEventChat(eventId, true);
            listEl.innerHTML = '<div style="text-align:center; opacity:0.7; font-size:0.8rem; margin-top:20px;">' + (isRo ? 'Chat expirat.' : 'Chat expired.') + '</div>';
            return;
        }

        var msgs = [];
        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient.from('event_chat_messages').select('*').eq('event_id', eventId).order('created_at', { ascending: true });
                if (!res.error && res.data) msgs = res.data;
            }
        } catch (e) {}

        if (msgs.length === 0) {
            msgs = getLocalMessages().filter(function(m) { return m.event_id === eventId; });
        }

        var html = '';
        if (msgs.length === 0) {
            html = '<div style="text-align:center; opacity:0.5; font-size:0.8rem; margin-top:20px;">' + (isRo ? 'Chat creat. Începe conversația!' : 'Chat created. Start the conversation!') + '</div>';
        } else {
            msgs.forEach(function (m) {
                var isMe = user && m.user_id === user.id;
                html += '<div style="display: flex; flex-direction: column; align-items: ' + (isMe ? 'flex-end' : 'flex-start') + ';">' +
                    '<div style="font-size: 0.68rem; opacity: 0.6; margin-bottom: 2px;">' + escapeHtml(m.user_name) + '</div>' +
                    '<div style="background: ' + (isMe ? '#6B3FA0' : 'rgba(255,255,255,0.08)') + '; padding: 8px 12px; border-radius: 8px; max-width: 80%; font-size: 0.85rem; word-break: break-word;">';
                if (m.message) html += escapeHtml(m.message);
                if (m.media_url) {
                    if (m.media_type === 'image') {
                        html += '<div style="margin-top:6px;"><img src="' + m.media_url + '" style="max-width:100%; border-radius:6px; max-height:200px; display:block;"></div>';
                    } else if (m.media_type === 'video') {
                        html += '<div style="margin-top:6px;"><video src="' + m.media_url + '" controls style="max-width:100%; border-radius:6px; max-height:200px; display:block;"></video></div>';
                    }
                }
                html += '</div></div>';
            });
        }
        listEl.innerHTML = html;
        listEl.scrollTop = listEl.scrollHeight;
    }

    window._sendChatMessage = async function () {
        var input = document.getElementById('chatInput');
        if (!input) return;
        var text = input.value.trim();
        if (!text || !activeChatEventId) return;

        var user = getCurrentUser();
        if (!user || !user.id) return;

        var ev = getEventById(activeChatEventId);
        var isRo = (window._currentLang && window._currentLang() === 'ro');
        if (!ev || isEventExpired(ev.event_date)) {
            await expireEventChat(activeChatEventId, true);
            alert(isRo ? 'Chat-ul a expirat și nu mai poate primi mesaje.' : 'The chat has expired and can no longer receive messages.');
            return;
        }

        var msg = {
            id: genUuid(),
            event_id: activeChatEventId,
            user_id: user.id,
            user_name: user.name || (user.email ? user.email.split('@')[0] : 'User'),
            message: text,
            media_url: null,
            media_type: 'none',
            created_at: new Date().toISOString()
        };

        var shouldPersistLocally = true;
        try {
            if (window.supabaseClient) {
                var chatInsertRes = await window.supabaseClient.from('event_chat_messages').insert([msg]);
                if (chatInsertRes && chatInsertRes.error) {
                    console.error('Supabase insert chat message failed:', chatInsertRes.error);
                    var chatErrorMsg = String(chatInsertRes.error.message || '').toLowerCase();
                    if (chatErrorMsg.indexOf('chat') !== -1 || chatErrorMsg.indexOf('active') !== -1) {
                        shouldPersistLocally = false;
                        await syncEventChatState(activeChatEventId);
                    }
                }
            }
        } catch (e) {}

        if (!shouldPersistLocally) return;

        var msgs = getLocalMessages();
        msgs.push(msg);
        saveLocalMessages(msgs);

        input.value = '';
        loadChatMessages(activeChatEventId);
    };

    window._handleChatMedia = async function (input) {
        if (!input.files || !input.files[0] || !activeChatEventId) return;
        var file = input.files[0];
        var reader = new FileReader();

        reader.onload = async function (e) {
            var ev = getEventById(activeChatEventId);
            var isRo = (window._currentLang && window._currentLang() === 'ro');
            if (!ev || isEventExpired(ev.event_date)) {
                await expireEventChat(activeChatEventId, true);
                alert(isRo ? 'Chat-ul a expirat și nu mai poate primi atașamente.' : 'The chat has expired and can no longer receive attachments.');
                return;
            }

            var dataUrl = e.target.result;
            var isVideo = file.type.startsWith('video');
            var user = getCurrentUser();
            if (!user || !user.id) return;

            var msg = {
                id: genUuid(),
                event_id: activeChatEventId,
                user_id: user.id,
                user_name: user.name || (user.email ? user.email.split('@')[0] : 'User'),
                message: '',
                media_url: dataUrl,
                media_type: isVideo ? 'video' : 'image',
                created_at: new Date().toISOString()
            };

            var shouldPersistLocally = true;
            try {
                if (window.supabaseClient) {
                    var mediaInsertRes = await window.supabaseClient.from('event_chat_messages').insert([msg]);
                    if (mediaInsertRes && mediaInsertRes.error) {
                        var mediaErrorMsg = String(mediaInsertRes.error.message || '').toLowerCase();
                        if (mediaErrorMsg.indexOf('chat') !== -1 || mediaErrorMsg.indexOf('active') !== -1) {
                            shouldPersistLocally = false;
                            await syncEventChatState(activeChatEventId);
                        }
                    }
                }
            } catch (err) {}

            if (!shouldPersistLocally) return;

            var msgs = getLocalMessages();
            msgs.push(msg);
            saveLocalMessages(msgs);

            loadChatMessages(activeChatEventId);
        };
        reader.readAsDataURL(file);
    };

    // Add to Phone Calendar (.ics generator)
    window._addToCalendar = function (eventId) {
        var ev = eventsData.find(function (e) { return e.id === eventId; });
        if (!ev) return;

        var startDate = new Date(ev.event_date);
        var endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // +2 hours

        function fmtIcsDate(d) {
            return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        }

        var icsContent = 'BEGIN:VCALENDAR\n' +
            'VERSION:2.0\n' +
            'PRODID:-//DetectLab//Events//EN\n' +
            'BEGIN:VEVENT\n' +
            'SUMMARY:' + ev.title + '\n' +
            'DESCRIPTION:' + (ev.description || '') + '\n' +
            'DTSTART:' + fmtIcsDate(startDate) + '\n' +
            'DTEND:' + fmtIcsDate(endDate) + '\n' +
            'LOCATION:Lat ' + ev.latitude + ', Lng ' + ev.longitude + '\n' +
            'END:VEVENT\n' +
            'END:VCALENDAR';

        var blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        var link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.setAttribute('download', (ev.title || 'event').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.ics');
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    // Periodic check for notifications on app load / login
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(checkNotifications, 2000);
        setTimeout(function () { maybeCleanupExpiredEventChats(true); }, 2500);
        setInterval(checkNotifications, 15000);
        setInterval(function () { maybeCleanupExpiredEventChats(); }, 60000);
    });

    // Rebuild event markers and check notifications when auth state changes (login / logout / token refresh)
    window.addEventListener('detectlab:authchange', async function () {
        await fetchEvents();
        refreshEventsMap();
        await maybeCleanupExpiredEventChats(true);
        checkNotifications();
    });

    // Expose init and methods
    window._initEventsLayer = initEventsLayer;
    window._checkEventNotifications = checkNotifications;
    window._fetchEvents = fetchEvents;
})();
