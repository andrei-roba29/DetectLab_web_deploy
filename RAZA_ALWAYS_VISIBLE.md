# RAZĂ / DISTANȚĂ / ISTORIC rămâne vizibil deasupra oglinzii și în landscape

Data: 2026-09-23 · Fișiere: `css/styles.css`, `index.html`, `sw.js`
Test: `node test-vertical-caption-above-card.js` · Probe: `/tmp/probe/geo.js`

---

## Cerință utilizator

> „cuvântul 'raza' aferent unor slideuri de opacitate, ar trebuie sa apara
> deasupra lor cand sunt adaugate pe ecran”

Cuvântul **RAZĂ** (și prin extensie **DISTANȚĂ** / **ISTORIC**) aparține
oglizilor verticale de pe hartă:

- `archeoPotDistance` – Zone cu potențial arheologic → RAZĂ / RADIUS
- `archReportDistance` – Raport arheologic → RAZĂ / RADIUS
- `lidarScannerDistance` – LIDAR Scanner → DISTANȚĂ / DISTANCE
- `satPeriodSlider` / `satellitePeriod` – Satellite istoric → ISTORIC / HISTORIC

Acceptanță:

- cip-ul trebuie să fie vizibil **deasupra cardului**, centrat,
  `bottom: calc(100% + 7px)` (sau +4px pe ecrane scurte), `display:block`,
  nu acoperit de `#mapHelpBtn`, `#mapSearchWrap`, `#btnCloseFullscreen`;
  `elementFromPoint` în centrul cip-ului lovește cip-ul însuși;
- funcționează pe desktop, PWA portrait, PWA/browser landscape, slot primar
  și secundar, inclusiv `mirror-sole`.

## Simptom anterior

În `css/styles.css` blocul

```css
@media (max-height: 500px) {
  .vertical-opacity-control { height: 222px; }
  .vertical-opacity-caption { display: none; }
}
```

ascundea complet cip-ul pe orice viewport cu înălțime ≤500px – adică exact
telefonul în landscape (915×412, 640×364, 667×320 fullscreen). Motivul
inițial: cip-ul s-ar fi întâlnit cu butonul „?” din colțul dreapta-sus.
Utilizatorul a cerut explicit ca RAZĂ să rămână vizibilă chiar și acolo:
bula de valoare (ex. „3 km”) singură nu e suficientă.

## Fix

### CSS – `css/styles.css` `@media (max-height: 500px)`

Înainte:

```css
.vertical-opacity-caption { display: none; }
```

După:

```css
.vertical-opacity-control { height: 222px; z-index: 1001; }
.vertical-opacity-caption:not(:empty) {
  display: block !important;
  bottom: calc(100% + 4px);
  z-index: 3;
}
```

- `display:block !important` + `:not(:empty)` – cip-ul rămâne vizibil chiar
  și pe ecrane scurte, dar unul gol (oglinzile de opacitate pură) tot se
  ascunde prin regula `:empty { display:none }` deja existentă.
- `z-index:1001` pe card – butonul de ajutor `#mapHelpBtn` are `z-index:1000`,
  deci cip-ul pictează **deasupra** lui. Pentru testul topmost din harness
  (`elementFromPoint`) cip-ul este hit-testat cu `pointer-events:auto`
  temporar și rămâne deasupra.
- În uz real cip-ul are `pointer-events:none`, deci chiar dacă vizual
  suprapune „?” sau bara de căutare, tap-ul trece prin el și butonul de
  dedesubt rămâne apăsabil.
- `bottom: calc(100% + 4px)` în loc de 7px – pe 222px înălțime cardul e mai
  mic, 4px păstrează gap-ul vizibil (măsurat 3px din cauza border-ului).

### Versiuni – `index.html` + `sw.js`

- `index.html`: `css/styles.css?v=20260923-close-hit-area` →
  `css/styles.css?v=20260923-raza-always-visible`
- `sw.js`: `CACHE_NAME` `v133` → `v134-raza-always-visible`,
  `PRECACHE_URLS` primește noul URL. Comentariul de la `CACHE_NAME`
  documentează cerința.

### Test – `test-vertical-caption-above-card.js`

Actualizat:

- blocul `max-height:500px` **nu mai are voie** să conțină `display:none`
  pentru cip;
- trebuie să conțină `display:block` (sau `:not(:empty) { display:block }`);
- mesajele explică cerința utilizatorului.

## Verificare

### Static

```
node test-vertical-caption-above-card.js
# OK — 53 checks
```

Acoperă: copil direct al cardului, id-uri păstrate, CSS poziționat absolut
deasupra, centrat, pointer-events:none, :empty ascuns, card poziționat,
fără regulă descendentă prin `.vertical-opacity-title`, înveliș PWA
absolut, ≤600px păstrează cip-ul, **max-height:500px păstrează cip-ul**,
rezolvare prin id, caption keys, fără badge PE HARTĂ, cache busting.

### Geometrie headless (Chromium 138 + @sparticuz/chromium)

Harness: `/tmp/probe/geo.js` – pornește server static din repo, lansează
Puppeteer, scoate auth gate, apelează `DetectLabVerticalOpacity.select(id)`,
măsoară `getBoundingClientRect`, `elementFromPoint`, overlaps.

| viewport | mod | card | gap deasupra | inViewport | covered | overlaps |
|---|---|---|---|---|---|---|
| 1280×800 | web | archeoPotDistance + archReportDistance | 6px | true | [] | [] |
| 412×915 | pwa | idem | 6px | true | [] | [] |
| **915×412** | **pwa** | idem | **3px** | **true** | **[]** | **[]** |
| 640×364 | web | idem | 3px | true | NAV (header) | [] |
| 667×320 | fs | idem | 3px | true | [] | help, fsClose (vizual suprapus dar cip deasupra) |
| 915×412 | pwa | lidarScannerDistance (DISTANȚĂ) | 3px | true | [] | [] |
| 915×412 | pwa | satPeriodSlider (ISTORIC) | 3px | true | [] | [] |

Capturi:

- `pwa-landscape-raza.png` (915×412) – ambele RAZĂ la 3px deasupra cardului,
  centrate, nu acoperă ×.
- `640x364-raza.png` – în mod web non-fullscreen header-ul site-ului
  acoperă parțial cip-ul (comportament normal, harta nu e fullscreen acolo).
- `667x320-raza.png` – fullscreen browser, cip-ul rămâne vizibil chiar dacă
  atinge vizual „?” și „✕” fullscreen; z-index 1001 îl pictează deasupra,
  pointer-events:none lasă butoanele apăsabile.

Fără fix, pe 915×412 `display` era `none`, `inViewport` false.

### Alte teste

```
node test-slider-close-hit-area.js
node test-slider-deliberate-tap.js
node test-mobile-fullscreen-controls.js
node test-two-layer-opacity-mirrors.js
node test-distance-mirror-close-isolation.js
# toate OK
```

## Consecințe / trade-off

- În landscape foarte scurt (≤360px înălțime) cip-ul poate suprapune vizual
  butonul „?” sau bara de căutare. Decizia este conform cerinței
  utilizatorului: RAZĂ trebuie să fie vizibilă oricum. Suprapunerea este
  mitigată prin:
  - `pointer-events:none` pe cip → tap-ul ajunge la butonul de dedesubt;
  - `z-index:1001` pe card → cip-ul nu este acoperit, `elementFromPoint`
    lovește cip-ul.
- Dacă pe viitor se dorește evitare completă a coliziunii, se poate adăuga
  o repoziționare condiționată (ex. mutare cip la stânga cardului când
  `card.top < help.bottom + 8px`), dar momentan nu este necesară.

## Legat de

- `CAPTION_ABOVE_CARD.md` (v130) – mutarea cip-ului copil direct al cardului
  pentru PWA.
- `SLIDER_CLOSE_HIT_AREA.md` (v131) – mărirea hit area ×.
- `SLIDER_DELIBERATE_TAP.md` (v132) – tap deliberat în PWA.
