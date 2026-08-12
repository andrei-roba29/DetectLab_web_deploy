
    async function register(username, email, password) {

        const res = await fetch("http://localhost:3000/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username,
                email,
                password
            })
        });

        const data = await res.json();

        console.log(data);

        if (data.success) {

            alert("REGISTER SUCCESS");

        } else {

            alert(data.error);

        }
    }



    async function login(email, password) {

        const res = await fetch("http://localhost:3000/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email,
                password
            })
        });

        const data = await res.json();

        console.log(data);

        if (data.success) {

            localStorage.setItem("token", data.token);

            alert("LOGIN SUCCESS");

        } else {

            alert(data.error);

        }
    }



    /* ── AUTH GATE SLIDESHOW ── */
    (function initAuthGateSlideshow() {
        var slides = document.querySelectorAll('#authGateSlideshow .auth-gate-slide');
        var current = 0;
        var DURATION = 8000; // ms per slide (matches CSS animation duration ~9s, cross-fade at 8s)
        var timer = null;

        function showSlide(idx) {
            slides.forEach(function (s, i) {
                s.classList.remove('active');
                // Reset animation by cloning trick
                var clone = s.cloneNode(true);
                s.parentNode.replaceChild(clone, s);
                slides[i] = clone;
            });
            // Re-query after replace
            slides = document.querySelectorAll('#authGateSlideshow .auth-gate-slide');
            slides[idx].classList.add('active');
            current = idx;
        }

        function nextSlide() {
            var next = (current + 1) % slides.length;
            showSlide(next);
        }

        // Start slideshow only when the gate becomes visible
        var gate = document.getElementById('mapAuthGate');
        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                if (m.attributeName === 'class') {
                    var hidden = gate.classList.contains('hidden');
                    if (!hidden && !timer) {
                        showSlide(0);
                        timer = setInterval(nextSlide, DURATION);
                    } else if (hidden && timer) {
                        clearInterval(timer);
                        timer = null;
                    }
                }
            });
        });
        observer.observe(gate, { attributes: true });
    })();

    /*User dropdown JS*/

    function toggleUserMenu() {

        document
            .getElementById("userMenu")
            .classList
            .toggle("hidden");
    }


    function openAccount() {
        var menu = document.getElementById('userMenu');
        if (menu) menu.classList.add('hidden');

        // In PWA standalone mode route to the overlay flow: the desktop flow
        // below hides the map and calls scrollIntoView(), which strands the
        // user away from the map in standalone mode.
        if (document.body.classList.contains('is-pwa') &&
            typeof window.pwaOpenAccount === 'function') {
            window.pwaOpenAccount();
            return;
        }

        var user = (typeof window._authUser === 'function') ? window._authUser() : null;
        if (!user) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return;
        }

        // Leave whichever map tab is active and switch into the account view
        document.querySelectorAll('.map-tab').forEach(function (b) { b.classList.remove('active'); });

        var weatherPanel = document.getElementById('weatherPanel');
        var mapWrapper = document.querySelector('.map-wrapper');
        var mapFrame = document.querySelector('.map-frame');
        var mapLegend = document.querySelector('.map-legend-bar');
        var mapControls = document.querySelector('.map-controls');
        var mapHeader = document.querySelector('.map-header');
        var transpTab = document.getElementById('transpTab');
        var transpPanel = document.getElementById('transpPanel');
        var mapSearch = document.getElementById('mapSearchWrap');
        var mapLock = document.getElementById('mapLock');
        var gate = document.getElementById('mapAuthGate');

        if (weatherPanel) weatherPanel.classList.remove('active');
        if (mapWrapper) mapWrapper.style.display = 'none';
        if (mapFrame) mapFrame.style.display = 'none';
        if (mapLegend) mapLegend.style.display = 'none';
        if (mapControls) mapControls.style.display = 'none';
        if (mapHeader) mapHeader.style.display = 'none';
        if (transpTab) transpTab.style.display = 'none';
        if (transpPanel) transpPanel.style.display = 'none';
        if (mapSearch) mapSearch.style.display = 'none';
        if (mapLock) mapLock.classList.remove('show');
        if (gate) gate.classList.add('hidden');

        renderAccountPanel(user);

        var accountPanel = document.getElementById('accountPanel');
        if (accountPanel) accountPanel.classList.add('active');

        // Scroll the account panel into view in case the user opened it
        // while still up near the top of the page (e.g. the nav bar).
        if (accountPanel) {
            setTimeout(function () {
                accountPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
        }
    }

    function closeAccountPanel() {
        // In PWA standalone mode the account panel lives inside the PWA
        // overlay; pwaCloseAccount() hides the overlay and restores the
        // panel. Routing here keeps logout / delete-account flows from
        // stranding the user in an overlay with no way back to the map.
        if (document.body.classList.contains('is-pwa') &&
            typeof window.pwaCloseAccount === 'function') {
            window.pwaCloseAccount();
            return;
        }

        var accountPanel = document.getElementById('accountPanel');
        if (accountPanel) accountPanel.classList.remove('active');

        // Always undo the inline styles openAccount() applied. switchTab()
        // (below) only knows about the free/premium tab state — it doesn't
        // know about mapLegend/mapControls/mapHeader/transpTab/transpPanel/
        // mapSearch, so it can never restore these on its own.
        var mapWrapper = document.querySelector('.map-wrapper');
        var mapFrame = document.querySelector('.map-frame');
        var mapLegend = document.querySelector('.map-legend-bar');
        var mapControls = document.querySelector('.map-controls');
        var mapHeader = document.querySelector('.map-header');
        var transpTab = document.getElementById('transpTab');
        var transpPanel = document.getElementById('transpPanel');
        var mapSearch = document.getElementById('mapSearchWrap');
        if (mapWrapper) mapWrapper.style.display = '';
        if (mapFrame) mapFrame.style.display = '';
        if (mapLegend) mapLegend.style.display = 'flex';
        if (mapControls) mapControls.style.display = 'flex';
        if (mapHeader) mapHeader.style.display = '';
        if (transpTab) transpTab.style.display = '';
        if (transpPanel) transpPanel.style.display = '';
        if (mapSearch) mapSearch.style.display = '';

        var freeBtn = document.querySelector('.map-tab.t[data-key="tab_free"]') || document.querySelector('.map-tab');
        if (freeBtn && typeof window.switchTab === 'function') {
            freeBtn.classList.add('active');
            window.switchTab(freeBtn, 'free');
        }

        // Leaflet caches its container size; if the map was hidden while its
        // container had 0x0 dimensions, it needs a nudge to redraw properly
        // now that the container is visible again.
        if (window.map && typeof window.map.invalidateSize === 'function') {
            setTimeout(function () { window.map.invalidateSize(); }, 50);
        }
    }

    function renderAccountPanel(user) {
        var avatarEl = document.getElementById('acctAvatar');
        var nameEl = document.getElementById('acctName');
        var emailEl = document.getElementById('acctEmail');
        var badgeEl = document.getElementById('acctPlanBadge');
        var daysEl = document.getElementById('acctPlanDays');

        if (avatarEl) avatarEl.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
        if (nameEl) nameEl.textContent = user.name || user.email || 'Account';
        if (emailEl) emailEl.textContent = user.email || '—';

        // Subscription level: reads user.plan / user.premiumExpiresAt if the
        // backend provides them, defaults to Free otherwise.
        var isPremium = user.plan === 'premium' || user.isPremium === true;
        if (badgeEl) {
            badgeEl.textContent = isPremium ? 'PREMIUM' : 'FREE';
            badgeEl.className = 'account-plan-badge ' + (isPremium ? 'premium' : 'free');
        }
        if (daysEl) {
            daysEl.textContent = '';
            if (isPremium && user.premiumExpiresAt) {
                var msLeft = new Date(user.premiumExpiresAt).getTime() - Date.now();
                var daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
                daysEl.textContent = daysLeft + (daysLeft === 1 ? ' day left' : ' days left');
            }
        }

        ['acctPwCurrent', 'acctPwNew', 'acctPwConfirm'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        var msgEl = document.getElementById('acctPwMsg');
        if (msgEl) { msgEl.textContent = ''; msgEl.className = 'account-msg'; }
    }

    // Exposed so the PWA account overlay (inline script in index.html) can
    // refresh the account card without running the desktop openAccount() flow.
    window.renderAccountPanel = renderAccountPanel;

    async function submitChangePassword() {
        var msgEl = document.getElementById('acctPwMsg');
        var btn = document.getElementById('acctPwSubmitBtn');
        function setMsg(text, type) {
            if (!msgEl) return;
            msgEl.textContent = text;
            msgEl.className = 'account-msg ' + (type || 'error');
        }

        if (!window.supabaseClient || !window.supabaseClient.auth) {
            setMsg('Auth is not ready. Please refresh the page and try again.');
            return;
        }

        var current = document.getElementById('acctPwCurrent').value;
        var next = document.getElementById('acctPwNew').value;
        var confirmPw = document.getElementById('acctPwConfirm').value;

        if (!current || !next || !confirmPw) { setMsg('Please fill in all fields.'); return; }
        if (next.length < 8) { setMsg('New password must be at least 8 characters.'); return; }
        if (next !== confirmPw) { setMsg('New passwords do not match.'); return; }

        btn.textContent = 'Updating…'; btn.disabled = true;
        try {
            var userRes = await window.supabaseClient.auth.getUser();
            var authUser = userRes.data && userRes.data.user;
            if (!authUser || !authUser.email) throw new Error('You must be logged in.');

            // Verify the current password by re-authenticating with it.
            var signInRes = await window.supabaseClient.auth.signInWithPassword({
                email: authUser.email,
                password: current
            });
            if (signInRes.error) throw new Error('Current password is incorrect.');

            // Now actually change the password.
            var updateRes = await window.supabaseClient.auth.updateUser({ password: next });
            if (updateRes.error) throw updateRes.error;

            setMsg('Password updated successfully.', 'success');
            ['acctPwCurrent', 'acctPwNew', 'acctPwConfirm'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });
        } catch (err) {
            console.error('submitChangePassword error:', err);
            setMsg(err.message || 'Could not update password. Please try again.');
        } finally {
            btn.textContent = 'Update Password'; btn.disabled = false;
        }
    }

    async function confirmDeleteAccount() {
        if (!window.supabaseClient || !window.supabaseClient.auth) return;

        var userRes = await window.supabaseClient.auth.getUser();
        var authUser = userRes.data && userRes.data.user;
        if (!authUser) return;

        var ok = confirm('This will permanently delete your DetectLab account and all associated data. This cannot be undone. Continue?');
        if (!ok) return;

        var btn = document.querySelector('.account-btn.danger');
        if (btn) { btn.textContent = 'Deleting…'; btn.disabled = true; }

        try {
            // Deleting a Supabase Auth user requires the service_role key,
            // which must never be exposed in the browser. So this calls a
            // Supabase Edge Function ("delete-account") that runs server-side
            // with the service_role key and does the actual deletion.
            // See supabase/functions/delete-account/index.ts for that function.
            var sessionRes = await window.supabaseClient.auth.getSession();
            var accessToken = sessionRes.data && sessionRes.data.session && sessionRes.data.session.access_token;
            if (!accessToken) throw new Error('No active session. Please log in again.');

            var invokeRes = await window.supabaseClient.functions.invoke('delete-account', {
                headers: { Authorization: 'Bearer ' + accessToken }
            });
            if (invokeRes.error) throw invokeRes.error;
        } catch (err) {
            console.error('confirmDeleteAccount error:', err);
            alert(err.message || 'Could not delete your account. Please try again.');
            if (btn) { btn.textContent = 'Delete Account'; btn.disabled = false; }
            return;
        }

        closeAccountPanel();
        if (typeof window.authLogout === 'function') window.authLogout();
    }

    function openTerms() {
        var modal = document.getElementById('termsModal');
        if (modal) modal.classList.add('show');
    }

    function closeTerms() {
        var modal = document.getElementById('termsModal');
        if (modal) modal.classList.remove('show');
    }

    document.addEventListener('DOMContentLoaded', function () {
        var termsModal = document.getElementById('termsModal');
        if (termsModal) {
            termsModal.addEventListener('click', function (e) {
                if (e.target === termsModal) closeTerms();
            });
        }
    });


    // NOTE: there used to be a `function openEvents()` shim here that called
    // window.openEvents(). Because this file is a classic (non-module) script,
    // that top-level declaration created a *global* binding, i.e. it overwrote
    // window.openEvents — the real implementation installed by js/events.js,
    // which is loaded earlier. The shim therefore called itself recursively and
    // the inline onclick="openEvents()" handlers blew the stack instead of
    // opening the events panel (the badge still rendered, so the button just
    // looked dead). js/events.js already exposes window.openEvents globally, so
    // no shim is needed here.

