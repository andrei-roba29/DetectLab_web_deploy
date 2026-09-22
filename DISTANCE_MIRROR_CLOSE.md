# Închiderea unei oglinzi de distanță nu mai stinge și sliderul alăturat

Data: 2026-09-22 · Module: `js/vertical-opacity-control.js`, `js/lidar-scanner.js`,
`js/archeo-potential.js`, `js/archeo-report.js` ·
Test: `node test-distance-mirror-close-isolation.js`

---

## Simptom

Sliderele straturilor de analiză — **LIDAR Scanner**, **Raport arheologic**,
**Zone cu potențial arheologic** — adăugate pe ecran ca **al doilea slider**
(oglindă verticală lângă alt slider) și ulterior închise (butonul „×” al
oglinzii sau comutatorul stratului din panou) închideau/dezactivau **ambele**
slidere: celălalt slider dispărea de pe hartă, iar stratul lui se stingea
(comutatorul lui din panou era debifat), deși trebuia dezactivat doar stratul
aferent sliderului închis.

## Cauză

Controalele verticale ofereau un singur API de închidere:
`DetectLabVerticalOpacity.close()` = **închiderea tuturor** oglinzilor de pe
ecran (semantică corectă pentru tasta Escape). Modulele de analiză o apelau în
`notifyDistanceMirror(false)` la oprirea stratului lor.

Lanțul care declanșa paguba, la închiderea cu „×”:

1. `hideControl(slot)` scoate slotul din `mirrorSlots`, apoi `clearSlot`
   oprește stratul: comutatorul lui primește `checked = false` + eveniment
   `change` (`setLayerActiveForSource`);
2. modulul stratului (LIDAR / Raport) ascultă acel `change` și rulează
   `setActive(false)` → `notifyDistanceMirror(false)`;
3. în acel moment oglinda lui părea ÎNCĂ „activă” (`activeSource` încă
   pointa spre slotul în demolare — resetat abia după `clearSlot`), deci
   modulul credea că a lui e oglinda de pe ecran și apela `close()`;
4. `closeAllControls()` demola și **cea de-a doua oglindă**, al cărei
   `clearSlot` debifa comutatorul stratului vecin → ambele straturi stinse.

## Fix

- **`js/vertical-opacity-control.js`**
  - API nou: `closeFor(sliderId)` — închide DOAR oglinda sliderului dat
    (prin `hideControl(slot)`, deci cu toată igiena existentă: redarea slotului
    activ următorului, ancora `mirror-sole`, dock-ul de acțiune, marcajele din
    panou, oprirea stratului aferent). No-op dacă oglinda nu e pe ecran;
    pe id-urile perechii Satellite închide întreaga pereche, ca butonul „×”.
  - `isActiveFor(sliderId)` nu mai raportează slotul **în curs de demolare**:
    pe lângă „activ + vizibil” cere acum ca slotul să fie încă înregistrat în
    `mirrorSlots`. Astfel chiar și un apelant vechi, care verifică
    `isActiveFor(...)` înainte de `close()`, nu mai poate uzapa celelalte
    oglinzi din timpul propriei închideri.
- **`js/lidar-scanner.js`, `js/archeo-report.js`** —
  `notifyDistanceMirror(false)` apelează `closeFor(<id-ul propriu>)` în loc de
  `close()`; rămâne fallback pe vechiul comportament dacă shell-ul
  vertical-opacity e mai vechi și nu are `closeFor`.
- **`js/archeo-potential.js`** — primește același `notifyDistanceMirror`
  (îi lipsea complet): `toggleArcheoPotentialLayer(on)` îl apelează la final,
  deci oglinda sliderului de rază urmează acum și oprirea/pornirea
  PROGRAMATICĂ a stratului (dezactivarea la expirarea abonamentului nu mai
  lasă sliderul orfan pe ecran), tot exclusiv prin `closeFor` la oprire.

## Rulare în PWA

`?v=20260922-distance-mirror-close` pentru cele patru module în `index.html`,
URL-urile adăugate în `PRECACHE_URLS`, iar `CACHE_NAME` urcat la
`detectlab-v129-distance-mirror-close` (aplicația instalată servește shell-ul
din acest cache).

## Verificare

`node test-distance-mirror-close-isolation.js` încarcă modulele REALE
(`vertical-opacity-control.js`, `archeo-potential.js`, `lidar-scanner.js`,
`archeo-report.js`) peste un DOM mock și acoperă:

1. **„×” pe oglinda adăugată a doua** (LIDAR / Raport / Potențial): dispare
   doar ea, comutatorul doar al ei e debifat, prima oglindă rămâne cu stratul
   pornit și preia ancora din dreapta (`mirror-sole`) + focusul;
2. **Două oglinzi de distanță** împreună (potențial + LIDAR): închiderea uneia
   îl păstrează pe celălalt, strat inclus;
3. **Comutatorul din panou oprit** cât oglinda e a doua: aceeași izolare;
4. **Oprire programatică** fără eveniment `change`
   (`toggleLidarScannerLayer(false)` / `toggleArcheoPotentialLayer(false)` /
   `toggleArcheoReportLayer(false)`): închide doar oglinda proprie și aduce
   comutatorul pe OFF;
5. `api.close()` (semantica documentată a tastei Escape) **încă** închide
   toate oglinzile;
6. `closeFor(id)` pe o oglindă absentă e no-op.

Fără fix, testul eșuează exact pe simptom: `the first mirror must stay open`,
cu comutatorul primului strat debifat.
