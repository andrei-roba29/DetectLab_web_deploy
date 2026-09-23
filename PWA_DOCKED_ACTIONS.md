# PWA: iconițele stratului stau SUB slider, nu peste el (v137)

Data: 2026-09-23 · Fișiere: `css/styles.css`, `index.html`, `sw.js` ·
Test: `node test-pwa-docked-actions.js`

---

## Simptom

În **aplicația instalată (PWA)**, când un strat cu butoane proprii era adăugat
pe ecranul principal — **APM 2.0** (iconița „Ajutor de căutare”) sau **Harta
Iosefină Premium / Josephine Map +** (căutare clădiri dispărute / setări /
sugerează) — iconițele lui **se suprapuneau peste slider**, în loc să stea în
coloană, vertical, sub sliderul lor. Pe site (browser) coloana era corectă.

Măsurat în Chromium (412×915, layout standalone): cardul sliderului ocupa
y = 327–589, iar iconița APM ateriza la y = 518 (cu `bottom: 80px`), cele trei
iconițe Iosefină la y = 478 / 524 / 570 (cu `bottom: 120px`) — toate peste
card.

## Cauză

Două reguli, ambele `!important`, se bat pe aceleași butoane; câștigă
**specificitatea**, nu ordinea din fișier:

| Regula | Unde | Specificitate | `bottom` |
|---|---|---|---|
| `.vertical-opacity-actions #apm20SearchHelpBtn` (iconiță andocată) | `css/styles.css` | (1,1,0) | `auto !important` |
| `body.is-pwa #apm20SearchHelpBtn` (ridicarea PWA a variantei **flotante**, bottom-center, deasupra indicatorului de acasă) | `index.html`, `<style>` inline | **(1,1,1)** | `calc(36px + 44px) !important` |

La fel pentru `#iosBldSearchHelpBtn` / `#iosBldSettingsBtn` /
`#iosBldSuggestBtn` (`calc(76px + 44px)`). Regula andocată face butonul
`position: relative`, iar ridicarea PWA (scrisă pentru varianta flotantă,
`position: absolute`) îi pune un `bottom` de ~80 / ~120px. Pe un element
relativ, `bottom: 80px` înseamnă „mută-l în sus cu 80px” — exact peste sliderul
de care e andocat. Pe site clasa `is-pwa` lipsește, deci regula nu se aplică și
coloana e corectă; de aceea defectul apărea doar în PWA.

Aceeași cursă strivea și panoul **„Setări detecție”** (deschis din iconița
rotiță): `body.is-pwa #iosBldSettingsPanel { bottom: … !important }` din
`index.html` bătea `bottom: auto` (fără `!important`) al ancorei andocate, așa
că panoul primea `top` **și** `bottom` simultan și era întins forțat între ele —
o cutie de ~290px pentru ~380px de conținut, câmpurile de jos ieșind din panou.

## Fix (`css/styles.css`)

1. **Iconițele** — imediat după blocul andocat, o regulă cu aceeași clasă de
   pe `body` în selector, deci (1,2,1) > (1,1,1):

   ```css
   body.is-pwa .vertical-opacity-actions #apm20SearchHelpBtn,
   body.is-pwa .vertical-opacity-actions #iosBldSearchHelpBtn,
   body.is-pwa .vertical-opacity-actions #iosBldSettingsBtn,
   body.is-pwa .vertical-opacity-actions #iosBldSuggestBtn {
       position: relative !important;
       bottom: auto !important;
       left: auto !important;
       transform: none !important;
   }
   ```

   Se leagă de **clasa** containerului, deci acoperă ambele oglinzi
   (`#verticalOpacityActions` și `#verticalOpacityActionsSecondary` — vezi
   `SLIDER_ACTIONS_BOTH_MIRRORS.md`). Sunt re-afirmate toate cele patru
   proprietăți de geometrie flotantă, ca o viitoare ridicare PWA pe `left` /
   `transform` să nu redeschidă același defect. Pe site regula nu se
   potrivește cu nimic.

2. **Panoul „Setări detecție”** — `body.is-pwa.vo-josephine-docked
   #iosBldSettingsPanel` are acum `bottom: auto !important`; panoul rămâne
   ancorat doar pe `top: 50%` (+ `translateY(-50%)`), cu înălțime automată,
   centrat vertical pe sliderul care l-a deschis.

3. **Lățimea panoului lângă oglinda secundară (sub 600px)** — ancora secundară e
   cu un pas de oglindă (46 + 10px) mai la stânga decât cea primară, dar
   lățimea rămăsese `min(280px, calc(100vw - 140px))`: la 412px lățime
   panoul de 272px pornea cu 6px în afara ecranului, sub coloana de butoane
   din stânga hărții. Acum `min(280px, calc(100vw - 196px))`, deci aceeași
   margine stângă de 50px ca la ancora primară.

Nu se schimbă nimic în `index.html` în afară de versiunea CSS: ridicările PWA
rămân valabile pentru variantele flotante ale butoanelor (când stratul e
pornit din panou fără oglindă pe ecran).

## Rulare în PWA

`css/styles.css?v=20260923-pwa-docked-actions` în `index.html`, URL-ul adăugat
în `PRECACHE_URLS`, iar `CACHE_NAME` urcat la `detectlab-v137-pwa-docked-actions`
(aplicația instalată servește shell-ul din acest cache; reîncărcarea automată la
`controllerchange` din `PWA_SHELL_REFRESH.md` face restul).

## Verificare

`node test-pwa-docked-actions.js`:

1. **Cascada reală, fără dependențe** — testul parsează **ambele** foi de stil
   (`css/styles.css` + blocurile `<style>` inline din `index.html`), calculează
   specificitatea, `!important` și ordinea sursei și rezolvă `position` /
   `bottom` / `left` / `transform` pentru fiecare dintre cele 4 butoane
   andocate, în PWA și pe site, în ambele oglinzi, pe 4 profiluri de viewport
   (256 verificări). jsdom nu poate face asta — `getComputedStyle` al lui aplică
   regulile în ordinea sursei și ignoră specificitatea, motiv pentru care
   verificarea de cascadă din `test-vertical-opacity-actions-both-slots.js`
   (doar `css/styles.css`, fără regula din `index.html`) nu a prins defectul.
   Tot aici: panoul de setări rezolvă `bottom: auto` + `top ~50%` în PWA,
   lățimea ancorei secundare sub 600px, versiunea CSS din `index.html` e
   pre-cache-uită în `sw.js`, `CACHE_NAME ≥ v137`.
2. **Chromium real (opțional)** — cu `puppeteer-core` disponibil (aceeași
   descoperire ca `test-patrimoniu-zoom-animation-browser.js`:
   `PUPPETEER_MODULE_DIR`, `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_LIB_PATH`),
   încarcă `index.html?pwa=1` la 412×915, adaugă APM 2.0 și apoi Iosefină pe
   ecran și măsoară cutiile: fiecare iconiță stă sub elementul precedent,
   centrată pe card, prima la ≤ 24px sub card; panoul de setări are înălțimea
   conținutului, e centrat pe slider, complet pe ecran și la ≥ 48px de
   marginea stângă. Fără browser secțiunea e sărită.

Fără fix, testul eșuează exact pe cauză:

- static: `#iosBldSearchHelpBtn docked under the slider (PWA, primary mirror,
  portrait phone 412×915) must have bottom: auto — the cascade resolves to
  "calc(76px + var(--pwa-bottom-controls-clearance, 44px))" from
  `body.is-pwa #iosBldSearchHelpBtn, …``;
- browser: `APM 2.0: #apm20SearchHelpBtn must sit BELOW the previous element
  (top 517.5 < 588.5) — computed bottom 80px; it overlaps the slider card`.

Verificat vizual în Chromium headless (412×915, 360×640, 915×412, 1280×800,
`?pwa=1`): iconițele stau în coloană sub card în ambele oglinzi, la aceeași
distanță ca pe site (card → prima iconiță 9px, apoi 38px + 8px).

## Limitare cunoscută (pre-existentă)

În **landscape** pe telefon (înălțime ≤ 500px) cardul are 222px și e centrat
vertical, iar coloana celor trei iconițe Iosefină (3 × 34px + spații) ajunge la
~122px sub el: la 412px înălțime ultima iconiță (creion) iese cu ~26px sub
marginea de jos. Nu e cauzată de acest fix (înainte iconițele erau oricum peste
slider); dacă e nevoie, cardul poate fi ridicat cu ~40px doar când are acțiuni
și doar în blocul `max-height: 500px`.
