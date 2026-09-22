# Sliderul de pe ecran pornește/oprește automat stratul aferent

Data: 2026-09-22 · Modul: `js/vertical-opacity-control.js` · Test:
`node test-vertical-slider-layer-auto-toggle.js`

## Ce s-a schimbat

Când un slider e adăugat pe ecran (oglinda verticală de deasupra hărții),
stratul aferent lui se **activează automat**. Când e apăsat butonul „×” care
șterge sliderul de pe ecran, stratul aferent se **dezactivează automat**.
Invariantul devine simplu: *slider pe ecran = strat aprins; slider șters =
strat stins*.

## Cum funcționează

- `LAYER_TOGGLE_MAP` (nou, `js/vertical-opacity-control.js`) leagă fiecare
  slider oglindit de comutatorul lui din panoul lateral (`uatOpacitySlider` →
  `uatToggle`, `battlesPeriodSlider` → `battlesToggle`, oglinzile de
  distanță/rază → comutatoarele `lidarScannerToggle` / `archeoPotToggle` /
  `archReportToggle` etc.).
- La apariția oglinzii (`selectSource`, după înregistrarea slotului) și la
  ștergerea ei (`clearSlot`), comutatorul primește exact secvența unui clic
  manual: `checked` + eveniment `change`. Rutează deci prin aceleași funcții
  `toggle…Layer(…)` din `js/map-app.js` — nu există o a doua cale de
  pornire/oprire a stratului.
- Deactivarea acoperă toate modalitățile prin care sliderul părăsește ecranul:
  butonul „×”, tasta **Escape**, înlocuirea oglinzii celei mai vechi la a
  treia selecție și perechea Satellite care își ia ambele sloturi.

## Cazuri speciale

- **Satellite** (`satOpacitySlider` + `satPeriodSlider`) e strat de bază,
  permanent aprins, fără comutator — oglinzile lui nu pornesc/opresc nimic
  (intenționat ne-hartuite în `LAYER_TOGGLE_MAP`).
- **Substraturile LIDAR** (`lidarHd…lidarMh917`) nu au comutatoare funcționale
  proprii în panou. Activarea lor merge prin `window.toggleLidarSub(key, true)`
  plus masterul `#lidarToggle` (pornit odată cu primul substrat adus pe
  ecran). La închiderea oglinzii se stinge doar substratul respectiv;
  masterul rămâne aprins pentru restul substraturilor vizibile.
- **Straturile de analiză** (LIDAR Scanner, Zone cu potențial arheologic,
  Raport arheologic) aveau deja legătura comutator → oglindă; acum și butonul
  „×” al oglinzii oprește comutatorul, deci și scanarea/pinii/raportul.

## Decizii de proiect

- Activarea are loc **o singură dată**, exact când sliderul e *adăugat* pe
  ecran (slot nou), nu la fiecare re-selectare / glisare a sliderului deja
  vizibil — o glisare de opacitate nu repornește un strat oprit manual din
  panou.
- Apelul de activare stă după `mirrorSlots.push(slot)`, ca evenimentul
  `change` al comutatorului (comutatoarele de distanță reintră în
  `selectSource`) să găsească oglinda deja înregistrată și să nu configureze
  un al doilea slot pentru aceeași sursă.
- Evenimentul `change` se declanșează doar la tranziție reală de stare
  (`toggle.checked !== on`), deci nu circulă evenimente redundante și nu se
  creează bucle cu legătura existentă comutator ↔ oglindă.

## Test

`node test-vertical-slider-layer-auto-toggle.js` — acoperă: activare la
adăugare, dezactivare la „×”, re-adăugare, Escape, substrat LIDAR (master +
`toggleLidarSub`), oglinda de distanță (comutator propriu), înlocuirea
oglinzii vechi la a treia selecție și perechea Satellite; static, verifică că
toate cele 35 de slidere de opacitate din panou sunt legate (sau intenționat
ne-hartuite, la Satellite) și că fiecare comutator există în `index.html`.
