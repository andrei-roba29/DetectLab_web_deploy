# Eticheta DISTANȚĂ / RAZĂ deasupra sliderului de pe hartă (și în PWA)

Data: 2026-09-22 · Fișiere: `index.html`, `css/styles.css`, `sw.js` ·
Test: `node test-vertical-caption-above-card.js`

---

## Simptome

1. **Eticheta „DISTANȚĂ” / „RAZĂ” nu apărea deasupra sliderului** în aplicația
   instalată (PWA). Când sliderul de distanță al unui strat de analiză —
   **LIDAR Scanner** (DISTANȚĂ), **Zone cu potențial arheologic** și
   **Raport arheologic** (RAZĂ) — era adăugat pe ecran ca oglindă verticală,
   cip-ul cu numele mărimii cădea **pe marginea de sus a cardului**, peste
   butonul „×”, în loc să plutească deasupra cardului, cum se întâmpla pe
   desktop. Același lucru și pentru cip-ul **ISTORIC** al perechii Satellite.
2. Sub sliderul din panou al straturilor care au oglinda pe hartă mai putea
   apărea insigna **„PE HARTĂ / ON MAP”** — deși codul o scosese (v124),
   telefoanele care încă serveau shell-ul vechi din cache o afișau.

## Cauză

Cip-ul (`.vertical-opacity-caption`) e poziționat absolut:
`bottom: calc(100% + 7px); left: 50%; translateX(-50%)` — adică „7px deasupra
**blocului conținător**, centrat pe el”. El stătea însă **în interiorul**
învelișului titlului (`.vertical-opacity-title`).

- Pe desktop, învelișul e o celulă statică de grid → blocul conținător era
  cardul → cip-ul plutea deasupra cardului. Corect.
- În PWA, regula `body.is-pwa .vertical-opacity-title` face învelișul
  **el însuși poziționat absolut** (fallback-ul cu titlul rotit pe latura
  stângă: 14px lățime, `height: calc(100% - 42px)`, centrat vertical). Așa
  învelișul devenea blocul conținător al cip-ului: „100% + 7px” se măsura de
  la cutia titlului — care începe la 21px sub marginea de sus a cardului —
  iar „centrat” însemna centrat pe o coloană de 14px lipită de marginea
  stângă. Rezultat: cip-ul ateriza pe marginea de sus a cardului, peste „×”.

## Fix

- **`index.html`** — în toate cele trei carduri (`#verticalOpacityControl`,
  `#verticalOpacityControlSecondary`, `#verticalSatPeriodControl`) cip-ul
  (`#verticalOpacityCaption`, `#verticalOpacityCaptionSecondary`,
  `#verticalSatPeriodCaption`) e mutat **copil direct al cardului**, frate cu
  învelișul titlului; învelișul păstrează doar inițialele stratului
  (`.vertical-opacity-layer`). Id-urile rămân aceleași, deci
  `js/vertical-opacity-control.js` (care le rezolvă prin `getElementById`)
  nu are nevoie de nicio modificare.
- **`css/styles.css`** — `.vertical-opacity-caption` păstrează geometria
  (7px deasupra, centrat) și primește explicit `pointer-events: none`
  (înainte îl moștenea de la înveliș), ca să nu prindă tap-urile pe hartă de
  deasupra cardului. Comentariile de la `.vertical-opacity-title` /
  `body.is-pwa .vertical-opacity-title` explică invariantul: învelișul PWA e
  poziționat, deci **nu are voie** să conțină cip-ul. Regula existentă pentru
  ecrane scurte (`@media (max-height: 500px)` — telefon în landscape) ascunde
  în continuare cip-ul, altfel s-ar întâlni cu butonul „?” din colțul din
  dreapta-sus; e documentată acum în CSS.
- Insigna „PE HARTĂ / ON MAP” nu există în cod; `refreshMirroredRows()` șterge
  în continuare atributul `data-vo-mirrored-label` rămas de la shell-uri
  vechi. Ce rezolvă cazul raportat e **bump-ul de cache** de mai jos: toate
  aplicațiile instalate trec pe shell-ul fără insignă (reîncărcarea automată
  la `controllerchange` din `PWA_SHELL_REFRESH.md` face restul).

## Rulare în PWA

`css/styles.css?v=20260922-caption-above-card` în `index.html`, URL-ul
adăugat în `PRECACHE_URLS`, iar `CACHE_NAME` urcat la
`detectlab-v130-caption-above-card` (aplicația instalată servește shell-ul
din acest cache).

## Verificare

`node test-vertical-caption-above-card.js` (static, fără browser) acoperă:

1. în fiecare din cele trei carduri cip-ul e **copil direct** al
   `.vertical-opacity-control` (nu e imbricat în niciun `<span>`), își
   păstrează id-ul, iar `.vertical-opacity-title` conține doar
   `.vertical-opacity-layer`; oglinzile livrează cip gol, Satellite livrează
   `ISTORIC`;
2. CSS: cip poziționat absolut, `bottom: calc(100% + Npx)`, centrat,
   `pointer-events: none`, `:empty` ascuns; cardul e poziționat (blocul
   conținător), nicio regulă nu presupune cip-ul în înveliș; învelișul PWA
   rămâne `position: absolute` (precondiția regresiei); blocul `≤600px` NU
   ascunde cip-ul, blocul `max-height: 500px` da;
3. JS: modulul rezolvă cip-urile prin id, nu prin `querySelector` relativ la
   titlu; sursele de distanță păstrează `caption: 'distance' | 'radius'` și
   textele bilingve DISTANȚĂ / DISTANCE / RAZĂ / RADIUS;
4. fără insignă: niciun `attr(data-vo-mirrored-label)` sau `content:` cu
   „PE HARTĂ / ON MAP” în CSS, niciun `setAttribute('data-vo-mirrored-label')`
   / `mirroredRowLabel` în JS, curățarea atributului rămâne;
5. cache: `index.html` cere `styles.css` cu tag-ul nou (sau unul ulterior),
   `sw.js` îl pre-cache-uiește, `CACHE_NAME ≥ v130`.

Fără fix, testul eșuează exact pe cauză:
`the caption chip must be a DIRECT child of the card, not nested in
<span vertical-opacity-title>`.

Verificat și vizual în Chromium headless (viewport 412×915, mod standalone
emulat): pentru `lidarScannerDistance` (DISTANȚĂ), `archeoPotDistance` +
`archReportDistance` (RAZĂ, două oglinzi alăturate) și perechea Satellite
(ISTORIC), marginea de jos a cip-ului stă la 6px deasupra marginii de sus a
cardului (7px față de padding box, minus bordura de 1px), iar cip-ul e
centrat pe card; pe desktop geometria e neschimbată.
