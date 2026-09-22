# Adăugarea unui slider pe ecran pornește automat stratul lui — chiar și când comutatorul era deja bifat

Data: 2026-09-22 · Module: `js/vertical-opacity-control.js` ·
Test: `node test-vertical-slider-layer-auto-toggle.js` (secțiunile 9–10)

## Simptom

În varianta web, când un slider era adăugat pe ecran (oglinda verticală),
stratul lui **nu pornea automat** — deși comutatorul din panou se bifa.
Vizibil mai ales după **reload / navigare înapoi-înainte**: stratul dispărea
de pe hartă, dar comutatorul rămânea bifat, iar adăugarea sliderului nu mai
făcea nimic — oglinda apărea pe ecran peste o hartă fără strat.

## Cauză

Auto-pornirea funcționa doar la o **tranziție** de comutator:
`setLayerActiveForSource()` din `js/vertical-opacity-control.js` avea
„scurtătura” `if (toggle.checked === on) return;` — dacă checkbox-ul era deja
în starea cerută, nu trimitea evenimentul `change` către `toggle*Layer()` din
`js/map-app.js`. Dar „checkbox bifat” nu înseamnă „strat pornit”: browserele
**restaurează starea bifată** a comutatoarelor la reload / back-forward (form
 restoration), exact cazul în care straturile de pe hartă au dispărut. Rezultat:
comutatorul părea pornit, niciun eveniment nu pleca, stratul rămânea stins.

Aceleași două efecte:
- **substraturi LIDAR** (`setLidarSubActive`): masterul `#lidarToggle` bifat
  restaurat nu primea evenimentul de start, iar `window.toggleLidarSub` din
  `js/map-app.js` iese devreme cât timp starea lui internă `_lidarVisible` e
  falsă — substratul rămânea „pornit” în configurație, dar invizibil;
- **straturi de distanță** (`lidarScannerDistance`, `archeoPotDistance`,
  `archReportDistance`): comutatorul propriu (`archeoPotToggle`,
  `archReportToggle`, `lidarScannerToggle`) e cablat cu `addEventListener('change')`
  în modulele lui — fără eveniment, modulul nici nu pornea. Pentru ele
  `notifyDistanceMirror()` (js/archeo-report.js) chiar interzice dublarea
  oglinzii prin `isActiveFor(...)`, deci singura cale de pornire rămânea
  evenimentul.

## Fix

`js/vertical-opacity-control.js`:

- `setLayerActiveForSource(sliderId, on, force)` primește un al treilea
  argument; la **pornire** (`on = true`, `force = true` — apelurile din
  `selectSource` și `showSatellitePair`) evenimentul `change` se trimite
  **întotdeauna**, chiar dacă checkbox-ul era deja bifat. La oprire
  (`clearSlot` — „×”, Escape, înlocuirea oglinzii) condiția rămâne o tranziție
  reală de stare, ca să nu se trimită evenimente redundante.
- `setLidarSubActive(subKey, on)` trimite evenimentul masterului
  `#lidarToggle` la orice pornire, nu doar când debifat (plus corecția de
  comentariu: `toggleLidarSub` iese devreme cât timp `_lidarVisible` e fals).

Re-trimitea e inofensivă: funcțiile `toggle*Layer` din `js/map-app.js` folosesc
`map.hasLayer(...)` înainte de `addTo`, iar modulele de analiză își apără
oglinda cu `isActiveFor(...)` înainte de `api.select(...)` — nu se creează
buclă comutator → `change` → comutator.

## Rulare în PWA

`?v=20260922-sole-mirror-activate` pentru `css/styles.css` +
`js/vertical-opacity-control.js` în `index.html`, ambele URL-uri adăugate în
`PRECACHE_URLS`, `CACHE_NAME` → `detectlab-v128-sole-mirror-activate`
(acest build conține și reancorarea oglinzii singure — vezi
`SLIDER_ACTIONS_BOTH_MIRRORS.md`).

## Verificare

`node test-vertical-slider-layer-auto-toggle.js` — secțiunile existente (1–8:
pornire/oprire/Escape/LIDAR/distanță/evicțiune/Satellite) plus:

- **9.** comutator bifat din form restoration (`uatToggle.checked = true` fără
  eveniment) → selectarea sliderului trimite totuși un eveniment real de
  pornire (`uatHits` primește încă un `true`), iar „×” îl stinge la loc;
- **10.** masterul LIDAR restaurat bifat → primește evenimentul de start, iar
  substratul e activat exact o dată (`toggleLidarSub(hd, true)`).

Falsificare pe logica veche (`if (toggle.checked === on) return;`):
`AssertionError: a restored-checked switch still receives its real switch-on
event`.

Suplimentar, verificat pe marcajul real din `index.html` în jsdom (sonde în
afara repo-ului): UAT / APM 2.0 / LIDAR-HD cu comutator restaurat pornit
trimit acum `toggleUatLayer(true)` / `toggleApm20Layer(true)` /
`toggleLidarLayer(true) + toggleLidarSub(hd,true)` — înainte de fix: `NONE`.
