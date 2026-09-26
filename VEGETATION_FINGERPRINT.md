# Amprenta Vegetației / Vegetation Fingerprint (PREMIUM)

Grup premium de straturi din familia **Copernicus HR-VPP** (High Resolution
Vegetation Phenology and Productivity), cu tile-uri **încărcate doar pentru
suprafața României**. Panoul apare în tab-ul **Premium / Premium**, între
„Harti istorice” și „Satellite imagery 60's”, cu un master switch, un buton de
expandare a substraturilor și un buton ⓘ cu atribuirea
*„© European Union's Copernicus Land Monitoring Service information”*.

Substraturi livrate:

1. **PPI — Plant Phenology Index** (*Seasonal Trajectories*, 10 m, o
   compoziție la fiecare 10 zile, 2017–2024).
2. **SMX — Season Maximum value** (*VPP MAXV SEASON1*, 10 m, o compoziție pe
   an, 2017–2024): valoarea maximă de vegetație atinsă într-un an — un zid
   sau o fundație sub sol limitează cât de mult poate crește cultura, chiar
   și în plin sezon.
3. **SGU — Season Green-Up rate** (*VPP LSLOPE SEASON1*, 10 m, o compoziție
   pe an, 2017–2024): panta stângă a curbei sezoniere — cât de repede crește
   vegetația la începutul sezonului.
4. **SGD — Season Green-Down rate** (*VPP RSLOPE SEASON1*, 10 m, anual,
   2017–2024): panta dreaptă a curbei sezoniere — cât de rapid se ofilește
   vegetația spre finalul sezonului (Șanțurile umplute cu sol afânat rețin
   apa mai mult și întârziind ofilirea deasupra lor).

Acest document descrie arhitectura, optimizarea de fetching și pașii pentru
adăugarea următoarelor substraturi (QFLAG, SOSD/EOSD, VPP etc. — utilizatorul
le trimite pe rând).

## 1. Serviciul

| | |
|---|---|
| Capabilities WMS (sursă, informativ) | `http://wmts-1.hrvpp2.vgt.vito.be:8080/service/wms` (WMS 1.1.1, GeoWebCache) |
| Endpoint folosit în aplicație | **`https://phenology.hrvpp2.vgt.vito.be/wmts`** (WMTS 1.0.0 KVP) |
| Layer | `CLMS_HRVPP_ST_PPI_10M` (PPI) / `CLMS_HRVPP_VPP_MAXV_SEASON1_10M` (SMX) / `CLMS_HRVPP_VPP_LSLOPE_SEASON1_10M` (SGU) / `CLMS_HRVPP_VPP_RSLOPE_SEASON1_10M` (SGD) |
| TileMatrixSet | `EPSG:3857` — grila XYZ standard (256×256, `TILEMATRIX=EPSG:3857:{z}`) |
| Format | `image/png` (transparent) |
| Dimensiune temporală | `TIME` — PPI: zilele 01 / 11 / 21 ale fiecărei luni, `2017-01-01` → `2024-12-21` (288 dekade); SMX / SGU / SGD: anual, `2017-01-01` → `2024-01-01` (8 valori, partajate prin `VEGFP_VPP_YEARS`) |
| Stil | `STYLE=` (gol — acceptat de GeoWebCache) |

De ce WMTS KVP și nu WMS-ul din capabilities:

- endpoint-ul WMS de mai sus e **HTTP pe portul 8080** — site-ul e servit prin
  HTTPS, iar browserele ar bloca tile-urile ca *mixed content*;
- `phenology.hrvpp2.vgt.vito.be` este **același GeoWebCache HR-VPP** și răspunde
  prin HTTPS pe portul standard (verificat: `GetCapabilities` + `GetTile` cu
  `TIME`); formatul KVP `GetTile` lovește direct cache-ul de tile-uri, fără
  randare WMS dinamică — mai rapid și mai ieftin pentru server;
- grila `EPSG:3857` a serviciului este exact grila XYZ pe care o folosește
  Leaflet, deci fiecare tile e un hit de cache perfect aliniat.

Cererea exactă (construită de `_vegfpBuildPpiUrl` / `_vegfpBuildSguUrl`
în `js/map-app.js`):

```
https://phenology.hrvpp2.vgt.vito.be/wmts?SERVICE=WMTS&REQUEST=GetTile
  &VERSION=1.0.0&LAYER=CLMS_HRVPP_ST_PPI_10M&STYLE=&FORMAT=image%2Fpng
  &TILEMATRIXSET=EPSG%3A3857&TILEMATRIX=EPSG%3A3857%3A{z}
  &TILEROW={y}&TILECOL={x}&TIME=2024-07-01
```

(pentru SMX: `LAYER=CLMS_HRVPP_VPP_MAXV_SEASON1_10M`; pentru SGU:
`LAYER=CLMS_HRVPP_VPP_LSLOPE_SEASON1_10M`; pentru SGD:
`LAYER=CLMS_HRVPP_VPP_RSLOPE_SEASON1_10M`; toate cu `TIME=YYYY-01-01`,
de ex. `2024-01-01` — toate cele trei layere verificate împotriva
serviciului: GetTile răspunde cu PNG, iar un layer inexistent întoarce
ExceptionReport XML)

## 2. Optimizarea volumului de fetching — doar România

Serviciul acoperă toată Europa (EEA38). Încărcarea lui „cât se vede” ar
însemna sute de tile-uri străine la fiecare pan/zoom. Stratul folosește
patru niveluri de restricție (`js/map-app.js`, blocul „Amprenta
Vegetației”):

1. **`bounds` (anvelopa)** — opțiunea publică a `L.GridLayer`. Anvelopa e
   calculată din poligon (`L.latLngBounds(VEGFP_RO_POLYGON)`), iar Leaflet nu
   creează niciun element de tile în afara dreptunghiului.
2. **Mască poligonală** — `VEGFP_RO_POLYGON`, un poligon simplificat al
   României (31 vârfuri, `[lat, lng]`), cu vârfurile împinse spre
   **exterior** (superset): niciun punct al României nu rămâne afară. Clasa
   `VegFpTileLayer` suprascrie `getTileUrl` (același mecanism ca
   `js/corona-wms-layer.js`): tile-ul care **nu intersectează** poligonul
   primește pixelul transparent al lui Leaflet (`L.Util.emptyImageUrl`) —
   zero cereri de rețea pentru Ungaria / Serbia / Bulgaria / Ucraina /
   R. Moldova interioare.
3. **Cache de decizii** — fiecare verdict `(z, x, y)` e memorat (`_vegfpMaskCache`,
   plafon 30.000 de intrări, reset la depășire).
4. **Limite de zoom** — `minZoom 6` (sub z6 nu se încarcă nimic; dreptunghiul
   roșu de acoperire explică de ce) și `maxNativeZoom 15`: produsul are 10 m/px,
   z15 ≈ 3,3 m/px la latitudinea României — deja supra-eșantionat; peste z15
   Leaflet reutilizează tile-urile z15 (zero fetch nou), sub z19 hărțile
   rămân utile prin upscalare CSS.

Efect măsurat pe poligon față de dreptunghiul ``României'': colțurile
străine (ex. tile-urile de peste Budapesta / Sofia / Odesa la zoomuri adânci)
nu se mai cer deloc; la zoomuri mici (z6–z8) un tile de graniță care conține
și teritoriu românesc se încarcă în mod deliberat — nu se pierde nimic din
România.

Guvernorul global de tile-uri (`js/tile-perf.js`) se aplică automat și acestui
strat (opțiunile gesture-safe sunt date și explicit, ca la LIDAR / Sat60).

## 3. UI și integrări

- **Panou** (`index.html`, `#vegfpRow`, `data-category="premium"`): master
  `#vegfpToggle` → `toggleVegfpLayer()`, expandare `#vegfpExpandBtn` /
  `#vegfpExpandIcon` → `toggleVegfpSubLayers()`, panou de substraturi
  `#vegfpSubLayers`, rând PPI `#vegfpPpiRow`.
- **Substratul PPI**: switch `#vegfpPpiToggle` → `toggleVegfpPpiLayer()`
  (pornirea lui aprinde automat masterul, ca la Harta Iosefină +), slider de
  opacitate `#vegfpPpiOpacitySlider` → `setVegfpPpiOpacity()` (implicit 85%),
  badge PREMIUM, buton ⓘ → `showVegfpPpiInfo()`.
- **Substratul SMX** (`#vegfpSmxRow`, după PPI): switch `#vegfpSmxToggle` →
  `toggleVegfpSmxLayer()`, slider `#vegfpSmxOpacitySlider` →
  `setVegfpSmxOpacity()`, badge PREMIUM, buton ⓘ → `showVegfpSmxInfo()`.
- **Substratul SGU** (`#vegfpSguRow`, după SMX): switch `#vegfpSguToggle` →
  `toggleVegfpSguLayer()`, slider `#vegfpSguOpacitySlider` →
  `setVegfpSguOpacity()`, badge PREMIUM, buton ⓘ → `showVegfpSguInfo()`.
- **Substratul SGD** (`#vegfpSgdRow`, după SGU): switch `#vegfpSgdToggle` →
  `toggleVegfpSgdLayer()`, slider `#vegfpSgdOpacitySlider` →
  `setVegfpSgdOpacity()`, badge PREMIUM, buton ⓘ → `showVegfpSgdInfo()`.
  Toate VPP (SMX + SGU + SGD): același pane (`pane_vegfp`), aceeași mască
  România, aceleași limite de zoom ca PPI (`VegFpTileLayer` +
  `_vegfpTilePerfOptions`).
- **Selectorul de dekadă (PPI)**: `#vegfpPpiDateSelect` (optgroup pe ani, 288
  opțiuni ISO) → `setVegfpPpiDate()` (reface URL-ul cu `TIME=` nou și
  reîncarcă tile-urile vizibile) + butoanele ‹ › (`vegfpPpiStepDekad(±1)`)
  pentru răsfoirea sezonului; se blochează la capetele listei. Default:
  `2024-07-01` (miezul sezonului de vegetație, ultimul an complet).
- **Selectorul de an (SMX + SGU + SGD)**: `#vegfpSmxYearSelect` /
  `#vegfpSguYearSelect` / `#vegfpSgdYearSelect` (8 opțiuni, eticheta = anul,
  valoarea = `YYYY-01-01`) → `setVegfpSmxYear()` / `setVegfpSguYear()` /
  `setVegfpSgdYear()` (acceptă doar valorile din lista serviciului) +
  butoanele ‹ › (`vegfpSmxStepYear(±1)` / `vegfpSguStepYear(±1)` /
  `vegfpSgdStepYear(±1)`), blocate la 2017 / 2024. Default: `2024-01-01`
  (ultimul an complet). Anii celor trei straturi VPP sunt independenți
  (lista e partajată, selecția nu).
- **Info ⓘ** (grup + fiecare substrat, cu atribuirea cerută
  `© European Union's Copernicus Land Monitoring Service information`):
  - PPI: *„Arată sănătatea vegetației la fiecare 10 zile de-a lungul
    sezonului. Structurile îngropate schimbă ritmul de creștere al culturii
    deasupra lor, vizibil ca abateri în curba sezonieră.”*
  - SMX: *„Valoarea maximă de vegetație atinsă într-un an. Un zid sau o
    fundație sub sol limitează cât de mult poate crește cultura, chiar și
    în plin sezon.”*
  - SGU: *„Cât de repede crește vegetația la începutul sezonului. Solul
    subțire de deasupra unei structuri îngropate se încălzește și se usucă
    mai repede, așa că cultura de acolo pornește mai lent sau mai rapid decât
    cea din jur — o diferență vizibilă exact în perioada de creștere
    timpurie.”*
  - SGD: *„Cât de rapid se ofilește vegetația spre final de sezon. Șanțurile
    umplute cu sol mai afânat rețin apa mai mult, întârziind ofilirea
    deasupra lor.”*
  - (EN: traducerile corespunzătoare; `_vegfpInfoDescription('ppi' |
    'smx' | 'sgu' | 'sgd')`.)
- **Gating premium** (`js/subscriptions.js`): `toggleVegfpLayer`,
  `toggleVegfpPpiLayer`, `toggleVegfpSmxLayer`, `toggleVegfpSguLayer` și
  `toggleVegfpSgdLayer` sunt în `PREMIUM_TOGGLE_FNS` (un utilizator free nu le poate porni nici măcar
  programatic); rândul primește automat lacătul și e blocat la click prin
  `data-category="premium"`; fereastra Premium listează grupul
  (`prem_feat_vegfp`).
- **Dreptunghiul roșu de acoperire** (`premiumMapCoverageBounds.vegfpPpi` /
  `.vegfpSmx` / `.vegfpSgu` / `.vegfpSgd`, `coverageMinZoom: 6`): sub z6, cu stratul
  pornit, se arată limitele României.
- **Evidențierea la vizibilitate** (`layerDefs` + `groups.vegfp` cu
  `sublayerKeys: ['vegfp_ppi', 'vegfp_smx', 'vegfp_sgu', 'vegfp_sgd']`):
  rândurile PPI / SMX / SGU / SGD se colorează când fereastra hărții atinge România, iar săgeata
  grupului devine verde (`#vegfpExpandIcon`).
- **Oglinda verticală de opacitate** (`js/vertical-opacity-control.js`):
  `LAYER_NAMES.vegfpPpiOpacitySlider` / `.vegfpSmxOpacitySlider` /
  `.vegfpSguOpacitySlider` / `.vegfpSgdOpacitySlider` (etichetele „PPI” /
  „SMX” / „SGU” / „SGD”) și `LAYER_TOGGLE_MAP.vegfpPpiOpacitySlider →
  vegfpPpiToggle` / `vegfpSmxOpacitySlider → vegfpSmxToggle` /
  `vegfpSguOpacitySlider → vegfpSguToggle` / `vegfpSgdOpacitySlider →
  vegfpSgdToggle` (oglinda pornește stratul la adăugare și îl oprește la
  închidere).
- **Service worker** (`sw.js`): cache-ul shell-ului e versionat
  `detectlab-v143-vegfp-smx`; cele patru scripturi modificate sunt
  pre-cache-uite cu `?v=20260926-vegfp-smx`, iar hostul
  `hrvpp2.vgt.vito.be` e trecut prin `PASSTHROUGH_HOSTS` (tile-urile nu intră
  niciodată în cache-ul shell-ului).
- **Pane**: `pane_vegfp` (z-index 612 — peste LIDAR 610, sub dreptunghiurile
  de acoperire 615), `pointer-events: none`.
- **Traduceri** (`js/translations.js`, en + ro): `layer_vegfp_group`,
  `layer_vegfp_ppi`, `layer_vegfp_date_label`, `layer_vegfp_prev_dekad`,
  `layer_vegfp_next_dekad`, `layer_vegfp_smx`, `layer_vegfp_sgu`,
  `layer_vegfp_year_label`,
  `layer_vegfp_prev_year`, `layer_vegfp_next_year`, `layer_vegfp_sgd`,
  `layer_vegfp_ro_note`, `prem_feat_vegfp`.

## 4. Cum se adaugă următorul substrat

Utilizatorul trimite capabilities-ul și numele stratului (ex. QFLAG,
SOSD/EOSD/MAXD, AMPL, LENGTH, SPROD/TPROD, SOSV/EOSV/MINV/MAXV — aceleași
servicii, alte layere și alte granularități temporale; straturile VPP sunt
anuale — SMX/MAXV, SGU/LSLOPE și SGD/RSLOPE sunt livrate ca șabloane
   anuale complete —, „ST”
(PPI/QFLAG) sunt la 10 zile; variantele cu „_LAEA” folosesc aceeași grilă
XYZ în GeoWebCache).

1. **`js/map-app.js`** — în blocul „Amprenta Vegetației”:
   - constantă cu numele layer-ului (ex. `VEGFP_QFLAG_LAYER_NAME`);
   - un builder de URL pe șablonul `_vegfpBuildSguUrl` (dacă stratul e tot
     anual, doar numele layer-ului se schimbă; pentru un strat „ST” la 10
     zile se generalizează `_vegfpBuildPpiUrl` cu layer-ul ca parametru);
   - o funcție `_buildVegfp…Layer()` pe șablonul `_buildVegfpSguLayer()`
     (același `VegFpTileLayer` = mască România + aceleași limite de zoom);
   - `toggleVegfp…Layer()`, `setVegfp…Opacity()` (+ `window._vegfp…Layer`
     pentru dreptunghiul de acoperire și pentru oglinda verticală);
   - intrare în `premiumMapCoverageBounds`, `layerDefs` și `groups`, plus
     oprirea lui în cascada master→substraturi din `toggleVegfpLayer()`
     (la fel ca `vegfpSguToggle` — masterul stins stinge tot).
2. **`index.html`** — un rând în `#vegfpSubLayers` pe șablonul `#vegfpPpiRow`
   (switch + opacitate + info +, după caz, selector de dată). ID-urile urmează
   `vegfp<Key>…`.
3. **`js/subscriptions.js`** — toggle-ul nou în `PREMIUM_TOGGLE_FNS`.
4. **`js/vertical-opacity-control.js`** — `LAYER_NAMES` + `LAYER_TOGGLE_MAP`.
5. **`js/translations.js`** — cheile `layer_vegfp_…` noi (en + ro).
6. **`sw.js`** — bump `CACHE_NAME` (v141…) + intrările `?v=` noi; bump și
   referințele `?v=` din `index.html`.
7. **`test-vegetation-fingerprint.js`** — aserțiuni pentru stratul nou.

## 5. Testare

```
node test-vegetation-fingerprint.js
```

Acoperă: formatul cererii WMTS, mască România (extreme românești înăuntru,
orașe străine afară, simulare tile la z8/z12/z14), lista de dekade PPI
(288, 2017-01-01…2024-12-21), lista anuală VPP partajată SMX/SGU/SGD (8
valori, 2017-01-01…2024-01-01) cu limitarea la capete, textele info cerute
(PPI + SMX + SGU + SGD, RO + EN), cablarea UI (ordinea rândurilor PPI → SMX
→ SGU → SGD), gatingul premium, oglinda verticală, traducerile și
rollout-ul service-worker.
