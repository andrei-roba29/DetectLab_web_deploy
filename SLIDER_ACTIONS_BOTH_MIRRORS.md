# Oglinzile verticale: iconițe sub slider în ambele sloturi + oglinda singură la dreapta

Data: 2026-09-22 · Module: `css/styles.css`, `js/vertical-opacity-control.js` ·
Test: `node test-vertical-opacity-actions-both-slots.js`

---

## 1. Iconițele stratului nu mai apar sub slider în a doua oglindă

### Simptom

Când un strat cu butoane proprii — **APM 2.0** („Ajutor de căutare”) sau
**Josephine Map + / Harta Iosefină Premium** (căutare clădiri dispărute /
setări / sugerează) — era adăugat **secundar** pe ecran (al doilea slider
vertical, lângă primul), butoanele lui nu mai apăreau sub slider: ieșeau în
stânga lui, se suprapuneau unele peste altele și erau așezate orizontal,
decentrat.

### Cauză

Oglinda secundară (`#verticalOpacityControlSecondary`) are propriul slot de
acțiuni, `#verticalOpacityActionsSecondary`, iar `syncLayerActions()` mută
fizic butoanele stratului activ în slotul oglinzii active — corect. Doar că
toate regulile care transformă butoanele din varianta lor flotantă
(bottom-center pe hartă) în iconițe 38×38 așezate în coloană sub slider erau
scrise pe id-ul primei oglinzi:

```css
#verticalOpacityActions #apm20SearchHelpBtn, … { position: relative !important; bottom: auto !important; … }
```

În oglinda secundară niciun selector nu se mai potrivea, așa că butoanele
cădeau pe regulile de bază: `position:absolute; bottom:76px; left:50%;
transform:translateX(±112px)` — poziționate față de containerul de acțiuni al
oglinzii, deci toate în același punct (cele două cu ±112px aruncate la stânga /
dreapta), suprapuse și scoase din coloana flex. Eticheta fiecărui buton
(`.vo-action-tip`) rămânea și ea text inline vizibil, în loc de bulă.

### Fix

- **`css/styles.css`** — regulile pentru butoanele andocate, pentru bula
  `.vo-action-tip` și pentru stările lor (hover / focus / `.active` /
  `.needs-zoom` / `:disabled`, inclusiv variantele din `@media`) se leagă acum
  de **clasa** containerului, `.vertical-opacity-actions`, pe care o au ambele
  sloturi (`#verticalOpacityActions` și `#verticalOpacityActionsSecondary`).
  Specificitatea rămâne (1,1,0), deci ierarhia față de regulile de bază
  `(1,0,0)` nu se schimbă — prima oglindă arată exact ca înainte.
- **`js/vertical-opacity-control.js`** — când Josephine Map + e selectat în
  oglinda secundară, pe lângă `body.vo-josephine-docked` se pune și
  `body.vo-josephine-docked-secondary`, iar `css/styles.css` mută ancora
  panoului „Setări detecție” cu un pas de oglindă spre stânga
  (`50px + 14px` desktop, `46px + 10px` sub 600px). Fără asta, panoul de 300px
  ancorat de poziția primei oglinzi s-ar fi întins exact peste sliderul
  secundar și peste iconițele lui.

---

## 2. Oglinda rămasă singură trebuie să stea în cea mai din dreapta poziție

### Simptom

Cu **două** slidere pe ecran, închiderea celui din **dreapta** (×, Escape sau
înlocuirea lui la a treia selecție) lăsa celălalt slider pe poziția lui din
stânga: un singur slider pe ecran plutea decalat, cu o bandă goală până la
marginea hărții.

### Cauză

Cele două sloturi au ancore fixe în CSS — primul lipit de marginea din dreapta
(`right: 38px`, `34px` sub 600px), al doilea la un pas spre stânga
(`38px + 50px + 14px`, respectiv `34px + 46px + 14px`) — ca să poată sta
simultan pe ecran. Când slotul din dreapta se golea, oglinda rămasă în slotul
secundar își păstra ancora de pereche.

### Fix

- **`js/vertical-opacity-control.js`** — `refreshSoleMirrorAnchor()` (apelat din
  `refreshMirroredRows()`, deci după fiecare selecție / închidere / Escape /
  înlocuire) numără oglinzile cu clasa `visible` și pune clasa `mirror-sole` pe
  singura oglindă vizibilă. La a doua selecție clasa dispare și cele două revin
  la ancorele lor de pereche. Perechea Satellite (opacitate + ISTORIC) are
  mereu două controale vizibile, deci nu primește niciodată clasa.
- **`css/styles.css`** — `.vertical-opacity-control.mirror-sole { right: … }` cu
  geometria primului slot (desktop `38px`, sub 600px `34px`), pusă **după**
  regulile `.vertical-opacity-secondary` / `.vertical-period-control` din
  fiecare bloc: au aceeași specificitate (0,2,0), deci ordinea din fișier
  decide. `right` a intrat și în `transition`-ul oglinzii (0.2s; sub
  `prefers-reduced-motion` rămâne `none`), deci preluarea locului e o scurtă
  deplasare, nu un salt.
- **Panoul „Setări detecție”** (Josephine Map +) — `…-secondary` nu se mai pune
  cât timp oglinda e singură (`mirror-sole`), deci panoul se ancorează lângă
  oglinda mutată la dreapta, nu lângă poziția ei veche.

---

## Rulare în PWA

`?v=20260922-vo-actions-both-slots` pentru `css/styles.css` și
`js/vertical-opacity-control.js` în `index.html`, ambele URL-uri adăugate în
`PRECACHE_URLS`, iar `CACHE_NAME` urcat la
`detectlab-v127-vo-actions-both-slots` (aplicația instalată servește shell-ul
din acest cache).

## Verificare

`node test-vertical-opacity-actions-both-slots.js` acoperă:

1. **CSS static** — pentru fiecare dintre cele 4 butoane există reguli andocate
   care anulează geometria flotantă (`position/bottom/left/transform`) și nicio
   regulă nu mai e limitată la `#verticalOpacityActions`; containerul
   `.vertical-opacity-actions` e coloană centrată; ancora secundară a panoului
   de setări există; regula `.mirror-sole` există în blocul desktop și în cel
   de sub 600px, cu ancora primului slot și **după** regula secundară.
2. **Comportament** — modulul real rulat peste un DOM minim: APM 2.0 → butonul
   lui în slotul primei oglinzi; Josephine selectat al doilea → cele trei
   butoane în `#verticalOpacityActionsSecondary` + clasa de ancoră secundară;
   la închidere butoanele se întorc în `.map-wrapper`; închiderea oglinzii din
   dreapta pune `mirror-sole` pe cea rămasă și retrage ancora `…-secondary`;
   închiderea celei din stânga lasă prima oglindă la locul ei; a treia selecție
   reumple slotul liber și clasele `mirror-sole` dispar.
3. **Cas cadă reală** — marcajul real din `index.html` + `css/styles.css` în
   jsdom: poziția, dimensiunea și bula etichetei sunt identice în ambele
   oglinzi, iar `.mirror-sole` aduce oglinda secundară exact pe ancora primei
   oglinzi. jsdom nu e în repo (`node_modules/` e ignorat); secțiunea rulează
   după `npm install jsdom` în rădăcina repo-ului și altfel e sărită (primele
   două părți n-au nicio dependență).

Testul eșuează exact pe simptome dacă fixurile lipsesc:

- fără selectorii pe clasă: `secondary mirror: #apm20SearchHelpBtn position
  should be relative, got absolute`;
- fără `refreshSoleMirrorAnchor()`: `the remaining mirror moves to the
  right-most anchor: the lone mirror gets .mirror-sole`;
- fără regula `.mirror-sole`: `the sole-mirror rule must come after the
  secondary anchor (same specificity)`.
