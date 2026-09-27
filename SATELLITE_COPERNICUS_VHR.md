# Satellite „Istoric” → Copernicus VHR 2012 / 2018 / 2021

Stratul de bază **Satelit** avea două poziții pe sliderul „Istoric”: ortofotoplanul
**2016** de la geo-spatial.org (`geospatial:of_2017_2020`) și imaginea actuală
(Esri World Imagery). Ortofotoplanul 2016 a fost **scos** și înlocuit cu cele trei
mozaicuri **VHR (Very High Resolution)** ale *Copernicus Land Monitoring Service*,
publicate de Agenția Europeană de Mediu (EEA) pe `discomap.eea.europa.eu`.

Sliderul are acum **patru** poziții: `2012 · 2018 · 2021 · 2025`.

---

## 1. Sursele WMS

| Poziție | Serviciu | `layers=` | Rezoluție nativă |
|---|---|---|---|
| **2012** | `https://copernicus.discomap.eea.europa.eu/arcgis/services/GioLand/VeryHighResolution2012/MapServer/WMSServer` | `Image` | 2,5 m |
| **2018** | `https://image.discomap.eea.europa.eu/arcgis/services/GioLand/VHR_2018_WM/ImageServer/WMSServer` | `VHR_2018_WM` | 2,5 m |
| **2021** | `https://image.discomap.eea.europa.eu/arcgis/services/GioLand/VHR_2021_LAEA/ImageServer/WMSServer` | `VHR_2021_LAEA` | 2 m |
| **2025** | Esri World Imagery (`window._satLayer`, neschimbat) | — | variabil |

Numele de strat nu sunt evidente și au fost citite din `GetCapabilities`:

* cele două `ImageServer` expun un singur strat, cu numele serviciului
  (`VHR_2018_WM`, `VHR_2021_LAEA`);
* `MapServer`-ul din 2012 publică un mosaic dataset ca grup fără nume, cu
  sub-straturile `Boundary`, `Footprint` și **`Image`** — imageria e `Image`.
  Orice alt nume răspunde `Parameter 'layers' contains unacceptable layer names.`

### Proiecție

* 2018 e nativ Web-Mercator (sufixul `_WM`), 2012 e publicat tot în EPSG:3857.
* **2021 e nativ LAEA (EPSG:3035)** și `GetCapabilities` anunță doar
  `CRS:84`, `EPSG:4326`, `EPSG:3035` — *fără* `EPSG:3857`. ArcGIS Server
  reproiectează însă server-side orice cod EPSG cunoscut, așa că cererea
  Leaflet în `EPSG:3857` este onorată (verificat: un `SRS` inexistent
  răspunde `Parameter 'srs(crs)' has wrong value.`, `EPSG:3857` răspunde cu
  imagine). Nu e nevoie de `L.CRS` separat sau de reproiecție client-side.

Cererile pleacă ca **WMS 1.1.1** (`SRS=`, ordine `minx,miny,maxx,maxy`), ca să
nu depindă de inversarea axelor din 1.3.0.

### Zoom

`maxNativeZoom: 17` (constanta `SAT_HIST_LAST_NATIVE_Z`). La 2–2,5 m/pixel, z17
e ultimul nivel cu detaliu real la latitudinea României; peste el serverul doar
reeșantionează, deci Leaflet face overzoom local până la `maxZoom: 20` în loc
să mai ceară tile-uri inutile.

### Acoperire

Verificată pe România prin catalogul mozaicurilor (`/query` pe un bbox din
centrul țării): 2 elemente pentru 2021, 6 pentru 2018, 9 amprente pentru 2012;
`identify` întoarce valori de pixel reale, nu `NoData`.

---

## 2. Comportament

`js/map-app.js`:

```js
var SAT_PERIOD_ORDER = ['2012', '2018', '2021', 'prezent'];
```

* **O singură** perioadă e pe hartă la un moment dat. `setSatPeriod(idx)` scoate
  din `map` celelalte mozaicuri (și stratul Esri când e activă o perioadă
  istorică), ca să nu se descarce tile-uri nefolosite.
* `setSatOpacity()` și `setSatPeriod()` aplică opacitatea din panou **tuturor**
  mozaicurilor (`Object.keys(SAT_HIST_PERIODS)`), nu unui an hard-codat.
* Starea inițială rămâne „2025” (Esri), deci la deschiderea hărții nu pleacă
  nicio cerere WMS către discomap.
* `window._satHistPeriods` rămâne registrul public; globalul `window._sat2016Layer`
  a dispărut odată cu stratul.

---

## 3. Interfață

### Panou (`index.html`)

* `#satPeriodSlider`: `min=0 max=3 step=1 value=3`.
* `#satPeriodTicks`: `2012 · 2018 · 2021 · 2025` (ultimul tick rămâne tradus
  prin `data-key="layer_sat_period_present"`).
* Oglinda verticală `#verticalSatPeriodSlider`: `min=0 max=3 value=3`. Oglinda
  își ia oricum geometria din sliderul din panou la fiecare sincronizare, deci
  lista de poziții are o singură sursă de adevăr.
* `js/vertical-opacity-control.js`: `SAT_PERIOD_LABELS_FALLBACK` devine
  `['2012', '2018', '2021', '2025']` (folosit doar când tick-urile lipsesc din
  DOM — în teste / pre-render).

### Marcaje de poziție (`css/styles.css`)

* Sliderul orizontal din panou primește patru puncte:
  `8px`, `calc(8px + (100% - 16px) / 3)`, `calc(8px + (100% - 16px) * 2 / 3)`,
  `calc(100% - 8px)`.
* Pista verticală a oglinzii primește patru puncte prin
  `background-position: 50% 0, 50% 33.333%, 50% 66.667%, 50% 100%`.

---

## 4. Atribuire (tab-ul info)

Atribuirile native Leaflet sunt ascunse prin CSS (`.leaflet-control-attribution
{ display: none }`), deci sursele se declară în **tab-ul info** al stratului.

Cardul *Satelit* are acum buton **ⓘ**, care deschide:

> **Satelit / Satellite**
> © Esri, Maxar, Earthstar Geographics ·
> **© European Union's Copernicus Land Monitoring Service information**
>
> *Sliderul „Istoric” comută imaginea de bază între mozaicurile Copernicus VHR —
> 2012 (2,5 m), 2018 și 2021 (2 m) — și imaginea satelitară actuală.*

Punctul de intrare e `window.showSatelliteInfo()` (`js/map-app.js`), bilingv
RO/EN prin `window._currentLang()`; butonul din `index.html` are și un fallback
inline cu același text, pentru cazul în care scriptul nu s-a încărcat încă.
Aceeași frază e pusă ca `attribution` pe fiecare din cele trei straturi WMS
(constanta `COPERNICUS_LAND_ATTRIBUTION`).

---

## 5. PWA / service worker

`sw.js`:

* `CACHE_NAME` → `detectlab-v144-sat-copernicus-vhr`;
* `PASSTHROUGH_HOSTS` primește `discomap.eea.europa.eu`, ca tile-urile WMS să
  NU treacă prin strategia de app-shell;
* pre-cache pentru URL-urile noi cerute de pagină:
  `css/styles.css?v=20260927-sat-copernicus-vhr`,
  `js/map-app.js?v=20260927-sat-copernicus-vhr`,
  `js/vertical-opacity-control.js?v=20260927-sat-copernicus-vhr`.

---

## 6. Teste

```bash
node test-sat-historic-periods.js
```

Acoperă: cele trei URL-uri WMS + numele de straturi, atribuirea Copernicus pe
fiecare strat, dispariția completă a ortofotoplanului 2016 din cod, ordinea
celor patru poziții, opacitatea aplicată tuturor mozaicurilor, butonul ⓘ și
textul lui, cele patru stopuri din panou și din oglinda verticală, plus
comportamentul oglinzilor pereche pe un DOM simulat (2012 / 2018 / 2021 / 2025).

`test-pwa-shell-refresh.js` și `test-vegetation-fingerprint.js` nu mai fixează
numele de cache / tag-urile `?v=` ale versiunii anterioare: verifică numărul de
versiune (`>= 143`) și relația *live* „ce cere index.html = ce pre-cache-uiește
sw.js”, ca să nu mai fie rupte de fiecare release.
