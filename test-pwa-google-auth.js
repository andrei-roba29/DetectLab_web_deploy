'use strict';
/* ══════════════════════════════════════════════════════════════
   Regression test — Google sign-in must not drag browser chrome
   into the installed DetectLab app.

   What was broken
   ---------------
   The previous fix rendered Google Identity Services' popup button
   inside the installed PWA and exchanged its ID token through
   Supabase. GIS opened its window from Google's cross-origin iframe:
   on Android that becomes a separate Chrome window with an address
   bar, on iOS an out-of-scope window/sheet with Safari chrome — the
   user saw browser bars and was left outside the installed app.
   Email/password never left the origin, which is why it always kept
   the standalone look.

   The fix (js/pwa-google-auth.js) shapes the flow per platform:
     • browser tab / installed Android+desktop → one same-window
       redirect (supabase-js window.location.assign), so every hop
       stays inside the window that has no omnibox;
     • installed iOS Home Screen app → window.open from the button
       tap itself (Apple's documented way to keep OAuth in the web
       app), the helper window finishes on the app origin and hands
       the session back via same-origin postMessage/BroadcastChannel
       + setSession, then closes itself.

   Run: node test-pwa-google-auth.js
   ══════════════════════════════════════════════════════════════ */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/pwa-google-auth.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const auth = fs.readFileSync('js/auth.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const doc = fs.readFileSync('PWA_GOOGLE_SIGN_IN.md', 'utf8');

const ORIGIN = 'https://detectlab.ro';
const AUTHORIZE_URL = 'https://dacboefvooxgsngxkavx.supabase.co/auth/v1/authorize?provider=google';
const liveIntervals = [];

/* ── Mock environment ──────────────────────────────────────────── */

function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); }
    };
}

function createEnv(opts) {
    opts = opts || {};
    const state = {
        opened: [],          // every window.open(...) call
        oauthCalls: [],
        setCalls: [],
        getSessionCalls: 0,
        messages: [],
        cleared: 0,
        closedByUi: 0,       // ui.close() — the auth modal closing
        openAuthCalls: 0,
        assigned: [],        // location.assign urls
        replaced: [],        // history.replaceState urls
        posted: [],          // opener.postMessage from the helper window
        popupCloseCalls: 0,
        channels: [],
        popup: null
    };

    const winListeners = Object.create(null);
    const docListeners = Object.create(null);

    const location = {
        origin: ORIGIN,
        pathname: '/',
        search: opts.search || '',
        hash: opts.hash || '',
        assign(url) { state.assigned.push(url); }
    };

    const history = {
        state: null,
        replaceState(_s, _t, url) {
            state.replaced.push(url);
            const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url) || [];
            location.pathname = m[1] || '';
            location.search = m[2] || '';
            location.hash = m[3] || '';
        }
    };

    class FakeBroadcastChannel {
        constructor(name) {
            this.name = name;
            this.posted = [];
            this.onmessage = null;
            state.channels.push(this);
        }
        postMessage(data) { this.posted.push(data); }
    }

    const navigator = {
        userAgent: opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        maxTouchPoints: opts.maxTouchPoints || 0
    };
    if (opts.standalone !== undefined) navigator.standalone = opts.standalone;

    const auth = {
        signInWithOAuth: async (options) => {
            state.oauthCalls.push(options);
            if (opts.oauthError) return { error: new Error(opts.oauthError) };
            return { data: { provider: 'google', url: AUTHORIZE_URL } };
        },
        getSession: async () => {
            state.getSessionCalls++;
            if (opts.getSessionError) throw new Error(opts.getSessionError);
            return { data: { session: opts.session || null } };
        }
    };
    // Current supabase-js takes one object; `positional` simulates an old build.
    if (opts.positionalSetSession) {
        auth.setSession = async (at, rt) => {
            state.setCalls.push({ form: 'positional', access_token: at, refresh_token: rt });
            return { data: {} };
        };
    } else {
        auth.setSession = async (input) => {
            state.setCalls.push(Object.assign({ form: 'object' }, input));
            return { data: {} };
        };
    }

    const win = {
        navigator,
        location,
        history,
        name: opts.windowName || '',
        sessionStorage: makeStorage(),
        opener: opts.opener ? {
            closed: false,
            postMessage(data, targetOrigin) { state.posted.push({ data, targetOrigin }); }
        } : null,
        supabaseClient: { auth },
        matchMedia(query) {
            return {
                matches: query.indexOf('standalone') !== -1 ? !!opts.standaloneDisplay
                    : query.indexOf('fullscreen') !== -1 ? !!opts.fullscreenDisplay
                    : false
            };
        },
        addEventListener(type, fn) {
            (winListeners[type] = winListeners[type] || []).push(fn);
        },
        open(...args) {
            state.opened.push(args);
            if (opts.openReturns === 'null') return null;
            if (opts.openReturns === 'self') return win;
            const popup = {
                closed: false,
                location: {},
                close() { this.closed = true; state.popupCloseCalls++; }
            };
            state.popup = popup;
            return popup;
        },
        close() { state.windowClosed = true; win.closed = true; },
        closed: false,
        openAuth() { state.openAuthCalls++; }
    };

    if (opts.popupMarker) win.sessionStorage.setItem('dl-google-auth-popup', '1');

    const document = {
        visibilityState: 'visible',
        addEventListener(type, fn) {
            (docListeners[type] = docListeners[type] || []).push(fn);
        }
    };

    const sandbox = {
        window: win,
        document,
        BroadcastChannel: FakeBroadcastChannel,
        URLSearchParams,
        Promise,
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout,
        // Track poll intervals so the test can stop scenarios whose helper
        // window is deliberately left open (otherwise Node never exits).
        setInterval: (fn, ms) => { const id = setInterval(fn, ms); liveIntervals.push(id); return id; },
        clearInterval
    };
    vm.runInNewContext(source, sandbox, { filename: 'js/pwa-google-auth.js' });

    const ui = {
        message: (...args) => state.messages.push(args),
        clear: () => { state.cleared++; },
        close: () => { state.closedByUi++; }
    };

    return {
        win, state, ui,
        api: win.DLPwaGoogleAuth,
        init() { win.DLPwaGoogleAuth.init(ui); },
        fireWindowMessage(event) {
            (winListeners.message || []).forEach((fn) => fn(event));
        },
        fireFocus() {
            (winListeners.focus || []).forEach((fn) => fn());
        },
        channel() { return state.channels[0] || null; }
    };
}

const flush = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const lastMessage = (env) => (env.state.messages.length ? env.state.messages[env.state.messages.length - 1][0] : '');

const IOS_HOME = {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    standalone: true
};
const ANDROID_INSTALLED = { standaloneDisplay: true, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36' };

(async () => {
    /* ── 1. Platform matrix: which flow each context must use ─── */
    const browser = createEnv({});
    assert.strictEqual(browser.api.installed(), false, 'ordinary browser tab is not installed');
    assert.strictEqual(browser.api.flow(), 'redirect', 'browser tab uses the existing redirect flow');

    const android = createEnv(ANDROID_INSTALLED);
    assert.strictEqual(android.api.installed(), true, 'Android display-mode standalone is installed');
    assert.strictEqual(android.api.flow(), 'redirect',
        'installed Android must use the same-window redirect — a window.open popup there opens Chrome with an address bar');

    const iosTab = createEnv({ ua: IOS_HOME.ua, standalone: false });
    assert.strictEqual(iosTab.api.installed(), false, 'iOS Safari tab is not installed');
    assert.strictEqual(iosTab.api.flow(), 'redirect', 'iOS Safari tab keeps the normal browser redirect');

    const iosHome = createEnv(IOS_HOME);
    assert.strictEqual(iosHome.api.installed(), true, 'iOS Home Screen app is installed');
    assert.strictEqual(iosHome.api.flow(), 'popup',
        'iOS Home Screen must avoid the top-level redirect (it becomes a Safari sheet with bars)');

    const ipadAsMac = createEnv({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', standalone: true, maxTouchPoints: 5 });
    assert.strictEqual(ipadAsMac.api.flow(), 'popup', 'iPadOS masquerading as macOS still gets the popup flow');

    const forcedPwa = createEnv({ ua: IOS_HOME.ua, standalone: false, search: '?pwa=1' });
    assert.strictEqual(forcedPwa.api.installed(), true, '?pwa=1 forces the standalone layout');
    assert.strictEqual(forcedPwa.api.flow(), 'redirect',
        '?pwa=1 in a real Safari tab is still a browser tab — no popup needed');

    /* ── 2. Installed Android / browser: one same-window redirect ── */
    const redirect = createEnv(ANDROID_INSTALLED);
    redirect.init();
    redirect.api.start();
    await flush();
    assert.strictEqual(redirect.state.opened.length, 0,
        'installed Android must never call window.open (that is what showed the Chrome address bar)');
    assert.strictEqual(redirect.state.oauthCalls.length, 1, 'Google uses signInWithOAuth');
    const redirectOptions = redirect.state.oauthCalls[0];
    assert.strictEqual(redirectOptions.provider, 'google');
    assert.strictEqual(redirectOptions.options.skipBrowserRedirect, undefined,
        'no skipBrowserRedirect → supabase-js performs window.location.assign in this same window');
    assert.strictEqual(redirectOptions.options.redirectTo, ORIGIN + '/');
    assert.strictEqual(redirectOptions.options.queryParams.access_type, 'offline');
    assert.ok(lastMessage(redirect).includes('Redirecting to Google'), 'the attempt is announced');

    const redirectFail = createEnv(Object.assign({}, ANDROID_INSTALLED, { oauthError: 'provider misconfigured' }));
    redirectFail.init();
    redirectFail.api.start();
    await flush();
    assert.ok(lastMessage(redirectFail).includes('provider misconfigured'), 'start-up errors stay visible');

    /* ── 3. Installed iOS: window.open happens inside the tap ──── */
    const ios = createEnv(IOS_HOME);
    ios.init();
    ios.api.start();
    assert.strictEqual(ios.state.opened.length, 1,
        'window.open runs synchronously with the tap (Safari expires transient activation after any await)');
    assert.strictEqual(ios.state.opened[0].length, 0,
        'no URL is passed to window.open, so an engine that reuses the window cannot blank the app');
    await flush();
    assert.strictEqual(ios.state.oauthCalls.length, 1);
    assert.strictEqual(ios.state.oauthCalls[0].options.skipBrowserRedirect, true,
        'the app keeps control: the authorize URL is fetched without navigating this window');
    assert.strictEqual(ios.state.popup.location.href, AUTHORIZE_URL,
        'the helper window is sent to Supabase → Google, inside the installed app');
    assert.strictEqual(ios.state.popup.name, 'detectlab-google-auth-flow',
        'the helper window is named while still same-origin so it can identify itself later');
    assert.ok(lastMessage(ios).includes('Finish signing in on the Google page'));

    /* Handoff via BroadcastChannel (helper window posts, opener adopts). */
    const channel = ios.channel();
    assert.ok(channel && channel.name === 'detectlab-google-auth', 'a handoff channel exists');
    channel.onmessage({
        data: {
            type: 'detectlab:google-auth',
            status: 'success',
            access_token: 'fresh-access',
            refresh_token: 'fresh-refresh'
        }
    });
    await flush();
    assert.strictEqual(ios.state.setCalls.length, 1, 'the opener adopts the session');
    assert.strictEqual(ios.state.setCalls[0].form, 'object', 'current supabase-js object signature');
    assert.strictEqual(ios.state.setCalls[0].access_token, 'fresh-access');
    assert.strictEqual(ios.state.cleared, 1, 'the auth modal is cleared');
    assert.strictEqual(ios.state.closedByUi, 1, 'the auth modal closes after sign-in');
    ios.state.popup.closed = true;
    await flush(950);
    assert.ok(!lastMessage(ios).includes('cancelled'),
        'a completed sign-in is never reported as cancelled when the helper window closes');

    /* Handoff via window.postMessage — origin-checked. */
    const iosMsg = createEnv(IOS_HOME);
    iosMsg.init();
    iosMsg.api.start();
    await flush();
    iosMsg.fireWindowMessage({
        origin: 'https://evil.example',
        data: { type: 'detectlab:google-auth', status: 'success', access_token: 'x', refresh_token: 'y' }
    });
    await flush();
    assert.strictEqual(iosMsg.state.setCalls.length, 0, 'messages from other origins are ignored');
    iosMsg.fireWindowMessage({
        origin: ORIGIN,
        data: { type: 'detectlab:google-auth', status: 'success', access_token: 'a2', refresh_token: 'r2' }
    });
    await flush();
    assert.strictEqual(iosMsg.state.setCalls.length, 1, 'same-origin handoff is accepted');

    /* Old supabase-js positional setSession still works. */
    const iosPos = createEnv(Object.assign({}, IOS_HOME, { positionalSetSession: true }));
    iosPos.init();
    iosPos.api.start();
    await flush();
    iosPos.channel().onmessage({
        data: { type: 'detectlab:google-auth', status: 'success', access_token: 'p', refresh_token: 'q' }
    });
    await flush();
    assert.strictEqual(iosPos.state.setCalls[0].form, 'positional', 'legacy two-string signature is used when present');

    /* ── 4. Cancellation and blocked windows ───────────────────── */
    const cancelled = createEnv(IOS_HOME);
    cancelled.init();
    cancelled.api.start();
    await flush();
    cancelled.state.popup.closed = true;   // user dismissed the helper window
    await flush(1600);                     // 350 ms poll + 800 ms grace
    assert.ok(lastMessage(cancelled).includes('cancelled'), 'a dismissed window reads as a cancelled sign-in');
    assert.strictEqual(cancelled.state.setCalls.length, 0, 'no session is adopted');
    assert.strictEqual(cancelled.state.closedByUi, 0, 'the modal stays open after cancellation');

    const blocked = createEnv(Object.assign({}, IOS_HOME, { openReturns: 'null' }));
    blocked.init();
    blocked.api.start();
    await flush();
    assert.strictEqual(blocked.state.oauthCalls.length, 0, 'a blocked window never starts the OAuth request');
    assert.strictEqual(blocked.state.assigned.length, 0, 'the installed window itself is never navigated');
    assert.ok(lastMessage(blocked).includes('blocked'), 'the block is explained instead of failing silently');

    const selfNav = createEnv(Object.assign({}, IOS_HOME, { openReturns: 'self' }));
    selfNav.init();
    selfNav.api.start();
    await flush();
    assert.strictEqual(selfNav.state.assigned.length, 1,
        'an engine that reuses the current window navigates it in place (still no browser chrome)');
    assert.strictEqual(selfNav.state.assigned[0], AUTHORIZE_URL);

    const busy = createEnv(IOS_HOME);
    busy.init();
    busy.api.start();
    await flush();
    busy.api.start();                      // double tap while Google is open
    assert.strictEqual(busy.state.opened.length, 1, 'a second tap does not stack windows');
    assert.ok(lastMessage(busy).includes('already open'));

    /* ── 5. Helper window (the iOS popup itself) ───────────────── */
    const helper = createEnv(Object.assign({}, IOS_HOME, {
        opener: true,
        popupMarker: true,
        session: { access_token: 'tok', refresh_token: 'ref' }
    }));
    helper.init();
    await flush();
    assert.strictEqual(helper.state.posted.length, 1, 'the helper window reports back to the opener');
    const posted = helper.state.posted[0];
    assert.strictEqual(posted.targetOrigin, ORIGIN, 'postMessage targets only our own origin');
    assert.strictEqual(posted.data.type, 'detectlab:google-auth');
    assert.strictEqual(posted.data.status, 'success');
    assert.strictEqual(posted.data.access_token, 'tok');
    const helperChannel = helper.channel();
    assert.ok(helperChannel && helperChannel.posted.length === 1, 'BroadcastChannel carries the same handoff');
    await flush(700);
    assert.strictEqual(helper.state.windowClosed, true, 'the helper window closes itself after the handoff');
    assert.strictEqual(helper.state.openAuthCalls, 0, 'no fallback message is shown when the close succeeds');

    const helperCancel = createEnv(Object.assign({}, IOS_HOME, {
        opener: true,
        hash: '#error=access_denied&error_description=User%20cancelled%20the%20prompt'
    }));
    helperCancel.init();
    await flush();
    assert.strictEqual(helperCancel.state.posted[0].data.status, 'cancelled',
        'a Google cancellation inside the helper window is reported as cancelled');
    await flush(700);
    assert.ok(helperCancel.win.closed, 'the cancelled helper window still closes');

    /* Identified by its window name alone (no marker, no standalone flag):
       the name is set before the helper window ever leaves the origin. */
    const helperByName = createEnv({
        opener: true,
        windowName: 'detectlab-google-auth-flow',
        hash: '#error=access_denied&error_description=User%20cancelled%20the%20prompt',
        session: { access_token: 'tok', refresh_token: 'ref' }
    });
    helperByName.init();
    await flush();
    assert.strictEqual(helperByName.state.posted[0].data.status, 'success',
        'a helper window recognised by its name still hands the session over');

    const helperFail = createEnv(Object.assign({}, IOS_HOME, { opener: true, popupMarker: true }));
    helperFail.init();
    await flush();
    assert.strictEqual(helperFail.state.posted[0].data.status, 'failed',
        'a helper window with neither session nor error reports failure');
    await flush(700);
    assert.ok(helperFail.win.closed, 'the failed helper window closes instead of stranding the user');

    /* An ordinary browser tab that merely has an opener must NOT be
       treated as our helper window (it must never close itself). */
    const notHelper = createEnv({
        opener: true,
        hash: '#error=access_denied&error_description=cancelled'
    });
    notHelper.init();
    await flush();
    assert.strictEqual(notHelper.state.posted.length, 0, 'browser tabs with an opener are not helper windows');
    assert.strictEqual(notHelper.win.closed, false, 'a normal tab is never closed by the app');
    assert.strictEqual(notHelper.state.openAuthCalls, 1, 'the cancelled redirect still opens the sign-in modal');
    assert.ok(lastMessage(notHelper).includes('cancelled'), 'and explains the cancellation');

    /* ── 6. Redirect return handling (Android/desktop/browser) ─── */
    const returned = createEnv(Object.assign({}, ANDROID_INSTALLED, {
        hash: '#error=access_denied&error_description=User%20cancelled%20the%20prompt'
    }));
    returned.init();
    assert.strictEqual(returned.state.openAuthCalls, 1, 'a cancelled redirect reopens the auth modal');
    assert.ok(lastMessage(returned).includes('cancelled'), 'the user is told the sign-in was cancelled');
    assert.strictEqual(returned.state.replaced.length >= 1, true, 'the error parameters are cleaned from the URL');
    assert.ok(!returned.state.replaced[returned.state.replaced.length - 1].includes('error'),
        'so a reload cannot replay the error');

    const dup = createEnv(Object.assign({}, ANDROID_INSTALLED, {
        hash: '#error=identity_already_exists&error_description=User%20already%20registered'
    }));
    dup.init();
    assert.strictEqual(dup.state.openAuthCalls, 1, 'duplicate-account returns go through openAuth');
    assert.strictEqual(dup.state.messages.length, 0,
        'no second message overwrites openAuth’s friendly duplicate-account copy');

    const clean = createEnv(ANDROID_INSTALLED);
    clean.init();
    assert.strictEqual(clean.state.openAuthCalls, 0, 'a normal load opens nothing');
    assert.strictEqual(clean.state.messages.length, 0, 'a normal load says nothing');

    /* ── 7. Static wiring: index.html, sw.js, auth.js, docs ────── */
    assert.ok(html.includes('js/pwa-google-auth.js?v=20261101-google-inapp-flow'),
        'index.html loads the cache-busted module');
    assert.ok(html.includes('js/auth.js?v=20261101-google-inapp-flow'),
        'index.html loads the cache-busted auth.js');
    assert.ok(sw.includes("js/pwa-google-auth.js?v=20261101-google-inapp-flow"),
        'the service worker precaches the same module URL');
    assert.ok(sw.includes("js/auth.js?v=20261101-google-inapp-flow"),
        'the service worker precaches the same auth.js URL');
    const shellCacheVersion = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1] || 0);
    assert.ok(shellCacheVersion >= 369, 'sw.js cache name is bumped so installed apps pick the fix up');
    assert.ok(!html.includes('pwa-google-button'),
        'the Google Identity Services mount point is gone from the auth forms');
    assert.ok(!/accounts\.google\.com|gsi\/client/.test(source),
        'no Google Identity Services script is injected any more');
    assert.ok(!/signInWithIdToken/.test(source),
        'the ID-token exchange is gone — Supabase completes the redirect flow server-side');
    assert.ok(!/\.value\b/.test(source) && !/password/i.test(source.replace(/use your email and password/g, '')),
        'the Google flow never reads form values or passwords');

    assert.ok(auth.includes('DLPwaGoogleAuth.start'), 'authWithProvider routes Google through the platform-aware flow');
    assert.ok(auth.includes('signInWithOAuth'), 'non-Google OAuth and the module fallback keep signInWithOAuth');
    assert.ok(auth.includes('signInWithPassword'), 'email/password sign-in is untouched');
    assert.ok(!/DLPwaGoogleAuth\.retry|DLPwaGoogleAuth\.installed\(/.test(auth),
        'the old GIS retry/installed interception is gone');

    assert.ok(doc.includes('window.open') && doc.includes('Safari View Controller'),
        'the documentation records the platform behaviour the fix relies on');
    assert.ok(doc.includes('Authorized redirect URIs') && doc.includes('Redirect URLs'),
        'the documentation lists the Google Cloud and Supabase configuration');

    console.log('OK — Google sign-in stays inside the installed app on Android (same-window redirect), ' +
        'iOS (in-app window.open + session handoff), keeps normal browser/email-password sign-in, ' +
        'and handles cancellation, blocked windows and errors without exposing credentials.');
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
}).finally(() => {
    // Stop any poll interval left running by a deliberately-open helper window.
    liveIntervals.forEach((id) => clearInterval(id));
});
