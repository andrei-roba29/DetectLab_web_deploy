# Satellite Imagery 60's — faithful replica of the Corona Atlas tile fetching

> **Update 2026-08-12 (b) — the layer showed nothing: wrong layer *names*.**
>
> The request format documented below was already correct; what was wrong was
> the *list of CORONA layers* being requested. It had been written from the
> naming pattern instead of the server's real catalogue, so most names did not
> exist. The reported request
>
> ```
> …/gwc/service/wms?…&LAYERS=corona%3A1107-1074Fore&…
>   → 400: Unknown layer corona:1107-1074Fore.
> ```
>
> Verified live against `geoserve.cast.uark.edu`:
>
> | Old entry | Reality on the server |
> |---|---|
> | `corona:1107-1074Fore` | **does not exist** → `400 Unknown layer` (the reported bug) |
> | `corona:1103-2155Fore`, `corona:1110-2289Aft`, `corona:1103-2139Aft`, `corona:1106-1042Aft`, `corona:1105-2235Aft` | **do not exist** |
> | `corona:1107-1074Aft` | exists, but images **Greece** (22.09 E, 38.76 N) |
> | `corona:1110-2289Fore` | exists, but images **Peru** (−75.67 E, −13.02 N) |
> | `corona:1105-2235Fore` | exists, but images the **Middle East** (31.74 E, 24.62 N) |
> | `corona:1103-2167df101` | exists, but images **China** (117.57 E, 35.73 N) |
>
> So every tile request over Romania either errored or fell outside the pass
> footprint — the layer could never draw anything. This is expected of the
> archive: CAST publishes the *"Corona Atlas of the Middle East"*, and its
> coverage of Romania is limited to a few passes.
>
> **Fix:** the list now contains only layers verified to (a) exist and (b)
> return real pixels over Romania (WMS `GetFeatureInfo`, non-zero `GRAY_INDEX`),
> each gated to its own footprint read from the layer's KML `LookAt`:
>
> | Layer | Verified evidence |
> |---|---|
> | `corona:1104-2155Fore` / `…Aft` | Transylvania — `GRAY_INDEX 255` at 22.90 E / 46.58 N |
> | `corona:1036-2139Fore` | Muntenia/Bucharest — `GRAY_INDEX 88` at 26.10 E / 44.43 N |
> | `corona:1103-1058Aft` / `…Fore` | Muntenia — `GRAY_INDEX 105/112` at ~25.4 E / 44.4 N |
> | `corona:1026-2088Aft` | Oltenia — `GRAY_INDEX 119` at ~23.8 E / 44.3 N |
> | `corona:1104-2155df004` / `df007` / `df011` | Transylvania frames (full detail) |
>
> Each layer now carries its **own** `bounds` (its real footprint clipped to
> Romania) instead of a blanket Romania box, so Leaflet never requests a tile
> the pass does not cover. A `tileerror` handler hides any tile the server
> still refuses and logs the layer name once, so a future upstream rename
> degrades quietly instead of leaving broken tiles.
>
> Regression test: `node test-sat60-layers.js`.
>
> **Note on scope:** large parts of Romania (e.g. Cluj — the location of the
> reported tile, plus Iași, Brașov, Constanța, Timișoara) have **no** imagery
> in the CAST archive at all. There the layer is correctly empty; that is a
> limit of the source, not a bug.

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

### Verified Romania layer list (corrected 2026-08-12)

Pass mosaics (6): `corona:1104-2155Fore`, `corona:1104-2155Aft`,
`corona:1036-2139Fore`, `corona:1103-1058Aft`, `corona:1103-1058Fore`,
`corona:1026-2088Aft`.

Frames (3): `corona:1104-2155df004`, `corona:1104-2155df007`,
`corona:1104-2155df011`.

Each entry is a `{ name, bounds }` descriptor. **Names are not derived from
the naming pattern** — that is what caused the bug — they were confirmed
against the live server (the layer resolves on GeoWebCache, and
`GetFeatureInfo` returns non-zero `GRAY_INDEX` inside Romania), and `bounds`
is the layer's own KML footprint clipped to Romania.

---

## 3. Files changed

- `js/corona-wms-layer.js` — rewritten: faithful tile layer + URL builder
  (no queue / IndexedDB / manual gating).
- `js/map-app.js` — Sat60 IIFE rewritten: per-layer tile layers, automatic
  fetching, zoom gating z8/z12; coverage-rectangle entry updated
  (`coverageMinZoom: 8`).
- `index.html` — script comments/versions updated
  (`?v=20260812-layers`); the old "Load images here" UI note removed.
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
node test-sat60-fetch.js    # request format is byte-identical to the original
node test-sat60-layers.js   # layer names exist on the server and cover Romania
```

`test-sat60-layers.js` pins the regression: it fails if any of the
non-existent names (including `corona:1107-1074Fore`) or any of the
wrong-continent layers reappear, if a configured layer is not on the verified
list, if a layer loses its footprint `bounds`, or if the `tileerror` handling
is removed.

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
