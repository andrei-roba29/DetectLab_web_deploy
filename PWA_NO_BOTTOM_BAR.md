# PWA: stivă dreapta-jos restaurată — 🎯 deasupra, cont dedesubt (v136)

## Starea curentă (v136)

În PWA instalată, stiva din dreapta-jos `#pwa-br-stack` este din nou vizibilă:
conține butonul de locație live 🎯 deasupra și triggerul de cont („AN” / inițiale
sau „Log In” + dropdown Manage Account / Events / Friends / Language / Storage /
Log Out) dedesubt. Pe site containerul rămâne `display:none` — contul e în nav.

- **PWA instalată:** `#pwa-br-stack` este `position:fixed`,
  `right: max(10px, env(safe-area-inset-right))`,
  `bottom: calc(env(safe-area-inset-bottom)+28px)`, `z-index:2000`,
  `flex-direction:column`, `gap:8px`. În interior,
  `.pwa-live-location-control` este `position:relative !important` (stack-ul
  însuși e fix). Fallback-ul `html.is-pwa .pwa-live-location-control` rămâne
  fixed pentru shell-uri vechi fără stack. Când `transp-panel-open`, întreaga
  stivă e `visibility:hidden` / `opacity:0` / `pointer-events:none`.
- **Site:** `#pwa-br-stack` rămâne `display:none`; butonul 🎯 rămâne sub zoom,
  în coloana stânga.
- **Cont:** triggerul și dropdown-ul sunt din nou în DOM în PWA; inițialele se
  actualizează din `updatePwaUserStack`, overlay-ul contului (`pwaAccountOverlay`)
  funcționează.

## Implementare

`js/map-app.js` detectează modul PWA prin clasa `is-pwa` pe `<html>`. Butonul
`#btnLiveLocation` este montat în PWA ca prim copil al stivei:

```js
if (isPwaMode) {
    btn.classList.add('pwa-live-location-control');
    var pwaStack = document.getElementById('pwa-br-stack');
    if (pwaStack) {
        if (pwaStack.firstChild) pwaStack.insertBefore(btn, pwaStack.firstChild);
        else pwaStack.appendChild(btn);
    } else {
        document.body.appendChild(btn); // fallback
    }
} else {
    zoomCtrl.appendChild(btn);
}
```

CSS din `index.html`:

- `#pwa-br-stack` — base `display:none; position:fixed; right:max(...); bottom:calc(...)+28px; flex column`
- `body.is-pwa #pwa-br-stack` — `display:flex !important; visibility:visible !important; pointer-events:auto !important`
- `#pwa-br-stack .leaflet-control` — reset margin/border/shadow
- `#pwa-br-stack .pwa-live-location-control` — `position:relative !important; right:auto !important; bottom:auto !important`

Scriptul PWA din `index.html` NU mai face `removeChild(pwaBottomBar)`; doar
`setAttribute('aria-hidden','false')`. Handlerul GPS rămâne neschimbat; API-urile
`window._startLiveLocation` etc. rămân expuse.

## Cache PWA

Livrat prin **Service Worker v136** `detectlab-v136-pwa-br-stack-account`.
URL-uri versionate:

- `css/styles.css?v=20260923-pwa-br-stack-account`
- `js/map-app.js?v=20260923-pwa-br-stack-account`
- `js/tutorial.js?v=20260923-pwa-br-stack-account`

Toate trei sunt în `PRECACHE_URLS`.

## Teste

- `node test-pwa-no-bottom-bar.js` — stiva e ascunsă pe site, flex vizibilă în PWA cu safe-area; 🎯 e relative în stivă, fallback fixed; map-app.js inserează ca firstChild; transp-panel-open ascunde stiva; cont + dropdown prezente; SW v136 pre-cache.
- `node test-pwa-bottom-bar-removal.js` — cu jsdom, scriptul standalone păstrează stiva în DOM (aria-hidden=false), nu șterge GPS; site neatins.
- `node test-pwa-bottom-band.js` — harta, safe-area, offset-uri jos, 100vh floor, fără regresie; assert nou pentru stivă restaurată.
- `node test-pwa-shell-refresh.js` — SW v136, re-check la load/pageshow/visibility/interval, controllerchange → reload unic.
- `node test-mobile-fullscreen-controls.js` — compass fix deasupra browser bar, ? rămâne top-right.

