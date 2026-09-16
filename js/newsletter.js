/* ═══════════════════════════════════════════════════════════════════════
   DetectLab Newsletter — frontend
   ───────────────────────────────────────────────────────────────────────
   · Links the registration checkbox (js/auth.js) to the DB (profiles.newsletter_subscribed)
     via the backend newsletter API.
   · Account panel toggle: subscribe / unsubscribe with instant feedback.
   · Admin differentiation helpers (used by console / future admin UI).
   · Handles ?unsubscribe=USER_ID one-click links from e-mails.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var API = (typeof window._dlApiBase !== 'undefined' && window._dlApiBase)
        ? window._dlApiBase
        : 'https://detectlab-backend-production.up.railway.app/api';

    // Allow overriding via <meta name="detectlab-api" content="...">
    try {
        var m = document.querySelector('meta[name=\"detectlab-api\"]');
        if (m && m.content) API = m.content.replace(/\/$/, '');
    } catch (e) {}

    var _status = { subscribed: false, email: null, loading: false };
    var _listeners = [];

    function currentUser() {
        return (typeof window._authUser === 'function') ? window._authUser() : null;
    }

    async function getToken() {
        if (typeof window._dlAccessToken === 'function') {
            try { return await window._dlAccessToken(); } catch (e) {}
        }
        if (window.supabaseClient && window.supabaseClient.auth && window.supabaseClient.auth.getSession) {
            try {
                var r = await window.supabaseClient.auth.getSession();
                var s = r && r.data && r.data.session;
                return s ? s.access_token : null;
            } catch (e) { return null; }
        }
        return null;
    }

    async function fetchStatus() {
        var token = await getToken();
        if (!token) {
            _status.loading = false;
            renderNewsletterToggle();
            return _status;
        }
        _status.loading = true;
        try {
            var res = await fetch(API + '/newsletter/status', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.ok) {
                var data = await res.json();
                _status.subscribed = !!data.subscribed;
                _status.email = data.email || null;
                _status.subscribed_at = data.subscribed_at || null;
                _status.unsubscribed_at = data.unsubscribed_at || null;
            } else if (res.status === 404 || res.status === 503) {
                // Table not migrated yet — fallback to Supabase direct read
                await fetchStatusFallback();
            }
        } catch (e) {
            await fetchStatusFallback();
        } finally {
            _status.loading = false;
            renderNewsletterToggle();
            notify();
        }
        return _status;
    }

    async function fetchStatusFallback() {
        try {
            var u = currentUser();
            if (!u || !window.supabaseClient || !window.supabaseClient.from) return;
            var res = await window.supabaseClient.from('profiles')
                .select('newsletter_subscribed, newsletter_subscribed_at, newsletter_unsubscribed_at')
                .eq('id', u.id)
                .maybeSingle();
            if (res && !res.error && res.data) {
                _status.subscribed = !!res.data.newsletter_subscribed;
                _status.subscribed_at = res.data.newsletter_subscribed_at || null;
                _status.unsubscribed_at = res.data.newsletter_unsubscribed_at || null;
            }
        } catch (e) {}
    }

    window.loadNewsletterStatus = fetchStatus;
    window.getNewsletterStatus = function () { return { subscribed: _status.subscribed, email: _status.email }; };

    function notify() {
        window.dispatchEvent(new CustomEvent('detectlab:newsletterchange', { detail: { subscribed: _status.subscribed } }));
    }

    async function setSubscribed(want) {
        var token = await getToken();
        if (!token) {
            if (typeof window.openAuth === 'function') window.openAuth('login');
            return { ok: false, error: 'not_logged_in' };
        }
        var endpoint = want ? '/newsletter/subscribe' : '/newsletter/unsubscribe';
        try {
            var res = await fetch(API + endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
            _status.subscribed = want;
            if (want) { _status.subscribed_at = data.subscribed_at || new Date().toISOString(); _status.unsubscribed_at = null; }
            else { _status.unsubscribed_at = data.unsubscribed_at || new Date().toISOString(); }
            renderNewsletterToggle();
            notify();
            return { ok: true, subscribed: _status.subscribed };
        } catch (err) {
            // Fallback: direct Supabase update (if backend not deployed yet)
            try {
                var u = currentUser();
                if (u && window.supabaseClient && window.supabaseClient.from) {
                    var payload = want
                        ? { id: u.id, newsletter_subscribed: true, newsletter_subscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
                        : { id: u.id, newsletter_subscribed: false, newsletter_unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
                    // Use upsert to handle missing profiles row
                    var r2 = await window.supabaseClient.from('profiles').upsert(payload, { onConflict: 'id' });
                    if (!r2.error) {
                        _status.subscribed = want;
                        renderNewsletterToggle();
                        notify();
                        return { ok: true, subscribed: _status.subscribed };
                    }
                }
            } catch (e2) {}
            console.error('[Newsletter] setSubscribed failed:', err);
            return { ok: false, error: err.message || 'failed' };
        }
    }

    window.setNewsletterSubscribed = setSubscribed;
    window.toggleNewsletter = async function () { return setSubscribed(!_status.subscribed); };

    /* ── UI: account panel toggle ─────────────────────────────────── */
    function renderNewsletterToggle() {
        var wrap = document.getElementById('acctNewsletterWrap');
        var chk = document.getElementById('acctNewsletterToggle');
        var label = document.getElementById('acctNewsletterLabel');
        var desc = document.getElementById('acctNewsletterDesc');
        var statusEl = document.getElementById('acctNewsletterStatus');
        if (!wrap) return;

        var u = currentUser();
        wrap.style.display = u ? '' : 'none';
        if (!u) return;

        if (_status.loading) {
            if (chk) chk.disabled = true;
            if (statusEl) statusEl.textContent = '…';
            return;
        }
        if (chk) {
            chk.checked = !!_status.subscribed;
            chk.disabled = false;
        }
        if (label) label.textContent = _status.subscribed ? 'Abonat la newsletter ✓' : 'Abonează-te la newsletter';
        if (desc) desc.textContent = _status.subscribed
            ? 'Primești noutăți, reduceri și hărți noi (max. 2 e-mailuri/lună).'
            : 'Bifează pentru a primi reduceri și informații utile pe e-mail.';
        if (statusEl) {
            statusEl.textContent = _status.subscribed ? 'ABONAT' : 'NEABONAT';
            statusEl.className = 'account-newsletter-badge ' + (_status.subscribed ? 'subscribed' : 'unsubscribed');
        }
    }
    window.renderNewsletterToggle = renderNewsletterToggle;

    async function handleToggleChange(e) {
        var chk = e.target;
        var want = !!chk.checked;
        chk.disabled = true;
        var res = await setSubscribed(want);
        if (!res.ok) {
            // Revert checkbox on failure
            chk.checked = !_status.subscribed ? false : true; // keep previous
            chk.checked = _status.subscribed;
            var msgEl = document.getElementById('acctNewsletterMsg');
            if (msgEl) {
                msgEl.textContent = res.error === 'not_logged_in' ? 'Trebuie să fii autentificat.' : 'Nu s-a putut actualiza abonarea. Încearcă din nou.';
                msgEl.className = 'account-msg error';
                setTimeout(function () { if (msgEl) { msgEl.textContent = ''; msgEl.className = 'account-msg'; } }, 3500);
            }
        } else {
            var msgEl2 = document.getElementById('acctNewsletterMsg');
            if (msgEl2) {
                msgEl2.textContent = want ? 'Te-ai abonat la newsletter! ✓' : 'Te-ai dezabonat de la newsletter.';
                msgEl2.className = 'account-msg success';
                setTimeout(function () { if (msgEl2) { msgEl2.textContent = ''; msgEl2.className = 'account-msg'; } }, 3500);
            }
        }
        chk.disabled = false;
        renderNewsletterToggle();
    }

    /* ── Admin differentiation helpers (console / future admin UI) ─── */
    window.fetchNewsletterAudience = async function (opts) {
        opts = opts || {};
        var token = await getToken();
        if (!token) throw new Error('Not logged in');
        var qs = '?limit=' + encodeURIComponent(opts.limit || 200);
        if (opts.subscribed === true) qs += '&subscribed=true';
        if (opts.subscribed === false) qs += '&subscribed=false';
        var res = await fetch(API + '/newsletter/subscribers' + qs, {
            headers: { 'Authorization': 'Bearer ' + token, 'x-admin-key': opts.adminKey || '' }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text().catch(function(){return '';}).then(function(t){return t.slice(0,300);}));
        return res.json();
    };

    /* ── One-click unsubscribe from e-mail (?unsubscribe=USER_ID) ──── */
    function handleUnsubscribeParam() {
        try {
            var params = new URLSearchParams(window.location.search);
            var uid = params.get('unsubscribe');
            if (!uid) return;
            // Remove param from URL without reload
            var clean = window.location.pathname + (window.location.search.replace(/[?&]unsubscribe=[^&]*/,'').replace(/^&/,'?')) + window.location.hash;
            try { history.replaceState(null, '', clean); } catch(e){}
            // If logged in as that user, unsubscribe immediately; otherwise prompt login
            window._authReadyPromise && window._authReadyPromise.then(function () {
                var u = currentUser();
                if (u && u.id === uid) {
                    setSubscribed(false).then(function (r) {
                        if (r.ok) alert('Te-ai dezabonat de la newsletter. Te poți reabona oricând din panoul contului.');
                    });
                } else if (u) {
                    if (confirm('Vrei să te dezabonezi de la newsletter pentru contul ' + (u.email || '') + '?')) {
                        setSubscribed(false);
                    }
                } else {
                    if (typeof window.openAuth === 'function') window.openAuth('login');
                }
            });
        } catch(e){}
    }

    /* ── Init ─────────────────────────────────────────────────────── */
    function init() {
        var chk = document.getElementById('acctNewsletterToggle');
        if (chk) chk.addEventListener('change', handleToggleChange);

        // Keep toggle in sync with auth changes
        window.addEventListener('detectlab:authchange', function () {
            fetchStatus();
        });
        if (window._authReadyPromise) {
            window._authReadyPromise.then(function () { fetchStatus(); handleUnsubscribeParam(); });
        } else {
            setTimeout(function () { fetchStatus(); handleUnsubscribeParam(); }, 500);
        }
        // Also handle late PWA overlay open
        document.addEventListener('DOMContentLoaded', function () {
            var chk2 = document.getElementById('acctNewsletterToggle');
            if (chk2 && !chk2._dlBound) { chk2.addEventListener('change', handleToggleChange); chk2._dlBound = true; }
            renderNewsletterToggle();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    console.log('✅ Newsletter JS loaded');
})();
