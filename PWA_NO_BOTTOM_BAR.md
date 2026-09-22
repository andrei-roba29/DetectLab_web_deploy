# Bara de jos a PWA-ului — ștearsă complet (v123)

**Cerere.** „Elimină complet bara de jos din aplicația PWA: tot ce se vede sub
butonul «AN» — butonul «AN», butonul de geolocație și orice alt element din
acea bară. Harta să se extindă până la marginea de jos. Nu șterge butoanele din
stânga (zoom, pointer, search etc.).”

**Rezultat.** În aplicația instalată (`display-mode: standalone`, și la
previzualizarea `?pwa=1`) josul ecranului nu mai conține **niciun** element:
nici bară, nici butonul contului, nici butonul de geolocație. Harta merge până
la marginea fizică de jos. Coloana de iconițe din stânga, busola cu blocaj de
rotație și comutatorul Detectare (stânga-jos), docul de acțiuni al straturilor
de analiză și eticheta „© Leafleet” sunt **neschimbate**.

---

## Ce era, de fapt, „bara de jos”

Nu mai exista o bară pe toată lățimea: aceea fusese scoasă în `b319558`. Ceea
ce se vedea jos era **`#pwa-br-stack`** — un container `position: fixed` în
dreapta-jos, `z-index: 2000`, afișat doar în PWA (`body.is-pwa #pwa-br-stack {
display: flex }`), care ținea:

| element | ce era | cum ajungea acolo |
| --- | --- | --- |
| `#btnLiveLocation` | butonul de **geolocație** 🎯 (locația live / urmărire GPS) | creat de `js/map-app.js` la ~200 ms după `initMap()` și mutat cu `stack.prepend(liveBtn)` |
| `#pwaUserTrigger` + `#pwaAvatar` | butonul **contului**: inițialele din e-mail — pentru un cont care începe cu „an…” textul este exact **„AN”** (codul face `email.substring(0, 2).toUpperCase()`) | markup în `index.html`, pus pe `display:flex` de `updatePwaUserStack()` la fiecare 500 ms |
| `#pwaUserDropdown` | meniul care se desfășoară **în sus** din butonul contului: Manage Account · Events · Friends · Language · Storage · Log Out | markup în `index.html` |
| `#pwaLoginTrigger` | pastila **„Log In”** (varianta delogată a aceluiași buton) | markup în `index.html` |

Două butoane de 38×38 suprapuse, la 28 px deasupra etichetei „© Leafleet”, pe o
fâșie de ~60–80 px în partea de jos a ecranului — exact descrierea din raport.

## Ce a fost șters

Trei straturi, pentru că oricare singur poate fi anulat:

**1. CSS (`index.html`, blocul `<style>` PWA)**

```css
#pwa-br-stack {
    display: none !important;      /* era display:none, redeschis de body.is-pwa */
    position: fixed;
    right: max(10px, env(safe-area-inset-right, 0px));
    bottom: calc(env(safe-area-inset-bottom, 0px) + 28px);
    z-index: 2000;
    ...
    visibility: hidden;
    pointer-events: none;
}
body.is-pwa #pwa-br-stack,
body.is-pwa #pwaUserItem,
body.is-pwa #pwaUserTrigger,
body.is-pwa #pwaLoginTrigger,
body.is-pwa #pwaUserDropdown,
body.is-pwa #btnLiveLocation,
body.is-pwa .btn-live-location {
    display: none !important;
}
```

`!important` nu este decorativ: `updatePwaUserStack()` scrie
`userTrigger.style.display = 'flex'` **inline**, din 500 în 500 ms, iar un
`display` inline bate orice regulă din stylesheet care nu are `!important`.
Fără el, bara revenea pe ecran la jumătate de secundă după ascundere. Regula
care aprindea bara (`body.is-pwa #pwa-br-stack { display: flex }`) a fost
**ștearsă**, nu doar suprascrisă.

Geometria veche (`right`, `bottom`, `z-index`, `gap`) este păstrată literal sub
`display:none`, ca să rămână publicată și restaurabilă — la fel ca restul
contractului de offset-uri din `PWA_BOTTOM_BAND.md`.

**2. DOM (`index.html`, scriptul de standalone)**

```js
if (isPWA) {
    document.body.classList.add('is-pwa');
    document.documentElement.classList.add('is-pwa');

    var pwaBottomBar = document.getElementById('pwa-br-stack');
    if (pwaBottomBar && pwaBottomBar.parentNode) {
        pwaBottomBar.parentNode.removeChild(pwaBottomBar);
    }
    ...
}
```

Nodul este **scos din document**, deci niciun stil inline, niciun
`classList.remove('open')` și nicio repornire a `updatePwaUserStack()` nu-l mai
poate aduce înapoi. Markup-ul rămâne în fișier pentru site (website-ul nu intră
niciodată în această ramură și, oricum, nu afișa stiva) și pentru că
`js/events.js` / `js/friends.js` / `js/tutorial.js` caută acele id-uri — toate
apelurile sunt deja protejate la `null`.

**3. JS (`js/map-app.js`)**

Butonul de geolocație nu mai este construit deloc în aplicația instalată:

```js
setTimeout(function () {
    if (isPwaMode) {
        // Nothing to insert: the bottom bar that hosted this button was
        // removed, and the left stack must not gain it either.
        return;
    }
    var zoomCtrl = document.querySelector('#detectlab-map .leaflet-top.leaflet-left');
    if (zoomCtrl) zoomCtrl.appendChild(btn);
    ...
}, 200);
```

`return`-ul este înainte de `appendChild`, deci butonul nu se mută nici în
coloana din stânga — cererea a fost „niciun buton jos”, nu „mută-l în stânga”.

**Urmare obligatorie:** `startTracking()` făcea
`document.getElementById('btnLiveLocation').classList.add('active')` fără nicio
verificare. Fără buton, acel `getElementById` întoarce `null` și arunca
`TypeError` **înaintea** apelului `navigator.geolocation.watchPosition` — adică
locatia live ar fi murit complet în PWA (comutatorul Detectare, înregistrarea
traseului și „Vezi alți detectoriști în zonă” pornesc toate locația prin
`window._startLiveLocation`). Acum starea vizuală a butonului este opțională:

```js
var liveBtn = document.getElementById('btnLiveLocation');
if (liveBtn) {
    liveBtn.classList.add('active');
    liveBtn.title = 'Stop tracking';
}
```

`stopTracking()` avea deja garda. Podul headless rămâne intact:
`window._startLiveLocation` / `_stopLiveLocation` / `_isLiveLocationActive` /
`_showLiveLocation` — locația live funcționează în continuare, doar fără
butonul ei.

## Conținutul principal ajunge la marginea de jos

Nicio schimbare nouă de geometrie: podeaua pusă pentru banda închisă
(`min-height: 100vh` / `var(--dl-vvh)` pe `#map-section`, `.container`,
`.map-frame`, `.map-wrapper`, `#detectlab-map`, stretch `top:0 → bottom:0`)
rămâne cea care duce harta până la marginea fizică a ecranului. Fără bară, nu
mai există nici `--pwa-bottom-controls-clearance` care să „compenseze” ceva:
variabila rămâne la 44 px, dar doar pentru panourile/toast-urile ancorate jos,
ca spațiu de home indicator.

## Ce NU a fost atins

| element | unde rămâne |
| --- | --- |
| zoom `+` / `−`, măsurare, coordonate, traseu, hărți offline, locații salvate, lupă „Detectoriști din zonă” | coloana de iconițe din **stânga** (`.leaflet-top.leaflet-left`), offsets neschimbate |
| busola, blocajul de rotație, comutatorul **Detectare** | coloana din stânga-**jos** (`#compassCol`), `margin: 0 0 10px 10px` |
| docul de acțiuni al straturilor de analiză (LIDAR / potențial / raport) | `.layer-action-dock`, centrat jos, `bottom: calc(20px + env(safe-area-inset-bottom, 0px))` |
| panoul de straturi, săgeata de transparență, căutarea pe hartă | neschimbate |
| eticheta „© Leafleet” | `bottom: 4px; right: 6px` — punctul de referință al raportului `PWA_BOTTOM_BAND.md` |
| site-ul (non-PWA) | butonul 🎯 rămâne în coloana din stânga; `#pwa-br-stack` era și înainte `display:none` acolo |

## Costul onest al ștergerii

Meniul contului din meniul de jos era, în aplicația instalată, **singura**
intrare către: Manage Account, Events, Friends, Language, Storage și Log Out
(navigația de sus este ascunsă în PWA). Funcțiile rămân toate în cod și merg pe
site; în aplicația instalată ele nu mai au un buton care să le deschidă.
Ștergerea a fost cerută explicit și completă („NICIUN buton jos”), așa că nu am
adăugat un înlocuitor. Dacă se dorește păstrarea accesului la cont, opțiunile
curate sunt: o intrare în panoul de straturi, un buton în coloana din stânga
(cea care trebuie să rămână), sau gestul existent din `js/pwa-debug.js`.

## Teste

| test | ce verifică |
| --- | --- |
| `node test-pwa-no-bottom-bar.js` | **testul nou**: bara ascunsă cu `!important` (container + fiecare buton), regula `display:flex` ștearsă, `removeChild()` în ramura `is-pwa`, `js/map-app.js` nu mai inserează 🎯 în PWA dar îl păstrează pe site, punțile de locație live expuse și `startTracking()` fără `getElementById(...).classList`, harta întinsă până jos, **stânga neatinsă** (iconițe, busolă, dock, „© Leafleet”), nicio referință rămasă la o bară veche, SW ≥ v123 + precache pe URL-urile exacte |
| `node test-pwa-bottom-bar-removal.js` | **funcțional, cu jsdom**: rulează scriptul real din `index.html` — la `?pwa=1` / `display-mode: standalone` bara iese din document și sync-ul de cont de la 500 ms nu o readuce, butonul 🎯 dispare de pretutindeni, stânga/busola/harta rămân, site-ul își păstrează markup-ul, iar `togglePwaUserDropdown` nu aruncă excepții fără bară (`npm i --no-save jsdom`; se omite dacă lipsește) |
| `node test-pwa-bottom-band.js` | podeaua `min-height:100vh`, meta tag-urile, contractul de offset-uri (acum cu bara ascunsă), sonda, bump-ul de cache |
| `node test-pwa-no-bottom-strip.js` | testul v109 pentru banda închisă, încă verde |
| `node test-pwa-layer-panel.js` | panoul de straturi lipit de marginea de jos; regula „ascunde în loc, nu teleporta” rămâne (bara e deja ștearsă) |
| `node test-tutorial.js` | ghidul „?” nu mai descrie butoane din bara ștearsă; slide-ul de cont țintește pastila din navigația site-ului |
| restul suitei | verde (`test-premium-subscription.js` eșuează și la HEAD doar pentru că `jsdom` nu e instalat în sandbox) |

## Rollout

`sw.js`: `CACHE_NAME = 'detectlab-v123-pwa-no-bottom-bar'` + intrare v123 în
changelog; `js/map-app.js` și `js/tutorial.js` primesc `?v=20260922-pwa-no-bottom-bar`
și sunt pre-cached pe exact acele URL-uri. Schimbarea ajunge pe telefon după
merge + deploy + reîmprospătarea service worker-ului (deschide aplicația de două
ori sau forțează reîncărcarea).
