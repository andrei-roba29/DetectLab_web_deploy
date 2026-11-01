# Google sign-in in the installed PWA (and why the browser bars are gone)

## Symptom

Signing in with **Google** made the installed DetectLab app show real
**browser address/navigation bars** on both Android and iOS, and could
leave the user outside the installed app. Email/password sign-in never
left the app origin, which is why it always kept the standalone look.

Those bars are **browser controls created by the platform**, not page
chrome — no CSS, viewport trick or forced PWA class can hide them. The
fix therefore changes *how the flow leaves the page*, per platform.

## Investigation — where each platform puts a Google sign-in

| Context | What happens | Result before the fix |
| --- | --- | --- |
| Normal browser tab (any OS) | `supabase.auth.signInWithOAuth` → `window.location.assign` (same tab) | Works; bars are the browser's own, as expected |
| Installed Android/desktop app | A `window.open` popup becomes a **separate Chrome window/tab with an address bar** (community-confirmed on real devices: window.location stays inside the standalone window, window.open leaves it) | GIS popup → bars; user not reliably returned to the app window |
| Installed iOS Home Screen app | A **top-level navigation outside the manifest scope** is handed to a **Safari View Controller sheet** (address bar + toolbar, Apple WWDC23 "What's new in web apps"); the sheet has its **own storage partition**, so a session finished there never reaches the app. A popup opened from Google's cross-origin GIS iframe surfaced the same Safari chrome | Bars on iOS; session could be stranded outside the app |
| Previous fix (`js/pwa-google-auth.js`, GIS) | Google Identity Services rendered its own button and opened its popup **from Google's cross-origin iframe** with `ux_mode: 'popup'`, then exchanged the ID token via `signInWithIdToken` | Popup mechanics are what produced the browser chrome — the token exchange was fine, the window was not |

Two corrections to the earlier assumptions are worth recording:

* A full-page redirect does **not** break out of the installed window on
  Android — `window.location` keeps every hop inside the standalone
  window (verified by other projects on real Android devices). It is the
  **iOS** Home Screen behaviour (Safari sheet + separate storage) that
  makes redirect unsafe there, and it is also what likely produced the
  old "redirect leaves the PWA in a browser tab" observation.
* Apple documents the iOS escape hatch explicitly: *"If you want to
  ensure your OAuth flows do not open in the user's default browser,
  you can use `window.open`. Links loaded through `window.open` will
  always open in the web app regardless of scope."* (WWDC23). So the
  installed iOS app opens Google with `window.open` **from the app's own
  document**, not from an iframe.

## The fix (`js/pwa-google-auth.js`, routed from `js/auth.js`)

`DLPwaGoogleAuth.flow()` picks one of two strategies:

1. **`'redirect'` — normal browser tabs *and* installed Android/desktop
   apps.** `signInWithOAuth` performs one same-window top-level
   redirect (supabase-js calls `window.location.assign`). Every hop
   (app → Supabase → Google → Supabase → app) happens inside the window
   that has no omnibox, and Supabase's callback writes the session into
   the app's own storage, so the user is never handed to another window
   and comes back signed in. This is byte-for-byte the flow ordinary
   browser sign-in already used.

2. **`'popup'` — installed iOS Home Screen apps only**
   (`navigator.standalone === true` on an iOS UA; iPadOS "Mac" is
   detected via touch points). On the button tap itself the app calls
   `window.open()` **with no URL** (Safari drops `window.open` after the
   first `await`, and passing no URL means an engine that reuses the
   current window cannot blank the app), then assigns the Supabase
   authorize URL (`signInWithOAuth({ skipBrowserRedirect: true })`) to
   that window. Google runs inside the installed app, Supabase redirects
   the helper window back to the app origin, and the helper window —
   recognised by a `sessionStorage` marker cloned at open time, by its
   `window.name` (set while it is still same-origin) and by the
   opener + callback-URL pair — hands the session to the installed app:

   * `opener.postMessage(payload, location.origin)` — targeted at our
     own origin only;
   * a `BroadcastChannel('detectlab-google-auth')` backup;
   * the opener adopts the tokens with `setSession`, which fires the
     normal `SIGNED_IN` event, so all existing UI (avatar, map gate,
     newsletter sync) updates exactly as it does for email/password;
   * the helper window then closes itself. If iOS refuses the close, it
     shows "Signed in with Google! Return to the DetectLab window…"
     instead of a blank page.

   Redundant paths: if the message is lost but storage is shared, the
   opener notices the new session when the helper window closes; if the
   helper window is dismissed before completing, the opener reports a
   cancellation after a short grace period.

**Safety properties**

* Credentials are never read by DetectLab — they are typed into
  Google's own page; only the resulting Supabase session tokens move,
  only between same-origin windows of this app (equivalent exposure to
  the session this app already keeps in `localStorage`). No client
  secret exists in the app; the Google client secret lives only in
  Supabase.
* Cancellation (`#error=access_denied`), Google/Supabase errors and
  blocked popups all land back in the auth modal with a readable
  message; the installed window itself is never navigated away on
  failure; the URL error parameters are cleaned so a reload cannot
  replay them.
* Email/password sign-in and non-Google OAuth are untouched, and a
  normal browser still uses the plain Supabase redirect.
* Google Identity Services is no longer loaded at all (no
  `accounts.google.com/gsi/client` script, no `signInWithIdToken`).

## Configuration

### Google Cloud Console

1. **Authorized redirect URIs** (required): add Supabase's callback —
   `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback` — to
   the OAuth **Web application** client used for DetectLab. The exact
   URL is shown in Supabase → Authentication → Providers → Google.
2. **Authorized JavaScript origins** are **no longer required** (the
   GIS script is gone). Existing entries are harmless; keep them only
   if something else still uses that client ID.
3. OAuth consent screen: publish/verify the app as appropriate so
   external users are not blocked by the "unverified app" screen.

### Supabase

1. Authentication → Providers → **Google**: Client ID + Client Secret
   (the secret is stored server-side by Supabase only).
2. Authentication → URL configuration:
   * **Site URL**: `https://detectlab.ro`
   * **Redirect URLs**: must include the app origins the flow returns
     to, e.g. `https://detectlab.ro/**` and `https://detectlab.eu/**`
     (the flow returns to `origin + pathname`), plus
     `http://localhost:**` for local development. The iOS helper window
     and the Android/desktop redirect use the *same* return URL, so no
     extra entry is needed beyond the origins themselves.
3. The app requests `access_type=offline&prompt=consent` for Google so
   Supabase receives a refresh token; keep "Refresh tokens" enabled for
   the provider.

### Deployment

`index.html` and the `sw.js` precache list carry
`?v=20261101-google-inapp-flow` for `js/pwa-google-auth.js` and
`js/auth.js`, and `sw.js`'s `CACHE_NAME` was bumped to
`detectlab-v369-google-inapp-flow` so already-installed PWAs replace the
old GIS shell on their next update check.

## Tests

```
node test-pwa-google-auth.js
```

covers: the platform matrix (browser / Android installed / iOS Safari
tab / iOS Home Screen / iPad-as-Mac / `?pwa=1`), the same-window
redirect for non-iOS contexts (asserting `window.open` is *never*
called there), the synchronous in-tap `window.open` on iOS (no URL
argument), the helper-window navigation and both handoff channels
(origin-targeted `postMessage` + `BroadcastChannel`), `setSession` in
both current and legacy signatures, cancellation, blocked popups,
double-tap, the helper window's own success/cancel/failure paths, the
"browser tab with an opener is never treated as a helper window" guard,
redirect-return error handling (cancelled + duplicate-account copy),
URL cleanup, cache-busting wiring in `index.html`/`sw.js`, and static
guarantees that GIS, the ID-token exchange and password access are gone
while email/password and browser OAuth remain.

## Device verification status — what still needs a real phone

**This change was developed and regression-tested in a mocked
environment; no physical Android or iOS device was available here, so
the following must be checked on real installed PWAs before release:**

1. **Android (Chrome, installed via Install app / Add to Home screen):**
   tap *Continue with Google* → the Google page renders **inside the
   app window with no Chrome address bar**, sign-in returns to the same
   window signed in, and the avatar/map-gate update immediately.
   Also verify cancellation (back out of Google) shows the friendly
   message in the modal.
2. **iOS (Safari → Share → Add to Home Screen, "Open as Web App" on):**
   tap *Continue with Google* → **no Safari sheet/address bar appears**
   (Apple's `window.open` guarantee) → Google completes → the helper
   window closes itself and the original window is signed in. Verify:
   a previously-linked account, a fresh Google account, cancelling at
   the Google prompt, closing the helper window by hand, and that
   `window.close()` is honoured on the current iOS version (if it is
   refused, the fallback message must appear).
3. **Both platforms:** force-quit and relaunch the installed icon —
   the session must survive; sign out and sign in again with Google;
   confirm email/password still signs in without any bars.
4. **Desktop installed PWA (Chrome/Edge "Open as window"):** same
   redirect path as Android — verify no separate window appears.

### Platform limitations to be aware of

* If a future iOS release blocks `window.open` from Home Screen web
  apps entirely, the app shows "Your browser blocked the Google sign-in
  window…" instead of silently falling back to the redirect (which
  would bring the Safari sheet back). There is no web API that can force
  a Home Screen app window or focus it from script.
* Apple's OAuth "heuristics" and Google's own page flow can change
  behaviour per iOS/Chrome version; Google may occasionally show its
  "browser or app may not be secure" interstitial in contexts it
  dislikes (not expected for a normal Chrome PWA window or Safari's
  UA, but visible if it happens).
* The iOS helper window's storage partition (shared with the app or
  not) differs across iOS versions — that is why the handoff carries
  the tokens explicitly instead of relying on shared storage.
* `?pwa=1` only forces the *layout* in a normal tab; it never activates
  the iOS popup flow (a Safari tab keeps the ordinary redirect).
