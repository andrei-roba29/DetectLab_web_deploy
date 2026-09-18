# Hărți offline: 100 km² + straturi gratuite noi (Patrimoniu, hărți istorice eharta, Localități OSM)

Data: 2026-09-18 · Modul: `js/offline-maps.js` + `sw.js` · Test: `node test-offline-maps-panel.js`

## Ce s-a schimbat

### 1. Limita de download: 10 km² → 100 km²

- `MAX_AREA_M2 = 100 * 1000 * 1000` — poligonul poate acoperi acum o întreagă
  comună cu împrejurimi.
- `MAX_TILE_JOBS` 5 000 → 20 000, proporțional cu suprafața: un download
  satelit de 100 km² la zoom 18 singur are ~6 200 tile-uri, deci vechiul
  plafon ar fi refuzat ce permite noua limită. Estimarea din panou avertizează
  vizual când se depășește plafonul, iar cota browserului rămâne garda finală.
- Textele din panou (`maximum`, `tooLarge`), linia „Suprafață: X / 100 km²” și
  pasul de tutorial din `js/tutorial.js` au fost actualizate la 100 km².

### 2. Straturi gratuite noi în catalogul de download

Cinci surse noi, toate `category: 'free'` (fără `requiresPremium`):

| id | Strat | Tip | Sursă online ascunsă când harta offline e activă |
|---|---|---|---|
| `patrimoniu` | Patrimoniu (situri arheologice + monumente, CIMEC) | WMS 1.1.1, `layers=0,5,6`, `eism.geo-spatial.ro` | `_patrimoniuLayer` |
| `austrian` | Harta Austriacă 1910 (mozaic 1:200.000) | WMS `eharta:mozaic_austrian_200k`, `services.geo-spatial.org` | `_austrianMapLayer` |
| `firingplans` | Planuri de Tragere 1:20.000 | WMS `eharta:mozaic_planuri_tragere_20k` | `_firingPlansLayer` |
| `soviet` | Harta Sovietică 1970 (1:100.000) | WMS `eharta:mozaic_soviet100k` | `_sovietMapLayer` |
| `osm-places` | Localități OSM (nume localități) | GeoJSON (un singur document) | `_osmPlacesGroup` |

Patrimoniul folosește exact serviciul WMS pe care îl folosește deja harta
online ca fallback când API-ul de patrimoniu pică (`activatePatrimoniuWmsFallback`),
iar cele trei hărți istorice sunt aceleași straturi gratuite din grupul
„Hărți istorice” al panoului online. Straturile premium (APM 2.0, Bucovina,
Austro-Ungară, Moldova 1868/1771/WWII, Banat, Transilvania 1859, Galiția 1855)
rămân blocate fără abonament.

### 3. Cum funcționează cache-ul pentru noile tipuri de surse

**WMS** (`wmsTileUrl`): un tile XYZ devine o cerere `GetMap` cu `BBOX` =
extent-ul tile-ului în EPSG:3857 metri — același CRS folosit de straturile
`L.tileLayer.wms` online. URL-ul depinde doar de `(sursă, z, x, y, id hartă)`,
deci bucla de download și stratul activat (subclasa `L.TileLayer` din
`makeOfflineWmsLayer`) construiesc URL-uri identice byte cu byte și service
worker-ul găsește fiecare tile descărcat în `detectlab-offline-tiles-v1`.

**GeoJSON** (`kind: 'geojson'`): documentul OSM.geojson (același pe care îl
folosește stratul online „OSM Places”) se descarcă ca un singur „job” și se
pune în același cache. La activare, `makeOfflinePlacesLayer` citește blob-ul
din cache și reconstruiește etichetele cu nume — același aspect „doar
etichete” ca online (marker transparent + tooltip permanent cu clasa
`osm-places-tooltip`), doar pentru localitățile din poligonul descărcat,
cu un buget de 600 de etichete prioritizat după populație (orașele câștigă
în fața cătunelor). Stratul are panou propriu (`offlinePlacesPane`), ca
sliderul de opacitate să nu afecteze celelalte straturi.

**sw.js**: `isOfflineTileRequest()` tratează acum orice cerere purtând tag-ul
`__dl_offline_map=` ca lookup în cache-ul offline — necesar pentru GeoJSON și
redundant (dar robust) pentru WMS, acoperit deja de `request=getmap`.

## Ce rămâne neschimbat

- TTL de 10 zile, stocarea 100% locală (IndexedDB + Cache Storage), nimic în
  Supabase — ca înainte.
- Straturile XYZ existente (Satelit, APM, UAT, LIDAR, Iosefină) folosesc
  exact același pipeline.

## Test

```
node test-offline-maps-panel.js
```

Acoperă: limita de 100 km² (poligon de ~44 km² acceptat, unul de ~266 km²
refuzat atât în timpul desenării, cât și la „Finalizează”), textul „/ 100 km²”
din linia de suprafață, catalogul expus ca `window._offlineSources` (toate
cinci straturile noi gratuite, straturile premium rămân blocate), contractul
WMS (`wmsTileUrl`, `EPSG:3857`, `GetMap`, `sourceJobUrl`) și tag-ul
`__dl_offline_map=` din `sw.js`.
