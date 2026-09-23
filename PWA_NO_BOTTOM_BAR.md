# PWA: meniu de cont eliminat, butonul de locație live păstrat

## Starea curentă

În PWA, vechea stivă din dreapta-jos `#pwa-br-stack` nu mai este folosită:
conținea atât butonul de locație 🎯, cât și butonul de cont („AN” / inițiale sau
„Log In”) cu meniul lui. Eliminarea stivei a făcut să dispară și controlul GPS;
acesta a fost readus separat, fără să readucă meniul de cont.

- **PWA instalată:** butonul 🎯 de locație live este un control plutitor
  independent, în dreapta-jos: `right: max(10px, env(safe-area-inset-right))`,
  `bottom: calc(env(safe-area-inset-bottom) + 28px)`, `z-index: 2000`. Când
  panoul de straturi este deschis, controlul rămâne sub panou și nu poate fi
  apăsat.
- **Site:** butonul rămâne sub zoom, în coloana de controale din stânga.
- **Cont:** meniul de cont, inițialele, pastila Log In și dropdown-ul din vechea
  stivă continuă să fie eliminate din DOM în standalone. Nu sunt readuse odată
  cu butonul GPS.

## Implementare

`js/map-app.js` detectează modul PWA prin clasa `is-pwa` pusă devreme pe
`<html>`. După inițializarea hărții, același buton `#btnLiveLocation` este
montat astfel:

```js
if (isPwaMode) {
    btn.classList.add('pwa-live-location-control');
    document.body.appendChild(btn);
} else {
    zoomCtrl.appendChild(btn);
}
```

Regula `html.is-pwa .pwa-live-location-control` din `index.html` îl fixează în
colțul dreapta-jos și păstrează spațiul pentru safe area / home indicator.
Handlerul existent rămâne neschimbat: toggle GPS, centrare pe poziție și
întrebarea de vizibilitate. Detectare, lupa „Detectoriști din zonă” și
înregistrarea traseului pot porni locația prin API-urile
`window._startLiveLocation`, `_stopLiveLocation`, `_isLiveLocationActive` și
`_showLiveLocation`; butonul nu este o condiție pentru watcher.

Scriptul PWA din `index.html` elimină `#pwa-br-stack`, dar nu mai șterge
`#btnLiveLocation`. CSS-ul ascunde numai stiva și controalele de cont — nu
clasa `.btn-live-location`.

## Cache PWA

Schimbarea este livrată prin **Service Worker v133**. `index.html` și lista de
precache din `sw.js` folosesc aceleași URL-uri:

- `js/map-app.js?v=20260923-pwa-live-location`
- `js/tutorial.js?v=20260923-pwa-live-location`

Tutorialul descrie acum butonul PWA separat în dreapta-jos și clarifică faptul
că butonul de cont nu mai este acolo.

## Teste

- `node test-pwa-no-bottom-bar.js` — contul rămâne eliminat; butonul GPS este
  montat separat la dreapta-jos în PWA și în stânga pe site; API-urile live
  location rămân expuse; shell-ul PWA este versionat și pre-cache-uit.
- `node test-pwa-bottom-bar-removal.js` — cu `jsdom`, scriptul standalone
  elimină stiva contului, dar nu șterge controlul GPS; site-ul rămâne neatins.
- `node test-pwa-bottom-band.js` și `node test-pwa-no-bottom-strip.js` — harta,
  safe-area și offset-urile de jos nu regresează.
- `node test-tutorial.js` — ghidul reflectă poziția actuală a butonului și
  distinge funcția GPS de meniul de cont.
