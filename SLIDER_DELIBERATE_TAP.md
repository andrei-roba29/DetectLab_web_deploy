# În PWA, sliderul unui strat se adaugă pe ecran doar la un tap concret pe strat

Data: 2026-09-23 · Module: `js/vertical-opacity-control.js`, `index.html`, `sw.js` ·
Test: `node test-slider-deliberate-tap.js`

---

## Simptom

În aplicația instalată (PWA), era foarte ușor să **adaugi din greșeală slidere
pe ecran** și, odată cu ele, să **pornesti straturile** lor. Utilizatorul nu
avea nicio intenție de selecție: derula lista de straturi, punea degetul pe un
slider ca să-i schimbe opacitatea sau doar atingea cardul din greșeală — și pe
hartă apărea oglinda verticală, iar comutatorul stratului se bifa singur.
De mai multe ori, oglinda se adăuga chiar și când degetul doar **aluneca peste**
un range în timpul derulării.

## Cauză

Trei căi **implicite** de selecție, toate gândite pentru mouse, unde un clic
este prin definiție deliberat:

1. `pointerdown` și `focus` pe orice `.transp-slider` din panou apelau direct
   `selectSource(source, false)` → oglindă pe hartă + comutatorul stratului
   pornit. Pe touch, `pointerdown` și `focus` se declanșează la **fiecare**
   atingere a unui range — inclusiv când degetul doar trece peste el în timpul
   derulării listei. Aici se pierdea prima oglindă, cea mai deranjantă.
2. Clic pe cardul stratului (orice zonă care nu e slider / buton) →
   `selectSource(source, true)`: oglindă + strat pornit + panoul se închide.
   Pe touch, un clic poate fi produs și de o atingere „de trecere”, la capătul
   unei derulări sau de un tap cu două degete.
3. Nu exista **niciun prag**: nicio verificare a deplasării degetului, a duratei
   apăsării, a derulării panoului sau a numărului de degete.

## Fix (`js/vertical-opacity-control.js`)

Regula devine: *oglinada se adaugă doar la un tap deliberat pe cardul
stratului*. Totul e izolat în blocul „TAP CONCRET PE STRAT”, aplicat în
`registerSource`, `registerDistanceSource` și `registerPairedSource`:

- **`sliderTouch(source, event)`** înlocuiește vechile apeluri directe din
  `pointerdown` / `focus` ale range-urilor (și din clic-ul pe range care face
  bule către card). În **modul strict** (aplicația instalată sau gest tactil)
  atingearea unui slider **nu mai selectează nimic**: doar
  `activateExistingMirror()` — readuce în față o oglindă aflată **deja** pe
  ecran (dock de acțiuni, bulă de valoare, highlight în panou), fără să creeze
  un al doilea slot și fără să atingă comutatorul stratului.
- **`deliberateTap(event)`** filtrează clic-ul de pe card. Un tap contează
  doar dacă gestul care l-a produs nu a fost o derulare:
  - deplasare ≤ `TAP_MOVE_TOLERANCE` (12 px) între `pointerdown` și `click`;
  - panoul nu s-a derulat între apăsare și ridicare (`scrollTop` ±2 px);
  - nu e un tap care doar **oprește** o derulare în curs (≤ `SCROLL_QUIET_MS`
    = 200 ms de la ultimul eveniment `scroll` al panoului);
  - apăsare scurtă pe touch (`TAP_MAX_DURATION` = 800 ms — o apăsare lungă
    e selecție de text / meniu contextual, nu selecție de strat);
  - un singur deget (al doilea `pointerdown` marchează gestul `extra`);
  - gestul nu a început pe un element interactiv (slider / comutator /
    buton) — un drag pe range nu devine selecție prin clic-ul care face bule
    către card;
  - un `pointercancel` anulează gestul.
- Gestul e urmărit pe **document**, în faza de **captură**
  (`pointerdown` / `pointerup` / `pointercancel`), ca un handler care oprește
  propagarea să nu poată ascunde apăsarea reală; un listener de `click` în faza
  de bule (adică **după** handler-ul cardului) închide gestul. Un temporizator
  `GESTURE_TTL` (2500 ms, mai lung decât pragul de apăsare lungă) curăță un
  gest rămas fără clic.
- **Click-urile sintetice** (tastatură, script, test, tehnologii asistive) nu
  au `pointerdown` înaintea lor — nu avem ce verifica, deci trec mai departe.
  `Enter` / `Space` pe card selectează în continuare stratul.
- **Desktop, în afara modului PWA:** comportamentul rămâne **neschimbat** —
  un clic pe card sau o atingere a unui slider din panou selectează stratul
  exact ca înainte. Modul strict se activează doar când `pointerType` e
  `touch` / `pen` sau când pagina poartă clasa `is-pwa` (pusă de `index.html`
  pe `<html>`, pe `<body>` sau forțată cu `?pwa=1`).

Neschimbate intenționat: comutatorul stratului din panou (un tap pe el e
deliberat — și e și calea prin care straturile de analiză își scot oglinda +
dock-ul), închiderea cu „×” / Escape, auto-pornirea stratului când oglinda
apare pe ecran (`SLIDER_AUTO_ACTIVATION.md`) și închiderea panoului la tapul pe
card. `window.DetectLabVerticalOpacity.select(id)` folosit programatic de
modulele de analiză nu trece prin filtrele de gest.

## Rulare în PWA

`index.html` — `js/vertical-opacity-control.js?v=20260923-deliberate-tap`;
`sw.js` — URL-ul nou adăugat în `PRECACHE_URLS`, `CACHE_NAME` →
`detectlab-v132-deliberate-tap`. Fără modificări de CSS sau de HTML în panou.

## Verificare

`node test-slider-deliberate-tap.js` — verificări statice pe cablaj, apoi
modulul real peste un DOM mock (același tipar ca
`test-two-layer-opacity-mirrors.js`), cu un DOM care propagă evenimentele ca
unul real (captură → target → bule) și cu `Date.now()` controlat:

1. glisarea unui deget peste un range din panou nu pune nicio oglindă pe hartă,
   nu selectează nimic și nu atinge comutatorul stratului;
2. nici un tap curat pe range nu adaugă oglinda;
3. un tap deliberat pe cardul stratului o adaugă, pornește stratul (exact un
   eveniment `change`) și închide panoul;
4. cu o oglindă pe ecran, o nouă atingere a range-ului doar o reactivează
   (fără slot nou, fără al doilea eveniment de pornire);
5. derulare pe card (peste prag), panou derulat între apăsare și clic, gest
   început pe range, tap care oprește o derulare, două degete, apăsare lungă —
   toate ignorate;
6. două tap-uri deliberate deschid ambele sloturi, iar „×” stinge stratul
   corespunzător;
7. pe touch, regula se aplică și în afara shell-ului PWA;
8. pe desktop (fără `is-pwa`, cu mouse) comportamentul vechi e neatins.

Falsificare pe logica veche (rulează testul peste modulul din `HEAD`, cu
secțiunea statică scoasă): `AssertionError: a touch drag over the panel range
must not put a mirror on the map` — exact simptomul raportat.

Toată suita: `64/65` test files trec (`test-premium-subscription.js` are nevoie
de `jsdom`, care nu e instalat în acest mediu — limitare preexistentă).
