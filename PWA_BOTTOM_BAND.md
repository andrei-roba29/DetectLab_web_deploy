# Banda închisă de sub hartă în PWA-ul instalat (iPhone)

**Simptom.** În aplicația instalată (Add to Home Screen, iPhone; posibil și Android)
apare o bandă orizontală goală, albăstru-închis (`#060E1E`), în partea de jos a
ecranului, **imediat sub eticheta „© Leafleet”**. Nu conține nimic. Harta se
oprește deasupra ei.

**Fix.** `min-height: 100vh` pe `body.is-pwa #map-section`,
`body.is-pwa .transp-panel`, `body.is-pwa .container` și pe
`body.is-pwa .map-frame, .map-wrapper, #detectlab-map`. Niciun offset de control
nu a fost modificat.

**Diagnostic pe dispozitiv.** `js/pwa-debug.js` — `?pwaDebug=1`, `?pwaDebug=colors`,
sau **5 tap-uri pe eticheta „© Leafleet”** din aplicația instalată.

---

## De ce „sub eticheta Leafleet” localizează exact problema

Eticheta este `css/styles.css` → `.leaflet-container::after { content:"© Leafleet";
position:absolute; bottom:4px; right:6px; }`, deci este ancorată de **marginea de
jos a containerului hărții** (`#detectlab-map`). Orice se vede *sub* ea este în
afara containerului: fâșia de pagină dintre marginea de jos a containerului și
marginea fizică a ecranului, pictată de fundalul paginii
(`html.is-pwa, body.is-pwa { background-color:#060E1E }` și
`#map-section { background:#060E1E }`).

Așadar banda nu este o bară rămasă în DOM. Bara veche, pe toată lățimea, a fost
scoasă în `b319558` („PWA bottom bar removal”) și nu mai există nicio referință
`pwaBottomBar` / `.pwa-bottom-bar` în cod. Un audit al tuturor regulilor
`position:fixed|absolute` + `bottom:0` + `background` din `index.html`,
`css/styles.css`, `css/offline-maps.css` și restul fișierelor CSS nu găsește
niciun element care să picteze o bandă jos: `body::before` este doar sus și e
dezactivat în PWA, `.pwa-install-banner` / `#siteAlert` / overlay-urile sunt
`display:none`, atribuirea Leaflet e ascunsă, `footer` / `#pricing` /
`#get-mobile` sunt ascunse în PWA.

Problema este geometrică: **containerul hărții se termină deasupra marginei
fizice a ecranului.**

## Cauza: ICB-ul scurt cu `safe-area-inset-top`

`#map-section` este `position: fixed`, deci `top:0` / `bottom:0` se rezolvă față
de *initial containing block*. Pagina cere iOS exact combinația documentată ca
producând un ICB mai scurt decât ecranul:

| ingredient | unde | valoare |
| --- | --- | --- |
| `viewport-fit=cover` | `index.html:5` (meta viewport) | prezent |
| `apple-mobile-web-app-status-bar-style` | `index.html:10` | `black-translucent` |
| document dimensionat în `%` / `svh` / `dvh` | `html.is-pwa, body.is-pwa { height:100% !important }` | prezent |

Cu `black-translucent`, WebKit pornește layout-ul de la `y=0`, în spatele barei
de stare translucide, dar **nu compensează înălțimea cutiei**: ICB-ul rămâne cu
`safe-area-inset-top` (~59px pe un iPhone cu Face ID) mai scurt decât ecranul
fizic. Consecințele, toate cu același 59px:

* `bottom: 0` pe un element `position:fixed` aterizează la ~59px deasupra
  marginei de jos → `#map-section` se oprește acolo;
* lanțul `height:100%` (`.container` → `.map-frame` → `.map-wrapper` →
  `#detectlab-map`) moștenește aceeași înălțime;
* eticheta „© Leafleet” (4px deasupra marginii containerului) ajunge *deasupra*
  golului, exact cum a fost raportat;
* restul de ~59px este pictat de fundalul paginii, `#060E1E` — bandă goală.

**Toate citirile ICB-ului sunt scurte cu aceeași valoare** — `%`, `svh`, `dvh`
și `bottom:0` deopotrivă. De aceea rescrierea din v109 (scară `vh → --vh → svh
→ dvh` înlocuită cu stretch `top:0 + bottom:0`) **nu putea** elimina banda: a
schimbat o citire scurtă cu alta citire scurtă.

Unitatea care **nu** citește ICB-ul este `vh` (large viewport): în acest mod
WebKit o rezolvă la ecranul fizic complet. Raportat independent de mai mulți
dezvoltatori pentru exact această combinație:

> „If you're using `viewport-fit=cover` + `black-translucent` and you have
> `html, body { height: 100% }`, the body doesn't grow to fill the actual
> viewport: it gets offset behind the status bar but the height doesn't
> compensate, leaving a ~59px gap at the bottom. Changing `height: 100%` to
> `height: 100vh` fixes it.” — r/PWA, *PWA on iOS… fighting the chin gap*

> „I was using standalone, `viewport-fit=cover`, and `black-translucent` with
> `100dvh` on html/body. Changing it to `100vh` fixed it!” — același fir

> „59px is exactly `safe-area-inset-top` … the band survived and the report came
> back three months later.” — `rjungemann/turmeric` PR #898, aceeași geometrie

## Fixul aplicat

```css
body.is-pwa #map-section {
    position: fixed;
    top: 0; right: 0; bottom: 0; left: 0;
    height: auto !important;
    min-height: 100vh;      /* ← podeaua */
}
body.is-pwa .container {
    height: 100% !important;
    min-height: 100vh !important; /* ← podeaua pe lanțul % */
}
body.is-pwa .map-frame,
body.is-pwa .map-wrapper,
body.is-pwa #detectlab-map {
    height: 100% !important;
    min-height: 100vh !important; /* ← podeaua pe lanțul % */
}
```

Este o **podea, nu o dimensiune**. Când ICB-ul este deja egal cu ecranul
(Android standalone, `?pwa=1` pe desktop, orice versiune de iOS fără
comportamentul scurt), `100vh` este exact stretch-ul `top:0 → bottom:0` și
declarația nu schimbă absolut nimic. Când ICB-ul este scurt, `min-height`
forțează cutia înapoi la înălțimea reală a ecranului, iar banda dispare.

Lanțul `.container → .map-frame → .map-wrapper → #detectlab-map` fusese
`height:100% / min-height:100%`, deci moștenea ICB-ul scurt chiar și după ce
`#map-section` primise podeaua. Fără `min-height:100vh` pe verigile interioare,
`#detectlab-map` rămânea la 785px pe un ecran de 844px, tag-ul `© Leafleet`
(4px deasupra marginii containerului) stătea deasupra golului, iar fundalul
`#060E1E` al secțiunii se vedea dedesubt ca „padding”.

Același tratament pentru `body.is-pwa .transp-panel` (fereastra de straturi):
este tot `position:fixed` cu `top:0 + bottom:0`, deci ar fi arătat exact aceeași
bandă sub ea — lucru pe care PR #211 îl rezolvase doar față de ICB-ul scurt.

### De ce nu am scos `black-translucent`

Este „recomandarea” din aceeași sursă, dar ar muta problema: cu stilul implicit
bara de stare este *rezervată* de iOS, care o pictează cu `theme_color`
(`#060E1E`) — am schimba banda de jos pe o bandă de sus, și am muta fizic toate
controlurile care consumă `env(safe-area-inset-top)` (`.leaflet-top`,
`.offline-library`, chat-ul de evenimente, panoul Babel). Podeaua `100vh`
rezolvă jos fără să atingă sus. Meta tag-urile sunt **assertate neschimbate** în
`test-pwa-bottom-band.js` tocmai ca nimeni să nu „repare” asta mai târziu din greșeală.

## Contractul — niciun control nu s-a mișcat

Toate valorile de mai jos sunt identice la nivel de caracter, iar
`test-pwa-bottom-band.js` le verifică pe fiecare:

| element | valoare |
| --- | --- |
| `#pwa-br-stack` | `right: max(10px, env(safe-area-inset-right, 0px)); bottom: calc(env(safe-area-inset-bottom, 0px) + 28px)` |
| `body.is-pwa .leaflet-bottom` | `bottom: env(safe-area-inset-bottom, 0px) !important` |
| `body.is-pwa` | `--pwa-bottom-controls-clearance: 44px; --pwa-bottom-controls-half-clearance: 0px` |
| `body.is-pwa .layer-action-dock` | `bottom: calc(20px + env(safe-area-inset-bottom, 0px))` |
| `body.is-pwa .offline-map-panel` | `bottom: calc(8px + var(--pwa-bottom-controls-clearance, 44px))` |
| `.leaflet-container::after` | `bottom: 4px; right: 6px` |

## Sonda de pe dispozitiv (`js/pwa-debug.js`)

Raportorul nu poate trimite capturi de ecran, iar geometria iOS nu poate fi
reprodusă pe desktop (Chromium raportează mereu 0 pentru `env(safe-area-inset-*)`
și nu știe de `display-mode: standalone` sub automatizare). Sonda tipărește
geometria direct pe telefon și poate preda tot raportul dintr-un singur tap.

### Pornire

| cale | efect |
| --- | --- |
| `?pwaDebug=1` | numere, și persistă fanionul |
| `?pwaDebug=colors` | numere + benzi de culoare |
| `?pwaDebug=0` | oprire explicită, șterge fanionul |
| **5 tap-uri în 2,5 s pe eticheta „© Leafleet”** | comută off → numere → culori → off |

Gestul există pentru că **iOS dă unei aplicații Add-to-Home-Screen propriul
container de stocare**: `localStorage`, IndexedDB, Cache API și service worker-ul
nu sunt partajate cu Safari. Un fanion pus în Safari nu ajunge niciodată în
aplicația instalată — adică exact pe dispozitivul care arată bug-ul. Gestul nu
adaugă niciun element și niciun ascultător care să afecteze layout-ul: citește
doar coordonatele pointer-ului față de rect-ul propriu al etichetei.

Când e activ, overlay-ul apare la ~1,8 s după `load` (după trecerile de
așezare ale hărții, ca să nu tipărească numere dinainte de layout), stă 10 s,
apoi se strânge într-o pastilă `DBG` în stânga sus; un tap pe pastilă îl
redeschide. `📋 COPY` pune tot raportul în clipboard.

### Ce măsoară

* **`position:fixed; bottom:0` probe → `.bottom`** — unde se termină ICB-ul, de
  fapt. Este numărul cel mai informativ: toate cutiile „stretch” din pagină se
  rezolvă față de el.
* probe `100vh` / `100dvh` / `100svh` — care unitate dă ecranul fizic.
* `innerHeight`, `visualViewport.height` / `.offsetTop` / `.scale`,
  `screen.height`, `screen.availHeight`, `documentElement.clientHeight`, `dpr`.
* `env(safe-area-inset-top/right/bottom/left)` rezolvate în px.
* `getBoundingClientRect()` pentru `#map-section`, `.map-frame`, `.map-wrapper`,
  `#detectlab-map` și pentru un span-probe cu aceeași ancorare ca
  `.leaflet-container::after` (adică poziția reală a etichetei).
* `Leaflet map.getSize()`.
* un **verdict**, în română și engleză.

### Verdictul

| raport | înseamnă |
| --- | --- |
| `100vh − ICB bottom > 8px` | **ICB scurt** — cauza de mai sus; podeaua `min-height:100vh` închide banda |
| ICB întreg, dar harta mai scurtă | **H1** — o regulă de layout încă scurtează lanțul |
| ICB întreg și harta la margine | pagina ajunge jos; dacă banda se vede încă, **pixelii nu sunt ai paginii** (H2) |

### Modul CULORI — identifică pictorul dintr-un singur tur

Fiecare strat candidat primește o altă culoare, ca raportorul să poată spune
pur și simplu ce culoare are banda:

| culoare | element |
| --- | --- |
| roșu | `html` |
| lime | `body` |
| galben | `#map-section` |
| cyan | `.map-frame` |
| magenta | `.map-wrapper` |
| portocaliu | `#detectlab-map` |
| **bleumarin `#060E1E`** | **niciunul** → pixelii nu sunt ai paginii; iOS îi pictează cu `background_color` din manifest și nicio regulă CSS nu-i poate atinge |

### Gating

Oprit implicit. Când e oprit, modulul nu injectează niciun DOM și niciun stil și
înregistrează un singur ascultător pasiv în faza de captură, pentru gestul de
5 tap-uri. Când e pornit, tot ce adaugă este `position:fixed`, parcat în afara
viewport-ului sau invizibil și click-through — nu poate muta niciun control.
`disable()` scoate fiecare nod înapoi (verificat în
`test-pwa-bottom-band-probe.js`).

## Dacă banda supraviețuiește după deploy

Atunci ICB-ul **nu** este scurt, verdictul sondei va spune `PAGE REACHES THE
BOTTOM`, iar suspectul rămas este H2: iOS nu extinde WebView-ul standalone în
zona home-indicator pentru această pagină și pictează el fâșia cu
`background_color`. Modul CULORI confirmă asta într-un singur tur — banda rămâne
bleumarin în timp ce restul straturilor sunt roșu/lime/galben. În acel caz
nicio regulă CSS din pagină nu poate șterge banda; opțiunile oneste sunt
`"display": "fullscreen"` / `display_override` în `manifest.json` (ascunde și
bara de stare — de întrebat utilizatorul înainte) sau schimbarea
`background_color` astfel încât fâșia să se confunde cu harta.

## Verificarea deploy-ului

Schimbarea ajunge pe telefon abia după merge + deploy + reîmprospătarea
service worker-ului. Gazda live este `https://detectlab.ro`; versiunea se citește
din `sw.js` → `const CACHE_NAME = 'detectlab-vNNN-…'`.

* v109 (fix-ul stretch) a intrat în `main` prin PR #220 și **este deja live**:
  la momentul acestei analize `https://detectlab.ro/sw.js` servea
  `detectlab-v111-offline-100km`, identic cu `main`. Deci decalajul de deploy
  care explica „banda încă se vede” nu mai există — utilizatorul rula deja
  stretch-ul din v109 când a raportat din nou banda, ceea ce este exact
  confirmația că stretch-ul singur nu era suficient.
* acest fix este `detectlab-v112-pwa-bottom-band`.

## Teste

| test | ce verifică |
| --- | --- |
| `node test-pwa-bottom-band.js` | podeaua `min-height:100vh`, meta tag-urile neschimbate, **întreg contractul de offset-uri**, gating-ul sondei, bump-ul de cache |
| `node test-pwa-bottom-band-probe.js` | funcțional, cu jsdom: sonda e inertă până la activare, tipărește ICB/`100vh`/`dvh`/`svh`/`env()`/rect-uri, verdictul separă ICB scurt de pagină întreagă de bug de layout, gestul de 5 tap-uri, teardown complet. `npm i --no-save jsdom` (se omite dacă lipsește) |
| `node test-pwa-no-bottom-strip.js` | testul v109, încă verde |
| `node test-pwa-layer-panel.js` | fereastra de straturi, încă verde |
| `node test-offline-maps-panel.js` · `node test-tutorial.js` | încă verzi |

`test-gmaps-directions.js` eșuează și la HEAD, dintr-un motiv preexistent și
fără legătură: așteaptă `CACHE_NAME = 'detectlab-v10[6-9]-gmaps-directions`.
