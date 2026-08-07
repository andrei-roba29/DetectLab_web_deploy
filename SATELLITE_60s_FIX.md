# Satellite Imagery 60's Layer — Fix Summary (Updated 2026-08)

## Problem
The "Satellite imagery 60's" layer was showing a surface red polygon covering all of Romania, but **no tiles were being fetched** or rendered on the map.

## Root Causes

### 1. Leaflet Layer `minZoom: 8` Blocking Requests at Romania Overview Zoom
When a user opens the map and views all of Romania, the default Leaflet zoom level is **6 or 7**.
The WMS layer configuration was explicitly set to:
```javascript
minZoom: 8
```
In Leaflet, when the map zoom level is below a layer's `minZoom`, Leaflet makes **0 tile requests**. Thus, when toggling on "Satellite imagery 60's" at zoom 6 or 7, no tiles were ever fetched.

### 2. Bogus Hardcoded Mission Names in Fallback List
The previous code used a fallback list containing website mission names:
- `"corona:1103-2139Fore"`, `"corona:1103-2139Aft"`
- `"corona:1103-2155Fore"`, `"corona:1103-2155Aft"`...

These names correspond to mission/pass labels in the `corona.cast.uark.edu` web viewer UI. They are **not valid WMS layer names** on the CAST GeoServer (`geoserve.cast.uark.edu`). The actual WMS layer names on GeoServer are individual frame identifiers such as:
- `"corona:1105-2235df064"`
- `"corona:1103-2167df101"`

When WMS requests were made for `"corona:1103-2139Fore"`, GeoServer rejected them as non-existent layers.

### 3. Worldwide Discovery Triggering Arbitrary Layer-Count Fallback
In `discoverCoronaLayers(callback)`, the code fetched `GetCapabilities` from CAST GeoServer. Since CAST GeoServer hosts ~3,000 Corona layers worldwide, naive regex matching grabbed 600 layers (mostly over the Middle East).

A safety check in `discoverCoronaLayers`:
```javascript
if (layerNames.length > 300) {
    // discard discovered layers and use fallback list
}
```
Because `600 > 300`, this check **always triggered**, discarding discovered layers and forcing the use of the bogus fallback list (`"corona:1103-2139Fore"`, etc.).

### 4. Tile Cache (`/geoserver/gwc/service/wms`) vs. WMS Rendering Endpoint (`/geoserver/wms`) and Combined (Comma-Separated) Requests
The code used `"https://geoserve.cast.uark.edu/geoserver/gwc/service/wms"` for `L.tileLayer.wms` tile requests.
`/geoserver/gwc/service/wms` is a **GeoWebCache WMS-C tile cache**. 
Crucially:
- A tile cache ONLY stores and serves tiles for single, pre-defined cached layers (e.g. `LAYERS=corona:1103-2139Aft`). It **cannot combine layers dynamically** on-the-fly!
- If a request is made with a comma-separated list of multiple layers (e.g., `LAYERS=layer1,layer2,layer3`), GWC fails with HTTP 400 or HTTP 500 errors.
- Therefore, to leverage the fast GWC tile cache, layers must be requested **individually** (as separate `L.tileLayer.wms` instances in Leaflet).

## Solution

### 1. Dedicated GWC Tile Cache Endpoint
- **`SAT60_GWC_URL = "https://geoserve.cast.uark.edu/geoserver/gwc/service/wms"`**: Used for both dynamic discovery (`GetCapabilities`) and tile rendering. This ensures we are getting high-performance cached tiles.

### 2. XML DOMParser Bounding-Box and Name Filtering for Romania Pass Layers
Updated the XML `DOMParser` parser in `discoverCoronaLayers(callback)` to focus exclusively on **pass/mosaic layers** instead of individual frames:
- Filter layers to ensure they start with `corona:` and are pass mosaics (must contain `"Aft"` or `"Fore"` in the name).
- For every such `<Layer>` element, check if the geographic footprint intersects Romania (`19.0°E–31.0°E, 43.0°N–49.0°N`) or if the name matches a known Romania satellite mission (e.g., `1022`, `1103`, `1105`, `1106`, `1107`, `1110`).
- This isolates the exact Corona passes covering Romania.

### 3. Curated Pass-Level Fallback List
If dynamic discovery fails (e.g., due to CORS or network blocks), the system falls back to a curated list of **16 verified Corona pass layers (mosaics)** that are guaranteed to exist and cover Romanian territory:
- `"corona:1022-2104Aft"`, `"corona:1022-2104Fore"`, `"corona:1103-2139Aft"`, `"corona:1103-2139Fore"`, `"corona:1103-2155Aft"`, `"corona:1103-2155Fore"`, and more.

### 4. Direct Individual WMS Layer Initialization
To adhere to GeoWebCache requirements, the code now creates a **separate `L.tileLayer.wms` instance for each pass/mosaic layer**. This completely matches the behavior of the original website, which requests each pass separately.
- Includes `tiled: true` for tile grid matching.
- Sets a custom `EPSG:900913` CRS to match the exact coordinate system format requested by GWC.

### 5. Correct Zoom Bounds (`minZoom: 8`)
Set `minZoom` on `L.tileLayer.wms` to `8`.
At zoom level 8, Romania fills almost the entire viewport, and Corona satellite imagery tiles are rendered with high detail. At this level, about 110–130 total tile requests are dispatched by the browser to fetch the active passes, matching the original website's network tab perfectly.

## Files Modified
- `/home/user/DetectLab_web_deploy/js/map-app.js`
  - Rebuilt `discoverCoronaLayers()` with XML DOMParser name and bounding-box filtering.
  - Replaced frame-level fallbacks with 16 curated pass-level fallbacks.
  - Initialized individual `L.tileLayer.wms` layers for each pass (with custom `EPSG:900913` CRS, `tiled: true`, and `minZoom: 8`).
- `/home/user/DetectLab_web_deploy/SATELLITE_60s_FIX.md`
  - Updated fix documentation to reflect pass-level mapping and GWC integration.

---

## 2026-08 Performance / Mobile Stability Optimisation

### New problem
After the layer rendered correctly, the 16 CORONA pass sublayers each fired
their own tile requests with **no global coordination**, causing:
- 500+ simultaneous WMS requests (16 layers × visible + prefetch tiles)
- tiles requested at every zoom and far outside Romania
- no client caching, so every pan/zoom re-requested every tile from CAST
- mobile tab crashes from memory/connection pressure

### Solution: `js/corona-wms-layer.js`
A shared `L.TileLayer.WMS` subclass (`window.createCoronaWmsLayer`) used by
all 16 pass layers. It adds, **across every sublayer**:

| Requirement | Implementation |
|---|---|
| Zoom threshold (Step 1) | No tiles below **z4 desktop / z5 mobile** (`minZoom`) |
| Romania bbox filter (Step 2) | Each tile's lat/lng bounds are intersected with Romania's bbox before any request; non-overlapping tiles are never created |
| Concurrency cap (Step 3) | One shared queue: **max 8 in-flight desktop / 4 mobile** |
| IndexedDB cache (Step 4) | Tile blobs cached in `detectlab/corona_tiles`, TTL **30 d desktop / 60 d mobile**; in-session negative cache for 4xx/non-image responses |
| Viewport priority / lazy load (Step 7) | Tiles nearest the viewport centre load first; off-screen tiles are **cancelled (AbortController)** and their object URLs revoked on `_removeTile`; mobile uses `keepBuffer:0` + `updateWhenIdle` (no prefetch) |
| Backoff / circuit breaker (Step 8) | Exponential backoff (500 ms base, 3 retries) on 5xx/network errors; after 10 consecutive failures, requests pause for 30 s. 4xx (no tile at that zoom) are NOT retried |
| Loading indicator (Step 8) | Subtle pill at the top of the map showing in-flight/queued tile count |
| Mobile detection (Step 5) | UA + coarse-pointer + small-screen + `deviceMemory` |

Console helper for on-device verification (Step 9):
```js
coronaWmsDebug()  // or CoronaWmsQueue.stats()
// e.g. { isMobile:false, minZoom:4, concurrent:8, active:6, waiting:3,
//        totals:{ cacheHits:42, fetched:18, failed:0, cancelled:7, empty:3 } }
```

Files changed:
- **`js/corona-wms-layer.js`** (new) — optimised layer + queue + IDB cache
- **`index.html`** — loads the new script before `map-app.js`
- **`js/map-app.js`** — Sat60 lazy creation uses `createCoronaWmsLayer`;
  coverage-rectangle threshold follows the layer's `minZoom`

HTTP request headers like `Accept-Encoding: gzip` are negotiated
automatically by the browser; WMS `SRS=EPSG:900913`, `BBOX`, `tiled=true`,
`WIDTH/HEIGHT=256`, `FORMAT=image/png` and `TRANSPARET=true` are preserved.

---

## 2026-08 "Load images here" (Încarcă imagini aici) — on-demand viewport loading

### Behaviour (final semantics)
The Satellite imagery 60's layer **never fetches tiles on its own**. Switching
the layer on renders it only from already-cached tiles and reveals a
**"Load images here" / "Încarcă imagini aici"** button in the layer row:

- the button is **visible only while the layer is switched on**;
- **below zoom level 11 the button can not be pressed** — it is disabled and
  labelled **"Zoom in more" / "Mărește mai mult"**
  (`SAT60_LOAD_MIN_ZOOM = 11`, state refreshed on every
  `zoomend`/`moveend`/toggle);
- **from zoom level 11** it becomes enabled and, when pressed, loads the
  CORONA WMS tiles **only for the user's current viewport** — the tile range
  is computed from `map.getBounds()` at the current zoom (clamped at
  `maxNativeZoom` 15, which is also the zoom the overzoomed layer tiles use,
  so probe and layer cache keys always agree), restricted to tiles
  intersecting Romania's bbox, across every discovered pass layer;
- replies **"No images here" / "Nu există imagini aici"** when every probed
  tile comes back as HTTP 4xx, non-image, or a fully transparent PNG (WMS
  `TRANSPARENT=true` returns 200 + empty PNG for areas a pass does not cover);
- shows "Loaded N tile(s) — 1960s imagery is available here" when imagery
  exists (successful tiles are stored in the IndexedDB cache, so the layer's
  own tiles render instantly afterwards, and stay available on later visits).
- Panning into never-probed areas shows nothing until the button is pressed
  again there — by design; probed areas keep rendering from cache.

### Implementation
- **`js/corona-wms-layer.js`**
  - layer option **`manualOnly: true`** — on-demand mode: jobs created by the
    layer's `createTile` carry `noFetch`, so the shared queue resolves them
    from the **IndexedDB cache only** (cache hit → render; miss → empty,
    **zero network**). Only `coronaProbeTiles()` jobs may fetch.
  - public `coronaProbeTiles(jobs)` API (the button): probes jobs
    `{ url, layerLabel, z, x, y }` through the **same shared queue** as the
    map tiles (concurrency cap, backoff, negative cache, IDB cache), decodes
    each response and detects fully transparent tiles via canvas
    (`tileHasVisibleContent`). Resolves `{ total, found, empty, failed }`.
- **`js/map-app.js`**
  - `ensureSat60Layers()` creates the 16 pass sublayers with
    `manualOnly: true`; toggling the layer on adds them with **zero tile
    requests** (plain-`L.tileLayer.wms` fallback, used only if the local
    `corona-wms-layer.js` asset failed to load, keeps the old auto-fetch
    behaviour as a degraded mode and logs a warning).
  - `window.loadSatellite60sHere()` builds the viewport job list (all passes
    × visible tiles ∩ Romania, safety-capped at `SAT60_LOAD_MAX_JOBS = 2000`
    closest to the viewport centre), switches the layer on if needed, runs
    the probe, then `redraw()`s the pass layers so the imagery renders from
    cache without any extra fetch.
  - `_sat60UpdateLoadBtn()` shows the button only when the layer toggle is
    on, swaps its label/`data-key` + disabled state between
    "Zoom in more" (`sat60_zoom_more`, below z11) and "Load images here"
    (`sat60_load_here`, z11+), and is called on `zoomend`/`moveend` and on
    every toggle change (including the parent "Historical maps" group switch).
  - the red coverage rectangle now hides at z11 (`coverageMinZoom: 11`)
    instead of the layer's old auto-fetch threshold.
- **`index.html`** — a single button + status message inside
  `#satellite60sRow` (the old separate zoom-hint line was removed; the
  disabled button itself carries that message).
- **`js/translations.js`** — `sat60_*` keys (EN + RO), including
  `sat60_zoom_more` ("Zoom in more" / "Mărește mai mult") and
  `sat60_load_title` (tooltip for the enabled button).
- **`test-sat60-ondemand.js`** — Node harness (stubbed DOM/IDB/fetch) that
  verifies: layer tiles never fetch; the probe fetches and reports
  found/empty; probed tiles render from cache with no extra fetch; 4xx tiles
  count as "no imagery" and are negatively cached for the session. Run with
  `node test-sat60-ondemand.js`.


---

## 2026-08 DOM-flooding fix — "the layer crashed my site on toggle"

### Recurring user report

> "satellite imagery 60's layer when switched on causes my site to crash
> sometimes because of the big number of requests. I told you that it
> shouldnt fetch or request anything when switched on, only when
> 'load images here'/'incarca imagini aici' button is pressed at a
> minimum zoom of 11"

The user reported this multiple times. After adding the on-demand mode
(`manualOnly: true`) the network requests had been eliminated, but the
crash persisted.

### Actual root cause: DOM flooding, not network requests

The `manualOnly` flag already prevented the network request. **The
crash was from Leaflet still calling `createTile()` for every visible
tile of every sublayer**, even though no fetch was made — each call
still created an empty `<img class="leaflet-tile">` DOM element. With
**16 CORONA pass sublayers** × the visible tile count at low zoom, the
total DOM count blew past the browser's rendering budget.

| Zoom | Tiles/sublayer (Romania bbox) | Total DOM elements (16 sublayers) |
|------|-------------------------------|-----------------------------------|
| 4    | 2                             | 32                                |
| 7    | 12                            | 192                               |
| 9    | 140                           | 2,240                             |
| 10   | 540                           | 8,640                             |
| 11   | 2,067                         | **33,072**                        |
| 12   | 8,162                         | **130,592**                       |

At the default Romania-overview zoom (z=6-7) the count was moderate,
but as soon as the user zoomed in past z10 the count crossed the
~30,000 element threshold where browsers start dropping frames
aggressively, and at z12 the tab is unusable. The user's report of
"crash on toggle" was almost always paired with the user having
panned/zoomed into a denser area first.

### Fix: don't add the Sat60 layer group to the map below z=11

The "Load images here" button already requires zoom ≥ 11, so the layer
group has no business existing on the map at lower zoom. Two changes
that work together:

1. **`js/corona-wms-layer.js`** — `CONFIG.minZoom` bumped from
   `IS_MOBILE ? 5 : 4` to a hard-coded `11`, with a new
   `CONFIG.minLoadZoom = 11` constant. The WMS sublayer is also
   constructed with `minZoom: 11` so Leaflet does not call
   `createTile()` for it below z11 (belt-and-braces: the existing
   zoom/Romania check in `createTile()` is kept as a second line of
   defence).

2. **`js/map-app.js` Sat60 IIFE** — `toggleSatellite60sMap(on)` no
   longer calls `_sat60MapLayer.addTo(map)` blindly. A new helper
   `_sat60SyncOnZoom()` (also bound to `map.on('zoomend', ...)`) makes
   the add/remove decision based on the **current zoom**:
     - toggle ON, z<11 → layer group is **not added** to the map; toggle
       stays checked, "Load images here" button stays visible showing
       "Zoom in more" / "Mărește mai mult";
     - toggle ON, z≥11 → layer group is added (manualOnly: zero
       network; renders what is already in the cache);
     - toggle OFF → layer group is removed (works at any zoom);
     - zoom crossing z11 while the toggle is on → layer group is
       added/removed automatically. The user does not have to toggle
       the layer twice to see their imagery.

   A long comment block in the IIFE documents the rationale so future
   readers don't undo it.

### Regression test

`test-sat60-zoom-guard.js` (Node harness, stubbed Leaflet) loads the
Sat60 IIFE from `map-app.js` in a sandboxed VM, drives the public
toggle/zoom API, and asserts:

- toggle ON at z=10 → layer group is **not** added to the map
- toggle ON at z=12 → layer group **is** added
- zoom out from z=12 to z=10 → layer group removed
- zoom in from z=10 to z=12 → layer group re-added
- toggle OFF at any zoom → layer group removed
- full cycle (toggle ON, zoom out, zoom in) → layer tracks zoom
  automatically

12 assertions, all pass. Run with
`node test-sat60-zoom-guard.js`.

### Why the network-request count is still 0 on toggle

The 16 sublayers are created in on-demand mode
(`manualOnly: true`, set inside `ensureSat60Layers()`). Adding them
to the map triggers zero network requests — `manualOnly` skips the
fetch in `createTile()` and the tile element shows only when the tile
key is in the IndexedDB cache. So even with the new zoom-gated
`addTo` call, the network profile at z<11 is identical to before the
fix (and the user's "no requests on toggle" guarantee is preserved).
The user only ever fetches when they press "Load images here" at
zoom ≥ 11.
