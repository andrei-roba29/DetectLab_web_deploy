# iOS PWA keyboard

## Symptom

In an installed iPhone/iPad Home Screen app, every text field can receive focus
while the system keyboard never appears. This is not limited to login: search,
chat, event forms and `contenteditable` fields can all be affected.

WebKit has a matching Home Screen keyboard bug, reported most often on EU
devices after an iOS 17 → iOS 18 upgrade:
<https://bugs.webkit.org/show_bug.cgi?id=279904>. A web page cannot force UIKit
to present the keyboard when that system-level failure occurs, so the app-side
fix removes avoidable focus blockers and offers a non-destructive recovery path.

## Changes

* `index.html` no longer cancels `touchstart` / `gesturestart` in the non-map
  pinch guard. Only a real two-finger `touchmove` outside the map is blocked,
  and an active text editor is exempt. Map rotation/pinch handling is unchanged.
* `js/auth.js` keeps immediate autofocus on desktop but does not schedule a
  delayed `focus()` on touch devices. iOS focuses fields through the user's tap.
* `css/pwa-keyboard.css` keeps text selectable in PWA inputs, textareas and
  editable content, including fields inside Leaflet panes. The auth card scrolls
  inside the visible viewport while editing.
* `js/pwa-keyboard.js` tracks the visible viewport, reveals the focused field in
  its scroll container, and adds an iOS-only help dialog to the auth card and
  the PWA account menu. The dialog links to the same address in Safari and
  explains restart / iOS update / Home Screen icon re-add recovery.
* The recovery path never clears Safari site data, app caches, offline maps,
  localStorage or the service worker registration.
* `sw.js` is bumped to `detectlab-v369-ios-pwa-keyboard` and precaches the new
  versioned CSS/JS plus the updated auth script.

## Verification

```sh
node test-pwa-ios-keyboard.js
node test-pwa-google-auth.js
node test-pwa-viewport-fit.js
node test-pwa-bottom-bar-removal.js
node test-pwa-no-bottom-bar.js
node test-pwa-shell-refresh.js
node test-map-rotate-lock.js
```

The automated checks cover the native focus path, the pinch-guard exemption,
editable-field detection, the Safari fallback, focus cleanup, data-safety
contract and service-worker versioning. They do not emulate UIKit's keyboard
presentation.

On a real iPhone, after deployment:

1. Force-close and reopen the installed PWA so service worker v369 takes over.
2. Test login email/password, map search, friends chat and create-event fields.
3. Confirm the keyboard appears, the field stays visible, and closing the
   keyboard restores the layout.
4. If focus works but the keyboard still never appears, open **Tastatura nu
   apare? Ajutor iOS** and use Safari while trying the recovery steps. Do not
   clear site data before checking unsynced/offline data.
