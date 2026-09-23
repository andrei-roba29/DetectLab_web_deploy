# Butonul ✕ care închide un slider de pe hartă e ușor de nimerit pe desktop

Data: 2026-09-23 · Module: `css/styles.css`, `index.html`, `sw.js` ·
Test: `node test-slider-close-hit-area.js`

---

## Simptom

În versiunea web desktop, închiderea unui slider afișat pe hartă (oglinda
verticală de opacitate / distanță / istoric — `.vertical-opacity-control`)
era foarte grea: butonul ✕ din colțul cardului era aproape imposibil de
nimerit cu mouse-ul. Avea doar **22×22 px**, era complet transparent în
repaus și glifa „×” stinsă (`rgba(184,216,240,0.68)`) plutea direct pe
sticla frostuită a cardului — utilizatorul nu vedea clar ținta și, când o
găsea, mouse-ul trebuia să cadă exact pe glifă.

## Cauză

- **Butonul era acoperit de slider (cauza principală):** fără `z-index`,
  `.vertical-opacity-slider-wrap` — element poziționat, venit mai târziu în
  DOM — era pictat **deasupra** jumătății de jos a butonului absolut poziționat
  și îi înghițea click-urile. Doar o fâșie subțire, de deasupra cardului, mai
  era de fapt accesibilă. Verificat cu sondă `elementFromPoint` în Chromium:
  centrul butonului și toți vecinii lui cădeau pe `slider-wrap`.
- **Țintă sub minimul WCAG 2.5.8 (24×24 px):** 22×22 px, fără zonă de
  toleranță în jur — un click picat la 3–4 px de glifă nu închidea nimic.
- **Fără affordance vizual:** `background: transparent`, fără chenar —
  butonul nu exista vizual decât prin glifa stinsă.

## Fix (`css/styles.css`)

Toate regulile vizează clasa `.vertical-opacity-close`, deci se aplică
**ambelor oglinzi** (`#verticalOpacityClose` și
`#verticalOpacityCloseSecondary`):

1. **Ordine de pictare corectată** — `z-index: 2` pe buton: ✕-ul stă acum
   deasupra `slider-wrap`-ului și primește toate click-urile de pe suprafața
   lui (zona slider-ului propriu-zis nu e atinsă — rămâne sub buton doar
   colțul de sus al cardului).
2. **Disc vizibil în repaus** — fundal `rgba(8,20,41,0.45)` + chenar subțire
   `rgba(184,216,240,0.22)`: ✕-ul devine o țintă lucrată din ochi, nu doar
   din ticșori.
3. **Halou invizibil de click** — `.vertical-opacity-close::before` cu
   `inset: -7px` mărește ținta efectivă de click/hover la **~40×40 px**,
   fără să schimbe nimic vizual. Haloul poate depăși marginea cardului:
   cardul nu are `overflow: hidden` (chipul `.vertical-opacity-caption`
   plutește deja în afara lui), deci zona exterioară primește click.
4. **Aprindere la hover pe tot cardul** —
   `.vertical-opacity-control:hover .vertical-opacity-close` luminează
   butonul imediat ce cursorul intră pe card, înainte să ajungă peste el.
5. **Hover / focus agrafat** — butonul crește la `scale(1.1)`, glifa trece
   pe alb, discul pe `rgba(184,216,240,0.24)`; la navigare din tastatură
   (`:focus-visible`) se adaugă și un inel de 2px.
6. **Siguranță față de slider:** haloul ajunge până la ~30 px de la marginea
   cardului, iar capătul de sus al șinei slider-ului (thumb-ul la 100%)
   începe la ~39 px — trasarea opacității la maximum **nu poate** declanșa
   din greșeală închiderea oglinzii.
7. `touch-action: manipulation` pe buton și dezactivarea tranziției/scalei
   sub `@media (prefers-reduced-motion: reduce)`.

Esc continuă să închidă oglinda activă (comportament existent, neatins).

## Cache

- `index.html` — `css/styles.css?v=20260923-close-hit-area`.
- `sw.js` — `CACHE_NAME` → `detectlab-v131-close-hit-area`, cu URL-ul nou al
  foii de stiluri adăugat în `PRECACHE_URLS`, ca PWA-ul instalat să primească
  noul buton.
