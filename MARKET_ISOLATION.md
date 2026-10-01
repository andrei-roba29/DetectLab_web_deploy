# Izolarea piețelor: `detectlab.ro` rămâne neschimbat

Data remedierii: 1 octombrie 2026.

## Problema

Printr-un singur deployment Netlify servim două origini:

- `detectlab.ro` — piața România;
- `detectlab.eu` — piața europeană.

La lansarea variantei europene (septembrie 2026), o parte din schimbările
destinate pieței europene au ajuns să se aplice **amândurora** domenii, nu
doar `detectlab.eu`. Concret, pe `detectlab.ro` au apărut:

1. **Harta deblocată** — `maxBounds` și `enforceMapCanvasBounds` fuseseră
   eliminate global, deci harta de pe `.ro` putea fi deplasată oriunde în
   lume, nu doar pe aria APM din România.
2. **Meniul de limbi cu 25 de limbi europene** — pe `.ro` meniul arăta
   inițial doar EN/RO; după fuziune apăreau 23 de limbi suplimentare
   (DE, FR, IT, ES, PL, UK, HU, CS, SK, NL, BG, EL, PT, DA, SV, NO, FI,
   ET, LV, LT, HR, SR, SL) atât în bara desktop, cât și în meniul PWA.
3. **Hărțile istorice CENAGIS / IH PAN** — șase rânduri premium individuale
   (Mitteleuropa, Chrzanowski, Reymann, KDR 100k, KDR Großblatt, WIG 100k)
   plus grupul „Hărți Istorice Europene” cu alte 22 de hărți și planuri
   urbane, toate vizibile în panoul de straturi de pe `.ro`.

Cerința: **`detectlab.ro` rămâne exact ca înainte de varianta europeană;
doar `detectlab.eu` conține varianta europeană.**

## Principiul soluției

Fiecare element al interfeței care ține de varianta europeană este marcat în
HTML cu atributul `data-eu-only`. `js/site-config.js` (încărcat din `<head>`,
înainte de primul paint) scrie pe `<html>` atributul `data-market="ro"` sau
`"eu"`, după hostname:

```css
html[data-market='ro'] [data-eu-only] { display: none !important; }
html[data-market='eu'] [data-ro-only] { display: none !important; }
```

Regula CSS ascunde conținutul european pe `.ro` fără niciun flash; ca
siguranță suplimentară, `applyDomainContent()` din `site-config.js` setează
și `style.display` pe aceleași elemente.

## Ce s-a schimbat, fișier cu fișier

### `js/site-config.js`

- Expune `DetectLabSite.languages`: `['ro', 'en']` pe `.ro`, lista completă
  de 25 de limbi pe `.eu`.
- Scrie `document.documentElement.setAttribute('data-market', market)` cât
  mai devreme — înainte de primul paint.
- `applyDomainContent()` ascunde `[data-eu-only]` pe `.ro` și `[data-ro-only]`
  pe `.eu` (în plus față de CSS).

### `js/translations.js`

- `availableLanguages()` / `isLanguageAvailable()` — limba selectată sau
  memorată trebuie să existe în `DetectLabSite.languages`. Pe `.ro` doar `ro`
  și `en` sunt acceptate: o limbă europeană memorată (de ex. `de`) cât timp
  varianta europeană a apărut pe `.ro` este ignorată și se revine la
  română. Pe `.eu` toate cele 25 de limbi rămân valabile.
- `getDefaultLanguage()`, `getStoredLanguage()` și `setLang()` validează prin
  `isLanguageAvailable()`.

### `index.html`

- Cele 23 de opțiuni de limbă suplimentare (desktop + PWA) primesc
  `data-eu-only`; EN și RO rămân pe ambele piețe.
- Cele 7 rânduri de straturi europene primesc `data-eu-only`:
  `mitteleuropaRow`, `chrzanowskiRow`, `reymannRow`, `kdr100kRow`,
  `kdrGbRow`, `wig100kRow`, `histEuRow`.
- CSS-ul inline pentru meniul PWA: varianta lungă și scrollabilă
  (`max-height: 260px`) se aplică doar pe `html[data-market='eu']`.
- Re-versionare scripturi: `?v=20261001-market-isolation` pentru
  `site-config.js`, `translations.js`, `historical-eu-maps.js`.

### `css/styles.css`

- `.lang-menu` revine la forma compactă de dinaintea variantei europene
  (`min-width: 110px`, `overflow: hidden`); varianta lată și scrollabilă
  (`min-width: 130px`, `max-height: 340px`) există doar pe
  `html[data-market='eu']`.
- Regulile de izolare `data-eu-only` / `data-ro-only` (vezi mai sus).

### `js/map-app.js`

- **Blocarea hărții pe România, restaurată pe `.ro`:** `MAP_PAN_BOUNDS` +
  `maxBounds: EU_MARKET ? null : MAP_PAN_BOUNDS` +
  `maxBoundsViscosity: EU_MARKET ? 0 : 1.0`, iar `enforceMapCanvasBounds()`
  (minZoom dinamic + `panInsideBounds`) se atașează doar `if (!EU_MARKET)`.
  Pe `.eu` harta rămâne liberă, ca până acum.
- **Straturile CENAGIS, doar pe `.eu`:** întregul bloc care creează panes și
  straturi WMS CENAGIS (`var CENAGIS_WMS_URL` … cele 6 IIFE-uri) rulează
  doar când `_isEuropeMarket()` este adevărat. Pe `.ro` nu se creează niciun
  strat, pane sau funcție de toggle CENAGIS.
- **Acoperirile premium CENAGIS, doar pe `.eu`:** cele șase intrări
  (`mitteleuropa`, `chrzanowski`, `reymann`, `kdr100k`, `kdr_gb`, `wig100k`)
  se înregistrează în `premiumMapCoverageBounds` condiționat, după literalul
  de bază (care rămâne exact cel anterior).
- **Evidențierea rândurilor, doar pe `.eu`:** `premiumKeys` primește cele
  șase intrări CENAGIS prin `concat` condiționat; `layerDefs` pentru
  `histEu_all` și `groups.histEu` se înregistrează doar pe piața europeană.
- Celelalte porți existente (DARE `cc=RO`, limitele `satellite60s`, scara
  Imperiului Roman, `VEGFP_EU_TILE_BOUNDS`) erau deja corect condiționate de
  `_isEuropeMarket()` și nu s-au atins.

### `js/historical-eu-maps.js`

- Helper `_isEuMarket()` (identic ca logică cu `_isEuropeMarket` din
  map-app, dar independent de el). `init()` și `renderUi()` se opresc
  imediat pe piața românească: panoul `#histEuSubLayers` nu se populează
  niciodată pe `.ro` și nu se creează straturi WMS.

### `sw.js`

- Shell PWA **v149** (`detectlab-v149-market-isolation`) — obligatoriu ca
  instalările PWA existente (inclusiv cele de pe `.ro` care prinseseră
  varianta europeană în cache) să primească conținutul restaurat.
- Pre-cache-ul `js/historical-eu-maps.js` este filtrat după originea
  service worker-ului (`SW_EU_ORIGIN`): pe `.ro` scriptul european nu se
  mai descarcă deloc; pe `.eu` se precache-uiește ca până acum.
- URL-urile versionate din `PRECACHE_URLS` actualizate la
  `?v=20261001-market-isolation`.

## Ce NU s-a schimbat

- Infrastructura dual-domain în sine (Netlify, canonical/hreflang, origin
  Supabase, `FRONTEND_ORIGINS` backend, `resolveSiteOrigin` pentru
  checkout) — `.eu` funcționează în continuare exact ca până acum.
- Straturile premium românești (Iosefina, Bucovina, Austro-Ungară, Moldova,
  WWI/WWII, Banat, Transilvania 1859, Galiția 1855, CORONA 60s, Amprenta
  Vegetației cu limitele României) — identice pe `.ro`.
- Pe `.eu` nu s-a eliminat nimic: limbi, hărți CENAGIS, navigație liberă,
  limitele europene ale straturilor rămân toate.

## Teste

- `test-ro-market-isolation.mjs` (nou) — verifică complet restaurarea:
  limbile acceptate pe fiecare piață (execuție reală a `translations.js` în
  VM: pe `.ro` `setLang('de')` revine la `ro`, `setLang('en')` rămâne `en`;
  pe `.eu` `setLang('de')` rămâne `de`), marcajele `data-eu-only` (46 de
  opțiuni de limbă + 7 rânduri), regulile CSS, blocarea hărții,
  înregistrarea condiționată a straturilor CENAGIS, filtrarea pre-cache-ului
  și versiunea v149 a shell-ului.
- `test-eu-domain-setup.mjs` — actualizat: aserțiunile `doesNotMatch`
  pentru `maxBounds` au fost înlocuite cu aserțiuni care cer ca blocarea să
  existe pe `.ro` și să lipsească pe `.eu`; adăugate verificări pentru
  `languages`, `data-market` și gating-ul CENAGIS.
- `test-layer-visibility.js` — harness-ul simulează acum piața
  (`market: 'eu' | 'ro'`); testele existente rulează ca `.eu`, iar două
  teste noi verifică că rândurile CENAGIS nu se evidențiază niciodată pe
  `.ro` (nici măcar cu un viewport european), în timp ce rândurile românești
  își păstrează comportamentul.
- `test-historical-eu-maps.js` — verifică că panoul european se populează
  pe `detectlab.eu` și rămâne gol pe `detectlab.ro`.

## Limitări cunoscute

- Rândurile europene există în continuare în DOM-ul partajat (ascunse prin
  CSS pe `.ro`); este abordarea aleasă pentru a păstra un singur deployment
  Netlify pe ambele piețe.
- `js/historical-eu-maps.js` se descarcă pe `.eu` și este servit din cache
  doar pe `.eu`; pe `.ro` scriptul nu se mai pre-cache-uiește, dar ar putea
  fi descărcat o singură dată dacă un utilizator `.ro` deschide `.eu` în
  aceeași sesiune de browser (comportament normal de cross-site).
