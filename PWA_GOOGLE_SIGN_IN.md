# Google sign-in in the installed PWA

A full-page OAuth redirect can leave an installed PWA in a browser tab after
Google authentication. In standalone/fullscreen mode, DetectLab instead renders
Google Identity Services' popup sign-in button in both auth forms and exchanges
its ID token for a Supabase session in the original app window. The browser
version still uses the existing Supabase redirect flow.

The public Google web client ID in `js/pwa-google-auth.js` must match the Google
provider configured in Supabase. Its Google Cloud OAuth client must list each
production origin (including `https://detectlab.ro` and `https://detectlab.eu`)
as an authorized JavaScript origin. No Google client secret belongs in the app.
The app generates a random nonce, sends its SHA-256 hash to Google and supplies
the original nonce to Supabase for token verification. If the Google script or
popup is unavailable, the modal reports an error rather than navigating the
installed app away. The PWA requires a secure context and network access.

Run `node test-pwa-google-auth.js` for the mocked success, failure, nonce and
browser-vs-PWA checks. Before release, verify both login and registration on
real Android and iOS installed PWAs, including a cancelled popup, a fresh Google
account and a previously linked account. Google popup/FedCM behavior and
configured authorized origins must be verified on the deployed domains; the
mock test cannot validate them.
