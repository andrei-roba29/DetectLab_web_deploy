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
    let myInquiries = [];
    let myAttendances = [];
    let myNotifications = [];
    let activeChatEventId = null;

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
            remote.forEach(function(e){ remoteIds[e.id]=true; });
            var merged = remote.slice();
            local.forEach(function(e){ if (!remoteIds[e.id]) merged.push(e); });
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
            marker.bindPopup(createEventPopupHtml(ev));
            eventsLayer.addLayer(marker);
        });
    }

    function createEventPopupHtml(ev) {
        var user = getCurrentUser();
        var isCreator = user && (user.id === ev.creator_id || user.email === ev.creator_email);
        var color = getEventColor(ev.event_date);
        var dateStr = formatDate(ev.event_date);

        var html = '<div style="min-width: 220px; font-family: \'Outfit\', sans-serif;">' +
            '<div style="font-weight: 700; font-size: 0.95rem; color: #F5F0EB; margin-bottom: 4px;">' + escapeHtml(ev.title) + '</div>' +
            '<div style="font-size: 0.76rem; color: rgba(184,216,240,0.8); margin-bottom: 6px;">' + escapeHtml(ev.description || '') + '</div>' +
            '<div style="font-size: 0.72rem; color: ' + color + '; font-weight: 600; margin-bottom: 4px;">📅 ' + dateStr + '</div>' +
            '<div style="font-size: 0.7rem; color: rgba(245,240,235,0.6); margin-bottom: 8px;">👤 Creator: ' + escapeHtml(ev.creator_name || 'User') + (ev.max_attendees ? ' | Max: ' + ev.max_attendees : '') + '</div>';

        if (isCreator) {
            html += '<button type="button" onclick="window._manageEvent(\'' + ev.id + '\')" style="width: 100%; background: #6B3FA0; border: none; border-radius: 4px; color: #fff; font-size: 0.75rem; padding: 5px; cursor: pointer; font-weight: 600;">Gestionează Evenimentul</button>';
        } else if (user) {
            html += '<button type="button" onclick="window._openInquiryModal(\'' + ev.id + '\')" style="width: 100%; background: #E8772A; border: none; border-radius: 4px; color: #fff; font-size: 0.75rem; padding: 5px; cursor: pointer; font-weight: 600;">Trimite Cerere Participare</button>';
        } else {
            html += '<div style="font-size: 0.7rem; color: #ff8a8a;">Autentifică-te pentru a participa.</div>';
        }
        html += '</div>';
        return html;
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Hook into coordinate popup in map-app.js to add "Create Event" button
    window._augmentCoordPopup = function (popupDiv, lat, lng) {
        var div = document.createElement('div');
        div.style.cssText = 'margin-top: 6px;';
        div.innerHTML = '<button type="button" class="coord-popup-create-event" style="width: 100%; background: rgba(107,63,160,0.35); border: 1px solid rgba(196,160,240,0.6); border-radius: 4px; color: #c4a0f0; font-size: 0.76rem; font-family: \'Outfit\', sans-serif; padding: 5px 0; cursor: pointer; font-weight: 600;">Creează un eveniment</button>';
        var btn = div.querySelector('button');
        btn.addEventListener('click', function () {
            var curUser = getCurrentUser();
            if (!curUser) {
                if (typeof window.openAuth === 'function') window.openAuth('login');
                return;
            }
            openCreateEventModal(lat, lng);
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

            try {
                if (window.supabaseClient) {
                    var payload = {
                        id: newEvent.id,
                        creator_id: newEvent.creator_id,
                        creator_name: newEvent.creator_name,
                        title: newEvent.title,
                        description: newEvent.description,
                        latitude: newEvent.latitude,
                        longitude: newEvent.longitude,
                        event_date: newEvent.event_date,
                        max_attendees: newEvent.max_attendees
                    };
                    await window.supabaseClient.from('events').insert([payload]);
                }
            } catch (err) {
                console.warn('Supabase insert event error, storing locally:', err);
            }

            eventsData.push(newEvent);
            saveLocalEvents(eventsData);
            if (window.updatePinWithEvent && pinId) {
                window.updatePinWithEvent(pinId, newEvent);
            }
            refreshEventsMap();
            modal.remove();
            alert(isRo ? 'Eveniment creat cu succes!' : 'Event created successfully!');
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
    document.addEventListener('click', function (e) {
        // Delete Pin
        var delBtn = e.target.closest('.delete-pin-btn, .pin-delete-btn, .coord-popup-delete');
        if (delBtn) {
            e.preventDefault();
            e.stopPropagation();
            var pinId = delBtn.dataset.pinId || delBtn.getAttribute('data-pin-id');
            if (confirm('Sigur doriți să ștergeți acest pin? / Are you sure you want to delete this pin?')) {
                window.deletePin(pinId, delBtn);
            }
            return;
        }

        // Create Event from Pin
        var createBtn = e.target.closest('.pin-create-event-btn, .coord-popup-create-event');
        if (createBtn) {
            e.preventDefault();
            e.stopPropagation();
            var pinId = createBtn.dataset.pinId || createBtn.getAttribute('data-pin-id');
            var lat = parseFloat(createBtn.dataset.lat || createBtn.getAttribute('data-lat'));
            var lng = parseFloat(createBtn.dataset.lng || createBtn.getAttribute('data-lng'));
            var title = createBtn.dataset.title || createBtn.getAttribute('data-title') || '';

            var user = getCurrentUser();
            if (!user) {
                if (typeof window.openAuth === 'function') window.openAuth('login');
                return;
            }
            openCreateEventModal(lat, lng, pinId, title);
            return;
        }
    });

    window.getEventsData = function () { return eventsData; };
    window.openCreateEventModal = openCreateEventModal;

    // Check attendance 1-event-per-day rule
    // "The same user can not attend to 2 different events in the same day and if they try they will get the message 'You are already attending to an event on -date of event-'/'Deja participi la un eveniment in -data evenimentului-'."
    async function checkAttendanceConflict(userId, eventDateIso) {
        var targetDateStr = getDateString(eventDateIso);
        var isRo = (window._currentLang && window._currentLang() === 'ro');

        // Check local or Supabase attendances
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
            var ev = eventsData.find(function(e) { return e.id === att.event_id; });
            if (ev) {
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

            var words = msgText.split(/\s+/).filter(Boolean);
            if (words.length > 100) {
                errEl.textContent = isRo ? 'Mesajul nu poate depăși 100 de cuvinte.' : 'Message cannot exceed 100 words.';
                return;
            }

            // Check 1-event-per-day rule
            var conflictMsg = await checkAttendanceConflict(user.id, ev.event_date);
            if (conflictMsg) {
                errEl.textContent = conflictMsg;
                return;
            }

            var inquiryId = 'inq_' + Math.random().toString(36).substring(2, 9);
            var inquiry = {
                id: inquiryId,
                event_id: ev.id,
                user_id: user.id,
                user_name: user.name || user.email.split('@')[0],
                message: msgText,
                status: 'pending',
                created_at: new Date().toISOString()
            };

            var notification = {
                id: 'notif_' + Math.random().toString(36).substring(2, 9),
                user_id: ev.creator_id,
                event_id: ev.id,
                inquiry_id: inquiryId,
                sender_id: user.id,
                sender_name: inquiry.user_name,
                message: msgText,
                read: false,
                created_at: new Date().toISOString()
            };

            try {
                if (window.supabaseClient) {
                    await window.supabaseClient.from('event_inquiries').insert([inquiry]);
                    await window.supabaseClient.from('event_notifications').insert([notification]);
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
            alert(isRo ? 'Cererea a fost trimisă cu succes!' : 'Inquiry sent successfully!');
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
                if (!resInq.error) inquiries = resInq.data || [];
                var resAtt = await window.supabaseClient.from('event_attendees').select('*').eq('event_id', eventId);
                if (!resAtt.error) attendees = resAtt.data || [];
            }
        } catch (e) {}

        if (inquiries.length === 0) inquiries = getLocalInquiries().filter(function(i) { return i.event_id === eventId; });
        if (attendees.length === 0) attendees = getLocalAttendees().filter(function(a) { return a.event_id === eventId; });

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

        if (!inq) return;

        // Check 1-event-per-day rule for the attendee
        var ev = eventsData.find(function(e) { return e.id === eventId; });
        if (ev) {
            var conflict = await checkAttendanceConflict(inq.user_id, ev.event_date);
            if (conflict) {
                alert(conflict);
                return;
            }
        }

        inq.status = 'accepted';
        var attendee = {
            id: 'att_' + Math.random().toString(36).substring(2, 9),
            event_id: eventId,
            user_id: inq.user_id,
            user_name: inq.user_name,
            joined_at: new Date().toISOString()
        };

        try {
            if (window.supabaseClient) {
                await window.supabaseClient.from('event_inquiries').update({ status: 'accepted' }).eq('id', inquiryId);
                await window.supabaseClient.from('event_attendees').insert([attendee]);
            }
        } catch (err) {}

        saveLocalInquiries(inquiries);
        var atts = getLocalAttendees();
        atts.push(attendee);
        saveLocalAttendees(atts);

        loadManageEventDetails(eventId);
        alert(isRo ? 'Cerere acceptată! S-a creat chat-ul pentru eveniment.' : 'Inquiry accepted! Event chat created.');
    };

    // Decline Inquiry
    window._declineInquiry = async function (inquiryId) {
        try {
            if (window.supabaseClient) {
                await window.supabaseClient.from('event_inquiries').update({ status: 'declined' }).eq('id', inquiryId);
            }
        } catch (err) {}
        var inquiries = getLocalInquiries();
        inquiries.forEach(function(i) { if (i.id === inquiryId) i.status = 'declined'; });
        saveLocalInquiries(inquiries);
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
        loadManageEventDetails(eventId);
    };

    // ── NOTIFICATIONS & WINDOWS NOTIFICATION SYSTEM ──
    async function checkNotifications() {
        var user = getCurrentUser();
        if (!user) return;

        var notifs = [];
        try {
            if (window.supabaseClient) {
                var res = await window.supabaseClient.from('event_notifications').select('*').eq('user_id', user.id).eq('read', false);
                if (!res.error && res.data) notifs = res.data;
            }
        } catch (e) {}

        if (notifs.length === 0) {
            notifs = getLocalNotifications().filter(function(n) { return n.user_id === user.id && !n.read; });
        }

        if (notifs.length > 0) {
            // Show windows / in-app notification popup
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
            if (notif.inquiry_id) {
                await window._acceptInquiry(notif.inquiry_id, notif.event_id);
            }
            markNotifRead(notif.id);
            modal.remove();
        });

        modal.querySelector('#notifDeclineBtn').addEventListener('click', async function () {
            if (notif.inquiry_id) {
                await window._declineInquiry(notif.inquiry_id);
            }
            markNotifRead(notif.id);
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
        var menu = document.getElementById('userMenu');
        if (menu) menu.classList.add('hidden');

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

        if (tab === 'all') {
            var html = '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px;">';
            if (eventsData.length === 0) {
                html += '<div style="opacity:0.6;">' + (isRo ? 'Nu există evenimente active.' : 'No active events.') + '</div>';
            } else {
                eventsData.forEach(function (ev) {
                    var color = getEventColor(ev.event_date);
                    html += '<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(184,216,240,0.18); border-radius:10px; padding:16px; display:flex; flex-direction:column; justify-content:space-between;">' +
                        '<div>' +
                        '<div style="font-size:0.7rem; color:' + color + '; font-weight:700; margin-bottom:4px;">● ' + formatDate(ev.event_date) + '</div>' +
                        '<h4 style="margin:0 0 6px 0; font-size:1rem; color:#F5F0EB;">' + escapeHtml(ev.title) + '</h4>' +
                        '<p style="margin:0 0 10px 0; font-size:0.78rem; opacity:0.8; line-height:1.4;">' + escapeHtml(ev.description || '') + '</p>' +
                        '<div style="font-size:0.72rem; opacity:0.6; margin-bottom:12px;">👤 ' + escapeHtml(ev.creator_name || 'User') + '</div>' +
                        '</div>' +
                        '<button type="button" onclick="window._openInquiryModal(\'' + ev.id + '\')" style="background:#E8772A; border:none; border-radius:6px; color:#fff; font-weight:600; padding:8px; cursor:pointer; font-size:0.78rem;">' + (isRo ? 'Trimite Cerere' : 'Send Inquiry') + '</button>' +
                        '</div>';
                });
            }
            html += '</div>';
            contentEl.innerHTML = html;
        } else {
            // My events & chats
            var myEvs = eventsData.filter(function (e) { return e.creator_id === user.id; });
            
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

            var html = '<h3 style="font-size:1.05rem; color:var(--sky); margin-bottom:8px;">' + (isRo ? 'Evenimentele create de tine' : 'Events Created By You') + '</h3>';
            if (myEvs.length === 0) {
                html += '<div style="font-size:0.78rem; opacity:0.6; margin-bottom:20px;">' + (isRo ? 'Nu ai creat niciun eveniment.' : 'You have not created any events.') + '</div>';
            } else {
                html += '<div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">';
                myEvs.forEach(function (ev) {
                    html += '<div style="background:rgba(255,255,255,0.04); border:1px solid rgba(184,216,240,0.15); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">' +
                        '<div><strong>' + escapeHtml(ev.title) + '</strong><div style="font-size:0.72rem; opacity:0.7;">' + formatDate(ev.event_date) + '</div></div>' +
                        '<div style="display:flex; gap:8px;">' +
                        '<button type="button" onclick="window._manageEvent(\'' + ev.id + '\')" style="background:#6B3FA0; border:none; border-radius:6px; color:#fff; padding:6px 10px; font-size:0.75rem; cursor:pointer; font-weight:600;">' + (isRo ? 'Gestionează' : 'Manage') + '</button>' +
                        '<button type="button" onclick="window._openEventChat(\'' + ev.id + '\')" style="background:#0D2B5E; border:1px solid rgba(184,216,240,0.3); border-radius:6px; color:var(--sky); padding:6px 10px; font-size:0.75rem; cursor:pointer; font-weight:600;">💬 Chat</button>' +
                        '</div></div>';
                });
                html += '</div>';
            }

            html += '<h3 style="font-size:1.05rem; color:var(--sky); margin-bottom:8px;">' + (isRo ? 'Evenimente la care participi (Chat activ)' : 'Events You Attend (Active Chat)') + '</h3>';
            if (attEvents.length === 0) {
                html += '<div style="font-size:0.78rem; opacity:0.6;">' + (isRo ? 'Nu participi la niciun eveniment aprobat.' : 'You are not attending any approved events.') + '</div>';
            } else {
                html += '<div style="display:flex; flex-direction:column; gap:8px;">';
                attEvents.forEach(function (ev) {
                    html += '<div style="background:rgba(255,255,255,0.04); border:1px solid rgba(184,216,240,0.15); border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">' +
                        '<div><strong>' + escapeHtml(ev.title) + '</strong><div style="font-size:0.72rem; opacity:0.7;">' + formatDate(ev.event_date) + '</div></div>' +
                        '<button type="button" onclick="window._openEventChat(\'' + ev.id + '\')" style="background:#0D2B5E; border:1px solid rgba(184,216,240,0.3); border-radius:6px; color:var(--sky); padding:6px 12px; font-size:0.75rem; cursor:pointer; font-weight:600;">💬 Deschide Chat</button>' +
                        '</div>';
                });
                html += '</div>';
            }

            contentEl.innerHTML = html;
        }
    };

    // ── EVENT CHAT SYSTEM ──
    window._openEventChat = function (eventId) {
        var ev = eventsData.find(function (e) { return e.id === eventId; });
        if (!ev) return;
        activeChatEventId = eventId;

        var existing = document.getElementById('eventChatModal');
        if (existing) existing.remove();

        var isRo = (window._currentLang && window._currentLang() === 'ro');
        var user = getCurrentUser();

        var modal = document.createElement('div');
        modal.id = 'eventChatModal';
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 4500; background: rgba(4,10,22,0.92); backdrop-filter: blur(12px); display: flex; flex-direction: column; padding: 16px;';

        var box = document.createElement('div');
        box.style.cssText = 'max-width: 600px; width: 100%; margin: 0 auto; height: 100%; display: flex; flex-direction: column; background: rgba(10,20,42,0.98); border: 1px solid rgba(184,216,240,0.25); border-radius: 12px; overflow: hidden;';

        // Header with timer and calendar add
        box.innerHTML = '<div style="background: rgba(6,14,30,0.95); padding: 12px 16px; border-bottom: 1px solid rgba(184,216,240,0.15); display: flex; flex-direction: column; gap: 6px;">' +
            '<div style="display: flex; justify-content: space-between; align-items: center;">' +
            '<strong style="font-size: 1rem; color: #F5F0EB;">' + escapeHtml(ev.title) + '</strong>' +
            '<button type="button" onclick="document.getElementById(\'eventChatModal\').remove()" style="background:none; border:none; color:var(--sky); font-size:1.2rem; cursor:pointer;">✕</button>' +
            '</div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem;">' +
            '<span id="chatTimer" style="color: #ffc832; font-weight: 600;">⏰ Eveniment: ' + formatDate(ev.event_date) + '</span>' +
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

        loadChatMessages(eventId);

        // Enter key to send
        document.getElementById('chatInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') window._sendChatMessage();
        });
    };

    async function loadChatMessages(eventId) {
        var listEl = document.getElementById('chatMessagesList');
        if (!listEl) return;
        var user = getCurrentUser();

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
            html = '<div style="text-align:center; opacity:0.5; font-size:0.8rem; margin-top:20px;">Niciun mesaj încă. Începe conversația!</div>';
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
        var msg = {
            id: 'msg_' + Math.random().toString(36).substring(2, 9),
            event_id: activeChatEventId,
            user_id: user.id,
            user_name: user.name || user.email.split('@')[0],
            message: text,
            media_url: null,
            media_type: 'none',
            created_at: new Date().toISOString()
        };

        try {
            if (window.supabaseClient) {
                await window.supabaseClient.from('event_chat_messages').insert([msg]);
            }
        } catch (e) {}

        var msgs = getLocalMessages();
        msgs.push(msg);
        saveLocalMessages(msgs);

        input.value = '';
        loadChatMessages(activeChatEventId);
    };

    window._handleChatMedia = function (input) {
        if (!input.files || !input.files[0] || !activeChatEventId) return;
        var file = input.files[0];
        var reader = new FileReader();

        reader.onload = async function (e) {
            var dataUrl = e.target.result;
            var isVideo = file.type.startsWith('video');
            var user = getCurrentUser();

            var msg = {
                id: 'msg_' + Math.random().toString(36).substring(2, 9),
                event_id: activeChatEventId,
                user_id: user.id,
                user_name: user.name || user.email.split('@')[0],
                message: '',
                media_url: dataUrl,
                media_type: isVideo ? 'video' : 'image',
                created_at: new Date().toISOString()
            };

            try {
                if (window.supabaseClient) {
                    await window.supabaseClient.from('event_chat_messages').insert([msg]);
                }
            } catch (err) {}

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
        setInterval(checkNotifications, 30000);
    });

    // Expose init
    window._initEventsLayer = initEventsLayer;
})();
