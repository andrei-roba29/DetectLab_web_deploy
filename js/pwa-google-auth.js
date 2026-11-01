/* ══════════════════════════════════════════════════════════════
   DetectLab — Google sign-in that keeps the installed app looking
   like an app (no browser address/navigation bars).

   The bars are BROWSER CONTROLS created by the platform whenever the
   sign-in flow leaves the installed window, so they cannot be hidden
   from CSS — the flow itself has to be shaped per platform:

   • Normal browser tab (any OS)
       Supabase signInWithOAuth performs a same-window redirect
       (window.location.assign inside supabase-js). The tab is already
       a browser tab, so nothing changes for ordinary web sign-in.

   • Installed Android / desktop app (display-mode standalone etc.)
       The same same-window redirect: window.location keeps every step
       (app → Supabase → Google → Supabase → app) inside the standalone
       window, which has no omnibox, and the session lands directly in
       the app's own storage. A window.open popup here would become a
       separate Chrome window with an address bar, which is exactly the
       bug the previous Google Identity Services popup introduced.

   • Installed iOS Home Screen app (navigator.standalone)
       A top-level navigation to Google is out of the manifest scope,
       and iOS hands those to a Safari View Controller sheet — Safari
       address bar + toolbar, and a storage partition the app never
       sees, so the session would be stranded in the sheet. Apple's
       documented way to keep OAuth inside a Home Screen web app is
       window.open from the app's own document ("links loaded through
       window.open will always open in the web app regardless of
       scope" — WWDC23, "What's new in web apps"). So on iOS we open
       the Supabase authorize URL from the button tap itself, let the
       flow finish on the app origin inside that window, hand the
       session back to the installed app (postMessage targeted at our
       own origin + BroadcastChannel, then setSession, which fires the
       normal SIGNED_IN UI sync), and close the helper window.

   Google Identity Services is gone from this path: its button opened
   the popup from Google's cross-origin iframe, which is what surfaced
   browser chrome on both platforms. Credentials are never read here —
   they are typed into Google's own page, and only the resulting
   Supabase session tokens ever move, and only between same-origin
   windows of this app.

   See PWA_GOOGLE_SIGN_IN.md for the Google Cloud / Supabase
   configuration and the real-device verification checklist.
   ══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var CHANNEL = 'detectlab-google-auth';
    var MESSAGE_TYPE = 'detectlab:google-auth';
    var POPUP_MARKER = 'dl-google-auth-popup';
    var POPUP_WINDOW_NAME = 'detectlab-google-auth-flow';

    var MSG_REDIRECT = 'Redirecting to Google…';
    var MSG_OPENING = 'Opening Google sign-in…';
    var MSG_WAITING = 'Finish signing in on the Google page.';
    var MSG_BLOCKED = 'Your browser blocked the Google sign-in window. Tap “Continue with Google” again to allow it.';
    var MSG_ALREADY_OPEN = 'The Google sign-in window is already open. Finish it to continue.';
    var MSG_CANCELLED = 'Google sign-in was cancelled. You can try again, or use your email and password.';
    var MSG_FAILED = 'Google sign-in could not be completed. Please try again.';
    var MSG_START_FAILED = 'Google sign-in could not be started. Please try again.';
    var MSG_POPUP_LOST = 'Google sign-in could not be completed. Return to the DetectLab window and try again.';
    var MSG_STILL_OPEN = 'Signed in with Google! Return to the DetectLab window to continue.';

    var ui = null;                 // { message, clear, close } injected by auth.js
    var pending = null;            // state of the in-flight iOS helper window
    var broadcast = null;
    var listening = false;
    var popupHandled = false;

    /* ── Platform detection ─────────────────────────────────────── */

    function installed() {
        try {
            return window.navigator.standalone === true ||
                window.matchMedia('(display-mode: standalone)').matches ||
                window.matchMedia('(display-mode: fullscreen)').matches ||
                /[?&]pwa=1(&|$)/.test(window.location.search);
        } catch (_) {
            return window.navigator.standalone === true;
        }
    }

    function isIosUa() {
        var ua = window.navigator.userAgent || '';
        if (/iPhone|iPad|iPod/.test(ua)) return true;
        // iPadOS 13+ masquerades as a Macintosh but keeps touch points.
        return /Macintosh/.test(ua) && (window.navigator.maxTouchPoints || 0) > 1;
    }

    /* A Home Screen web app, not an iOS browser tab: navigator.standalone
       is true only inside the installed app (false in a Safari tab), and
       it still works on iOS 26 where every site added to the Home Screen
       opens as a web app by default. */
    function isIosHomeScreen() {
        if (!isIosUa()) return false;
        var nav = window.navigator;
        if (typeof nav.standalone === 'boolean') return nav.standalone === true;
        // Future WebKit without navigator.standalone: fall back to display-mode.
        try {
            return window.matchMedia('(display-mode: standalone)').matches ||
                window.matchMedia('(display-mode: fullscreen)').matches;
        } catch (_) { return false; }
    }

    /* 'popup'  — iOS Home Screen app: Google must be opened with
                  window.open from the app's own document.
       'redirect' — everything else: one same-window top-level redirect. */
    function flow() {
        return (installed() && isIosHomeScreen()) ? 'popup' : 'redirect';
    }

    function needsPopup() { return flow() === 'popup'; }

    /* ── URL helpers (OAuth return handling) ────────────────────── */

    function oauthErrorFromUrl() {
        var raw = String(window.location.hash || '').replace(/^#/, '') + '&' +
            String(window.location.search || '').replace(/^\?/, '');
        if (!raw || raw === '&') return null;
        var params;
        try { params = new URLSearchParams(raw); } catch (_) { return null; }
        var error = params.get('error') || params.get('error_code') || null;
        var description = params.get('error_description') || '';
        if (!error && !description) return null;
        return { error: error || 'unknown_error', description: String(description) };
    }

    function hasAuthParams() {
        try {
            return /[?&#](access_token|refresh_token|id_token|error|error_description|error_code|code)=/i.test(
                String(window.location.search || '') + String(window.location.hash || '')
            );
        } catch (_) { return false; }
    }

    function cleanOAuthErrorParams() {
        try {
            var drop = function (part) {
                return part.split('&').filter(function (kv) {
                    return !/^(error|error_description|error_code)=/.test(kv);
                }).join('&');
            };
            var search = drop(String(window.location.search || '').replace(/^\?/, ''));
            var hash = drop(String(window.location.hash || '').replace(/^#/, ''));
            var next = window.location.pathname + (search ? '?' + search : '') + (hash ? '#' + hash : '');
            var current = String(window.location.pathname || '') +
                String(window.location.search || '') + String(window.location.hash || '');
            if (next !== current && window.history && window.history.replaceState) {
                window.history.replaceState(window.history.state, '', next);
            }
        } catch (_) { /* URL cleanup is best-effort */ }
    }

    /* ── Session helpers ────────────────────────────────────────── */

    function authClient() {
        return (window.supabaseClient && window.supabaseClient.auth) || null;
    }

    function currentSession() {
        var auth = authClient();
        if (!auth || !auth.getSession) return Promise.resolve(null);
        return Promise.resolve()
            .then(function () { return auth.getSession(); })
            .then(function (res) { return (res && res.data && res.data.session) || null; })
            .catch(function () { return null; });
    }

    /* Adopt the popup's session in this window. supabase-js ≥ 2.30 takes
       one object; older builds take two strings — the arity decides. */
    function adoptSession(tokens) {
        var auth = authClient();
        if (!auth || !auth.setSession) return Promise.reject(new Error('Supabase not ready'));
        var call = (auth.setSession.length >= 2)
            ? auth.setSession(tokens.access_token, tokens.refresh_token)
            : auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
        return Promise.resolve(call).then(function (res) {
            if (res && res.error) throw res.error;
            return true;
        });
    }

    /* ── The flow itself ────────────────────────────────────────── */

    function start() {
        if (!ui) return;
        var auth = authClient();
        if (!auth || !auth.signInWithOAuth) {
            ui.message('Supabase not ready. Please try again.', 'error');
            return;
        }
        if (needsPopup()) {
            startPopup(auth);
            return;
        }
        /* Same-window redirect. supabase-js calls window.location.assign,
           so every hop stays inside this tab / this installed window and
           no second browser window can appear. */
        ui.message(MSG_REDIRECT, 'success');
        auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + (window.location.pathname || '/'),
                queryParams: { access_type: 'offline', prompt: 'consent' }
            }
        }).then(function (res) {
            if (res && res.error) {
                ui.message((res.error.message && String(res.error.message)) || MSG_FAILED, 'error');
            }
        }).catch(function () {
            ui.message(MSG_START_FAILED, 'error');
        });
    }

    function startPopup(auth) {
        if (pending && !pending.settled) {
            var open = false;
            try { open = !pending.win.closed; } catch (_) { open = false; }
            if (open) { ui.message(MSG_ALREADY_OPEN, 'error'); return; }
            clearState(pending);
        }

        /* window.open MUST run inside the tap itself: Safari on iOS expires
           transient activation as soon as a promise boundary passes, and a
           later call would be blocked. No URL is passed, so an engine that
           reuses the current window cannot blank the app — the OAuth URL is
           assigned only after it has been built. The marker is copied into
           the new window's sessionStorage at open time so the return trip
           can recognise itself even if window.opener heuristics differ. */
        try { window.sessionStorage.setItem(POPUP_MARKER, '1'); } catch (_) {}
        var win = null;
        try { win = window.open(); } catch (_) { win = null; }
        try { window.sessionStorage.removeItem(POPUP_MARKER); } catch (_) {}
        if (!win) { ui.message(MSG_BLOCKED, 'error'); return; }

        var selfNavigate = (win === window);
        if (!selfNavigate) {
            // Named while still same-origin (about:blank): the name survives
            // the trip to Google and back and identifies the helper window
            // even if sessionStorage is not cloned into it.
            try { win.name = POPUP_WINDOW_NAME; } catch (_) {}
        }
        ui.message(MSG_OPENING, 'success');

        var state = {
            win: win,
            settled: false,
            timer: null,
            graceTimer: null,
            beforeToken: null
        };
        pending = state;
        if (!selfNavigate) {
            state.timer = setInterval(checkPopup, 350);
            currentSession().then(function (session) {
                state.beforeToken = session ? session.access_token : null;
            });
        }

        auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + (window.location.pathname || '/'),
                skipBrowserRedirect: true,
                queryParams: { access_type: 'offline', prompt: 'consent' }
            }
        }).then(function (res) {
            if (state.settled) return;
            var url = (res && !res.error && res.data && res.data.url) || null;
            if (!url) {
                failStart(state, selfNavigate,
                    (res && res.error && res.error.message) || MSG_START_FAILED);
                return;
            }
            if (selfNavigate) {
                // The engine reused this window: navigate it in place.
                window.location.assign(url);
                return;
            }
            try {
                win.location.href = url;
                ui.message(MSG_WAITING, 'success');
            } catch (_) {
                clearState(state);
                ui.message(MSG_CANCELLED, 'error');
            }
        }).catch(function (err) {
            if (state.settled) return;
            failStart(state, selfNavigate,
                (err && err.message) || MSG_START_FAILED);
        });
    }

    function failStart(state, selfNavigate, message) {
        if (!selfNavigate) { try { state.win.close(); } catch (_) {} }
        clearState(state);
        ui.message(message, 'error');
    }

    /* Poll the helper window: when the user closes it without a result,
       treat the attempt as cancelled after a short grace so an in-flight
       handoff message still wins. */
    function checkPopup() {
        var state = pending;
        if (!state || state.settled || state.graceTimer) return;
        var closed = false;
        try { closed = !!state.win.closed; } catch (_) { closed = false; }
        if (!closed) return;
        state.graceTimer = setTimeout(function () {
            state.graceTimer = null;
            if (!pending || pending !== state || state.settled) return;
            currentSession().then(function (session) {
                if (!pending || pending !== state || state.settled) return;
                if (session && session.access_token &&
                    session.access_token !== state.beforeToken) {
                    // Shared storage: the popup already wrote the session here.
                    finishWithSession(state, session);
                } else {
                    finishCancel(state);
                }
            });
        }, 800);
    }

    function clearState(state) {
        if (!state) return;
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
        if (state.graceTimer) { clearTimeout(state.graceTimer); state.graceTimer = null; }
        if (pending === state) pending = null;
    }

    function finishWithTokens(state, tokens) {
        if (state.settled) return;
        state.settled = true;
        clearState(state);
        adoptSession(tokens).then(function () {
            ui.clear();
            ui.close();
        }).catch(function (err) {
            ui.message((err && err.message) || MSG_FAILED, 'error');
        });
    }

    function finishWithSession(state, session) {
        finishWithTokens(state, {
            access_token: session.access_token,
            refresh_token: session.refresh_token
        });
    }

    function finishCancel(state) {
        if (state.settled) return;
        state.settled = true;
        clearState(state);
        ui.message(MSG_CANCELLED, 'error');
    }

    function finishFailure(state, reason) {
        if (state.settled) return;
        state.settled = true;
        clearState(state);
        if (reason) console.warn('[Google auth] sign-in handoff failed:', reason);
        ui.message(MSG_FAILED, 'error');
    }

    function handleHandoff(data) {
        if (!data || data.type !== MESSAGE_TYPE) return;
        var state = pending;
        if (!state || state.settled) return;
        if (data.status === 'success') {
            if (!data.access_token || !data.refresh_token) return;
            finishWithTokens(state, data);
        } else if (data.status === 'cancelled') {
            finishCancel(state);
        } else if (data.status === 'failed') {
            finishFailure(state, data.error);
        }
    }

    function onWindowMessage(event) {
        // Same-origin only: the tokens are the user's own session material.
        if (!event || event.origin !== window.location.origin) return;
        handleHandoff(event.data);
    }

    function onReturnToForeground() {
        try {
            if (document.visibilityState && document.visibilityState !== 'visible') return;
        } catch (_) {}
        checkPopup();
    }

    /* ── Helper-window (iOS popup) side ─────────────────────────── */

    function isPopupContext() {
        try {
            if (!window.opener || window.opener === window || window.opener.closed) return false;
        } catch (_) { return false; }
        var marked = false;
        try {
            marked = window.sessionStorage.getItem(POPUP_MARKER) === '1';
            window.sessionStorage.removeItem(POPUP_MARKER);
        } catch (_) {}
        // The marker and the window name are only ever written by
        // startPopup(), i.e. this really is our helper window. Without
        // them, require the installed-app context plus an OAuth callback
        // URL so an ordinary browser tab that merely has an opener is
        // never closed by us.
        if (marked) return true;
        if (window.name === POPUP_WINDOW_NAME) return true;
        return installed() && hasAuthParams();
    }

    function ensureBroadcast() {
        if (broadcast) return broadcast;
        try {
            if (typeof BroadcastChannel === 'function') {
                broadcast = new BroadcastChannel(CHANNEL);
            }
        } catch (_) { broadcast = null; }
        return broadcast;
    }

    function postToOpener(data) {
        var payload = { type: MESSAGE_TYPE, provider: 'google' };
        Object.keys(data || {}).forEach(function (key) { payload[key] = data[key]; });
        try {
            if (window.opener && window.opener !== window && !window.opener.closed) {
                window.opener.postMessage(payload, window.location.origin);
            }
        } catch (_) {}
        try {
            var channel = ensureBroadcast();
            if (channel) channel.postMessage(payload);
        } catch (_) {}
    }

    function closeSelf(message, type) {
        setTimeout(function () {
            try { window.close(); } catch (_) {}
            setTimeout(function () {
                var gone = false;
                try { gone = window.closed; } catch (_) { gone = true; }
                if (gone) return;
                // iOS refused to close the helper window: leave clear
                // instructions instead of stranding the user on a blank page.
                if (window.openAuth) window.openAuth('login');
                if (ui) ui.message(message, type);
            }, 400);
        }, 150);
    }

    function completePopup() {
        if (popupHandled) return;
        popupHandled = true;
        var auth = authClient();
        if (!auth || !auth.getSession) {
            postToOpener({ status: 'failed', error: 'supabase-unavailable' });
            closeSelf(MSG_POPUP_LOST, 'error');
            return;
        }
        /* getSession() waits for supabase-js to finish detecting the
           session (or the error) in this window's URL. */
        Promise.resolve()
            .then(function () { return auth.getSession(); })
            .then(function (res) {
                var session = res && res.data ? res.data.session : null;
                if (session && session.access_token && session.refresh_token) {
                    postToOpener({
                        status: 'success',
                        access_token: session.access_token,
                        refresh_token: session.refresh_token
                    });
                    closeSelf(MSG_STILL_OPEN, 'success');
                    return;
                }
                if (oauthErrorFromUrl()) {
                    postToOpener({ status: 'cancelled' });
                    closeSelf('You can close this window and return to DetectLab.', 'error');
                    return;
                }
                postToOpener({ status: 'failed', error: 'no-session' });
                closeSelf(MSG_POPUP_LOST, 'error');
            })
            .catch(function () {
                postToOpener({ status: 'failed', error: 'session-check-failed' });
                closeSelf(MSG_POPUP_LOST, 'error');
            });
    }

    /* ── Redirect-return handling (Android/desktop/browser) ─────── */

    function notifyOAuthReturn() {
        var err = oauthErrorFromUrl();
        if (!err) return;
        var desc = err.description || '';
        var cancelled = err.error === 'access_denied' || /cancel|denied/i.test(desc);
        var duplicate = /already exists|already registered|identity_already_exists/i.test(desc);
        // openAuth parses the URL itself, shows the friendly duplicate-account
        // copy when relevant and clears the error parameters.
        if (window.openAuth) window.openAuth('login');
        cleanOAuthErrorParams();
        if (duplicate || !ui) return;
        if (cancelled) ui.message(MSG_CANCELLED, 'error');
        else ui.message(desc || MSG_FAILED, 'error');
    }

    /* ── Public API (used by js/auth.js) ────────────────────────── */

    window.DLPwaGoogleAuth = {
        installed: installed,
        isIosHomeScreen: isIosHomeScreen,
        flow: flow,
        needsPopup: needsPopup,
        /* Starts the Google flow for the current platform. Must be called
           synchronously from the button's click handler on iOS. */
        start: start,
        init: function (callbacks) {
            if (!callbacks) return;
            ui = callbacks;
            if (isPopupContext()) {
                completePopup();
                return;
            }
            if (!listening) {
                listening = true;
                try { window.addEventListener('message', onWindowMessage); } catch (_) {}
                try {
                    var channel = ensureBroadcast();
                    if (channel) {
                        channel.onmessage = function (event) {
                            handleHandoff(event && event.data);
                        };
                    }
                } catch (_) {}
                try { document.addEventListener('visibilitychange', onReturnToForeground); } catch (_) {}
                try { window.addEventListener('focus', onReturnToForeground); } catch (_) {}
            }
            notifyOAuthReturn();
        }
    };
}());
