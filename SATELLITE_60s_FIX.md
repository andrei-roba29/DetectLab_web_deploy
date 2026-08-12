# Satellite Imagery 60's — faithful replica of the Corona Atlas tile fetching

**Status: 2026-08-12** — the layer now replicates the *exact* tile fetching /
request sending of the original website
[Corona Atlas](https://corona.cast.uark.edu/atlas) (CAST, University of
Arkansas). All previous on-demand machinery ("Load images here" button,
client-side request queue, IndexedDB tile cache, viewport probes, zoom-gated
manual loading) has been **removed**.

---

## 1. How the original website fetches tiles (inspected)

The atlas at `corona.cast.uark.edu/atlas` is an OpenLayers app that displays
declassified 1960s CORONA imagery served by the CAST GeoServer through
**GeoWebCache WMS-C**. The exact request pattern was verified from the
original site's own live traffic (captured by the Internet Archive on
2020-04-29 and 2019-10-28 — see "Evidence" below).

```
Endpoint : https://geoserve.cast.uark.edu/geoserver/gwc/service/wms
           (GeoWebCache WMS-C tile cache; the "corona" GeoServer workspace)

Request  : WMS 1.1.1 GetMap, ONE corona layer per request, tiled=true

Params   : SERVICE=WMS
           VERSION=1.1.1
           REQUEST=GetMap
           FORMAT=image%2Fpng
           TRANSPARENT=true
           LAYERS=corona:<pass-or-frame>     ← single layer, never a list
           tiled=true
           WIDTH=256
           HEIGHT=256
           SRS=EPSG%3A900913                 ← Web Mercator (900913), NOT 3857
           STYLES=
           BBOX=<minx>,<miny>,<maxx>,<maxy>  ← EPSG:900913 metres, aligned to
                                               the standard 256×256 XYZ grid
```

Key facts established from the captured traffic:

| Fact | Evidence |
|---|---|
| Endpoint is the GWC WMS-C service | every captured tile request goes to `/geoserver/gwc/service/wms` |
| One layer per request | `LAYERS=corona:1105-2235df021`, `LAYERS=corona:1101-2168Fore`, `LAYERS=corona:1104-2203da058`, … — never comma-separated |
| Two layer granularities | **pass mosaics** (`…Fore` / `…Aft`, e.g. `corona:1101-2168Fore`) requested at low/medium zoom, and **individual frames** (`…df###` for the Fore camera, `…da###` for the Aft camera, e.g. `corona:1105-2235df021`) requested when zoomed in |
| EPSG:900913, 256×256 | `SRS=EPSG:900913&WIDTH=256&HEIGHT=256`, BBOX deltas match the standard Web-Mercator tile grid (e.g. z15 tile width = `40075016.685578488 / 2^15 = 1222.99245256…` m) |
| Plain browser tile fetching | tiles are ordinary `<img>` GETs — no client queue, no client database, no manual "load" button |
| Zoom gating | the layer is only active when zoomed in (the atlas homepage: *"For efficiency this layer is only active at or below a certain zoom level, and is therefore not viewable when the Atlas is initially opened"*) |

### Evidence (Internet Archive captures)

Captured requests (CDX of `geoserve.cast.uark.edu`, status 200, image/png):

- `20200429001955 …/geoserver/gwc/service/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=corona%3A1105-2235df021&tiled=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A900913&STYLES=&BBOX=3580921.899662502%2C3481859.511022657%2C3582144.892114846%2C3483082.503475001` — frame layer, z15 tile `x=19312, y=13536`
- …the same tile for the neighbouring frame `corona:1105-2235df022` — both frames of the pass requested independently
- `20191028221221 …&LAYERS=corona%3A1101-2168Fore&…&BBOX=3913575.8467000015%2C3209132.194150001%2C3991847.3636500016%2C3287403.711100001` — pass mosaic at z8
- `20200429020238 …&LAYERS=corona%3A1104-2203da058&…` — Aft-camera frame
- `20200429020351 …&LAYERS=corona%3A1101-2168df053&…` — Fore-camera frame, z8/z9 tiles

The independent QGIS plugin *CAST-corona-clicker* (github.com/ishibaro)
confirms the same services: WMS GetFeatureInfo at
`https://geoserve.cast.uark.edu/geoserver/corona/wms`, GWC capabilities at
`…/geoserver/gwc/service/wms?REQUEST=GetCapabilities&tiled=true`, WMTS tiles
at `…/geoserver/gwc/service/wmts` (`tileMatrixSet=EPSG:4326`), and layer
naming `corona:<mission>-<pass><df|da><###>` / `corona:<mission>-<pass><Fore|Aft>`.

---

## 2. What DetectLab now does (identical behaviour)

`js/corona-wms-layer.js` (rewritten) exposes:

- `window.coronaWmsTileUrl(baseUrl, layerName, z, x, y)` — builds the exact
  request URL described above (pure function, used by the tests).
- `window.CoronaWmsLayer` — an `L.TileLayer.WMS` subclass whose
  `getTileUrl()` emits that exact URL. It keeps Leaflet's default tile
  lifecycle, so tiles are fetched by the browser as normal `<img>` GETs —
  the same "type of fetching" as the original.
- `window.createCoronaWmsLayer(url, options)` — factory used by `map-app.js`.

`js/map-app.js` (Sat60 block rewritten):

- One tile layer **per Corona layer** — each pass mosaic and each frame in
  the curated Romania list — so every request carries a single `LAYERS=`
  value (GeoWebCache cannot combine layers dynamically).
- Toggle on ⇒ layer group added to the map; toggle off ⇒ removed. No manual
  loading step.
- Zoom gating mirrors the original (its docs: only active when zoomed in):
  - pass mosaics (`corona:1022-2104Fore` …) render from **z8**;
  - individual frames (`corona:1104-2155df004` …) render from **z12**.
  Below those zooms Leaflet creates no tile element and sends no request
  (which also prevents the request/DOM flood that crashed the site with the
  previous approach).
- `maxNativeZoom: 15` — the server pyramids end at z15 (verified in the
  captures); above z15 the tiles are overzoomed, exactly like the original
  viewer does past its grid's top level.
- The premium red coverage rectangle now hides from z8 (when real pass tiles
  begin) instead of z11.

### Curated Romania layer list

Pass mosaics (16): `corona:1022-2104Aft|Fore`, `corona:1103-2139Aft|Fore`,
`corona:1103-2155Aft|Fore`, `corona:1103-2167Aft|Fore`,
`corona:1105-2235Aft|Fore`, `corona:1106-1042Aft|Fore`,
`corona:1107-1074Aft|Fore`, `corona:1110-2289Aft|Fore`.

Frames (3): `corona:1104-2155df004`, `corona:1105-2235df064`,
`corona:1103-2167df101`.

(These names follow the verified `corona:<mission>-<pass><df|da|Fore|Aft>`
pattern; the frame identifiers `df064`, `df101`, `df004` are known-good
layers on the CAST server.)

---

## 3. Files changed

- `js/corona-wms-layer.js` — rewritten: faithful tile layer + URL builder
  (no queue / IndexedDB / manual gating).
- `js/map-app.js` — Sat60 IIFE rewritten: per-layer tile layers, automatic
  fetching, zoom gating z8/z12; coverage-rectangle entry updated
  (`coverageMinZoom: 8`).
- `index.html` — script comments/versions updated
  (`?v=20260812-faithful`); the old "Load images here" UI note removed.
- `js/translations.js` — `sat60_*` UI strings removed (the on-demand button
  is gone); `layer_satellite60s` label kept.
- `css/styles.css` — `.sat60-bottom-ui` styles removed.
- `sw.js` — precache entries updated to the new version.
- `test-sat60-fetch.js` — new test; the four old on-demand tests
  (`test-sat60-bottom-ui.js`, `test-sat60-discovery.js`,
  `test-sat60-ondemand.js`, `test-sat60-zoom-guard.js`) were deleted with the
  removed behaviour.

## 4. Tests

```bash
node test-sat60-fetch.js
```

Verifies: the generated request URL is byte-identical (parameter names,
order, encoding) to the original's captured traffic, the BBOX is the standard
Web-Mercator tile grid in EPSG:900913 metres (same z15 tile x=19312/y=13536 as
the captured request, agreeing to sub-centimetre float noise), exactly one
layer per request, no manual gating / queue / database in the layer, and the
map-app wiring (z8/z12 zoom gates, `createCoronaWmsLayer` usage, removed
on-demand machinery).

## 5. Notes / caveats

- The captured BBOX of the original differs from the exact grid values by
  ~1.4 mm (float noise in the original client's computation). This is
  irrelevant for GeoWebCache: the WMS-C path resolves the tile index from the
  grid, so the request hits the same cached tiles. The URL is rounded to
  6 decimals of a metre (sub-micrometre) for tidiness.
- The original atlas allows downloading the raw GeoTIFF/NITF per frame; that
  is a download feature, not tile fetching, and is out of scope here.
- If `geoserve.cast.uark.edu` is ever unreachable, the layer simply shows
  nothing (like the original); the fallback inside `_sat60MakeLayer` keeps a
  plain `L.tileLayer.wms` in case `corona-wms-layer.js` fails to load.
