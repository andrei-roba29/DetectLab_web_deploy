# PWA shell refresh — „nu se pot adăuga 2 slidere” + „lipsește titlul de pe lateralul sliderului”

**Simptom (raportat 2026-09-22).** În aplicația instalată (PWA):
1. nu se pot păstra **două** slidere verticale pe ecran — selectarea unui al
   doilea strat îl ascunde pe primul;
2. sliderul oglindit **nu arată titlul stratului scris pe lateralul** lui.

**Diagnostic.** Funcțiile cerute **erau deja publicate** în aceeași zi:

- `v121 / e89343e` — titlul stratului primește o coloană proprie iar eticheta
  rotită o cutie explicită în PWA (`body.is-pwa .vertical-opacity-…` în
  `css/styles.css`), anume pentru WebView-urile mobile care colapsau pistele
  de grid `auto` și lăsau inițialele în afara casetei;
- `v122 / bed9cad` — două oglinzi verticale independente pot rămâne simultan
  pe hartă (`verticalOpacityControlSecondary` + ancora `.vertical-opacity-secondary`);
- `v124 / c44a605` — rows oglindite fără badge „PE HARTĂ”.

Site-ul (browser) le arăta corect pe ambele; PWA-ul instalat nu. Cauza comună
a celor două simptome este **shell-ul cache-uit al aplicației instalate**:
clientul nu chema niciodată `reg.update()`, iar când noul `sw.js` activa
(`skipWaiting` + `clients.claim` existau deja în `sw.js`), pagina VECHE rămânea
în control până la un reload complet — pe telefon, snapshot-ul WebView al
aplicației instalate supraviețuiește „redeschiderilor” obișnuite mult zile la
rând. Aparent „PWA-ul nu primește update-urile”, chiar după merge + deploy.

Bonus găsit la investigație: coada lui `index.html` era coruptă — un fragment
de script duplicat și text liber (`init', on); }; } … t>`) **după** `</html>`.

**Fix (`v125`).**

- `index.html` — blocul de înregistrare a service worker-ului:
  - `reg.update()` după `load`, pe `pageshow`, la revenirea în foreground
    (`visibilitychange`) și o dată pe minut cât aplicația e deschisă;
  - la `controllerchange` (un worker NOU preia controlul peste unul VECHI):
    **reload exact o dată**, cu gardă împotriva buclelor
    (`sessionStorage['dl-sw-reload-at']`, max 1/30 s) și fără reload la prima
    instalare (nu reîncărcăm dacă pagina nu avea deja un controller);
  - scripturile mutate în interiorul `<body>`, iar resturile corupte de după
    `</html>` șterse (documentul se parsează din nou ca o unitate curată).
- `sw.js` — `CACHE_NAME` devine `detectlab-v125-pwa-shell-refresh`, deci
  diferența de octeți declanșează update-ul și curăță cache-urile vechi la
  `activate`.

**Ce vede utilizatorul.** La prima deschidere online cu `v125` live, PWA-ul
instalat se reîncarcă automat o singură dată și ajunge pe shell-ul curent:
cele două slidere rămân ambele pe hartă, iar inițialele stratului sunt scrise
pe lateralul stâng al sliderului, exact ca pe site.

**Teste.**

| test | ce verifică |
| --- | --- |
| `node test-pwa-shell-refresh.js` | bump-ul de cache, `skipWaiting`/`claim`, trigger-ii de `reg.update()`, reload-ul unic cu gardă, coada curată a documentului, prezența slotului secund + fallback-ul de titlu PWA + pin-urile de precache |
| `node test-two-layer-opacity-mirrors.js` | două oglinzi independente — neschimbat |
| `node test-vertical-opacity-control.js` | comportamentul oglinzii — neschimbat |
| `node test-pwa-layer-panel.js` · `test-pwa-no-bottom-bar.js` | încă verzi |
