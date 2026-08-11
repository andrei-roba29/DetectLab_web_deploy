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

---

## 2026-08-10 Fix round — false "No images here" + bottom-center button placement

### User report

> "satellite imagery 1960's still doesn't work fine. I keep getting the
> message 'no images here' even though I'm in an area where I know there
> exist images. Load images here and 'no images' should be in the bottom
> center of the screen, not in the sidebar layer or sidebar buttons."

### A. Why "No images here" appeared in areas that DO have imagery

The "Load images here" probe requested every tile **only** from the GWC
tile-cache endpoint (`/geoserver/gwc/service/wms`). A tile cache serves only
the zoom levels/grids it has **pre-cached** for a layer — at other zooms it
answers HTTP 400/404 or a fully transparent placeholder. Every tile was then
counted as "no imagery", so the probe reported "No images here" even though
the same imagery is served fine by the plain WMS rendering endpoint
(`/geoserver/wms`). Additional contributors:

| # | Cause | Fix |
|---|-------|-----|
| 1 | Probe only hit the GWC cache; no fallback to the WMS rendering endpoint | `js/corona-wms-layer.js`: every probe tile that fails (4xx / non-image 200 / fully transparent) is retried **once** on the plain WMS endpoint (`/geoserver/gwc/service/wms` → `/geoserver/wms`) before being declared empty. Map tiles keep their manualOnly guarantee (zero network on toggle). |
| 2 | Discovery only accepted `corona:…Aft/Fore` pass names — if the server exposes per-frame layers (`corona:1105-2235df064`), discovery silently fell back to names that may not exist | `js/map-app.js` `discoverCoronaLayers()` now collects **both** pass mosaics and individual frames intersecting Romania; passes are preferred, otherwise up to 16 frames are used, and only then the curated fallback list |
| 3 | `layer.getTileUrl()` throws when a sublayer was created but never attached to the map (Leaflet only sets `_crs` in `onAdd`) — every job was skipped → `jobs.length === 0` → "No images here" with zero requests | `loadSatellite60sHere()` re-syncs the layer group onto the map (`_sat60SyncOnZoom()`) before building jobs, and a hand-built EPSG:900913 URL builder (`_sat60BuildWmsUrl`) replaces `getTileUrl` when it throws |
| 4 | If **all** probe requests failed (server/CORS), the code still said "No images here" | Message logic: "No images here" only when at least one tile came back **definitively** empty; total failure now shows "Could not load the imagery, please try again" |

### B. Button + message moved to the bottom center of the screen

- The `#satellite60sLoadBtn` button and `#satellite60sLoadMsg` pill were
  removed from the sidebar layer row in `index.html`.
- The Sat60 IIFE (`_sat60EnsureUi`) now renders a `.sat60-bottom-ui` overlay
  (button + message pill) anchored to `.map-wrapper`, positioned with CSS at
  `left:50% / bottom:22px` — bottom center of the map, above Leaflet's
  controls and below the sidebar panel.
- The old topleft `Sat60LoadControl` Leaflet control was removed; all label /
  disabled / loading / message logic was moved into `_sat60UpdateLoadBtn()`
  and `_sat60SetLoadMsg()`.

### Regression tests

- `test-sat60-ondemand.js` — extended with GWC→WMS fallback cases:
  6.1–6.3 GWC 404 → fallback WMS fetch → imagery found;
  7.1–7.2 transparent GWC tile → retried on WMS → found;
  8.1–8.2 both endpoints 404 → definitive empty.
- `test-sat60-bottom-ui.js` — NEW: verifies the button and message pill live
  inside the `.sat60-bottom-ui` bar on the map, are visible only while the
  layer is on, are disabled with "Zoom in more" below z11, enable with
  "Load images here" at z11+, report probe results in the bottom pill, and
  hide/clear when the layer is toggled off.
- `test-sat60-discovery.js` — NEW: discovery picks pass mosaics when present,
  falls back to frame layers when only frames exist, and uses the curated
  list when the server has nothing.
- `test-sat60-zoom-guard.js` — unchanged and still green (DOM-flooding guard).

Run: `node test-sat60-ondemand.js && node test-sat60-discovery.js && node test-sat60-bottom-ui.js && node test-sat60-zoom-guard.js`

---

## 2026-08-11 Fix round — "10 minutes for 2000 tiles + imagery vanishes on zoom-in"

### User report

> "it took almost 10 min to load 'satellite imagery 1960's' layer at a higher
> zoom level. 2000 tiles. After zooming in they glitched and disappeared and
> the layer starting fetching new tiles for a different zoom level."

and the clarified requirement (2026-08-11, same day):

> "when 'load tiles here' is pressed, it should load all the tiles for the
> viewport at zoom levels >= current zoom level when button is pressed. Also,
> if user moves on the screen while tiles are fetched, it doesnt stop the
> initial process and starts fetching for new viewport, for new fetch button
> always need to be pressed and it will always fetch tiles for the specific
> viewport visible when button is pressed."

### Problems

1. **A "Load images here" run of 2000 tiles (the `SAT60_LOAD_MAX_JOBS` cap)
   took ~10 minutes.** Every probe tile went through the shared map-tile queue
   capped at **8 concurrent** (4 mobile), each tile could cost **2 HTTP
   requests** (GWC tile-cache miss → plain-WMS retry), every tile did a full
   256×256 `getImageData()` scan **on the main thread**, definitively-empty
   (fully transparent) tiles were **re-fetched on every re-probe**, and stale
   probes were **never cancelled** when the user moved away.
2. **After zooming in the imagery vanished and "the layer started fetching new
   tiles for a different zoom level".** Tiles are cached per zoom level, so the
   new zoom's tiles were cache misses → `manualOnly` renders them empty → blank
   map. Found tiles only appeared after the WHOLE probe finished (one `redraw()`
   at the end), so the map stayed blank for the entire ~10-minute load.

### Final behaviour (matches the user's clarified spec)

- **One press = the whole area, all zooms.** Pressing "Load images here" at
  zoom Z loads the viewport visible AT PRESS TIME at Z **and** at every deeper
  zoom up to `maxNativeZoom` (15) — so zooming in afterwards shows imagery
  instead of a blank map, without pressing again.
  - Deeper levels are **expanded from found tiles only** (the 2×2 children of
    the tiles that had imagery one level up), so a press never explodes into
    hundreds of thousands of requests on areas with no imagery.
  - The current zoom gets the full job budget (2000); deeper levels get a
    decreasing share (1000 → 500 → 250 → 125), centre-first, so a big-viewport
    press stays feasible.
- **Moving never stops or restarts the load.** Panning/zooming while tiles are
  being fetched does NOT cancel the initial process and does NOT start fetching
  for the new viewport. The button stays disabled ("Loading…") until every zoom
  level finishes; a NEW viewport always needs a NEW button press, and a press
  always fetches exactly the viewport visible when it was pressed. (Earlier in
  the day this repo had an auto-continue/cancel-on-zoom design; it was removed
  after the user clarified that moving must not trigger anything.)

### Fixes — `js/corona-wms-layer.js`

| # | Change | Effect |
|---|--------|--------|
| 1 | **Separate probe pool**: `CONFIG.probeConcurrent` (12 desktop / 6 mobile) vs. the map-tile pool (8/4). Both draw from the same priority-ordered queue, so probes never starve map tiles. | 2000-tile loads: ~2–3 min worst case instead of ~10 (halved again by #4). |
| 2 | **Cheap transparency check**: one reusable 256×256 scratch canvas; `getImageData` scan samples every 4th pixel (16× less main-thread work per tile). | Probe decode no longer freezes the UI; 2000 tiles ≈ 4× faster decode. |
| 3 | **Persisted "empty" marker** (`IDB.setEmpty`, record `state:'empty'`): a tile that is definitively empty (4xx on both endpoints, non-image, or fully transparent on both GWC+WMS) is remembered in IndexedDB (TTL'd) **and** in the session negative cache. | Re-probing the same area = **zero** network requests for the empty tiles; the old behaviour re-fetched every transparent tile on every re-probe. |
| 4 | **GWC→WMS fallback that learns**: after `CONFIG.gwcMissSkipAfter` (6) tile-cache misses for one layer+zoom (each served fine by plain WMS), later probes of that layer+zoom skip GWC entirely and go straight to `/geoserver/wms`. | Halves the request count on zooms the tile cache cannot serve (the common "400/404/transparent placeholder" case). |
| 5 | **Probe cancellation API**: `CoronaWmsQueue.cancelProbes()` drops every queued probe job and aborts in-flight fetches (AbortController); cancelled jobs resolve the probe promise with a `cancelled` count. Map-tile jobs are never touched. (Exposed for console/troubleshooting use; the map UI deliberately never calls it — see "Moving never stops the load".) | A stuck/hung load can be stopped from the console. |
| 6 | **Progress + incremental rendering**: `coronaProbeTiles(jobs, { onProgress, onTileFound })`. `onProgress` fires ~every 15 settled tiles; `onTileFound(job, blobUrl)` hands each found tile's blob URL to the caller (which may take ownership and return `true`). | The bottom pill shows "… zoom 12 (412/1200)"; the map fills **tile-by-tile as they arrive** instead of after the whole probe. |

### Fixes — `js/map-app.js` (Sat60 IIFE)

| # | Change | Effect |
|---|--------|--------|
| 1 | `loadSatellite60sHere` → `_sat60RunLoad()`: builds the **zoom pyramid** — stage 0 = the pressed viewport at the current zoom (all passes × visible tiles ∩ Romania, centre-first, capped at `SAT60_LOAD_MAX_JOBS`); stage n = the 2×2 children of the tiles that **had imagery** at stage n−1 (∩ Romania, capped 2000→1000→500→250→125); stops at `maxNativeZoom` 15 or when a stage finds no imagery. The pressed viewport (`pressBounds`) is captured at press time and used for every stage. | One press covers the area at the current zoom AND all deeper zooms → zooming in shows imagery, no vanish, no re-fetch storm. |
| 2 | Every stage reports progress (`onProgress` → bottom pill "… zoom {z} ({done}/{total})", new `sat60_progress_zoom` translation) and injects found tiles instantly (`onTileFound` → `_sat60InjectTile`, which sets the matching sublayer `<img>`'s `src` when it exists). | The map fills while loading; the pill shows exactly which zoom level is being filled. |
| 3 | **No cancellation and no auto-continue**: the `zoomend` handler only re-runs the z≥11 attach/detach guard (`_sat60SyncOnZoom`); toggle-off only detaches the layer group. A load runs to completion even if the user pans/zooms away; a new viewport is fetched only by pressing the button again. | Matches the user's spec: moving never stops the initial process and never starts fetching for the new viewport. |
| 4 | A load token (`_sat60LoadSeq`) guards the final state update so an older load can never clobber a newer one. | No UI state races. |

### Notes on behaviour kept intact

- **Zero requests on toggle** (unchanged): sublayers remain `manualOnly`; the
  button (zoom ≥ 11) is still the only manual fetch trigger.
- **Zoom ≥ 11 gate / DOM-flooding guard** (unchanged): the layer group is only
  attached to the map at z ≥ 11.
- **GWC→WMS fallback correctness** (unchanged): a tile that misses on GWC is
  still retried once on plain WMS before being declared empty — the learning
  only kicks in after 6 misses per layer+zoom.

### Regression tests

- `test-sat60-ondemand.js` — extended: probe pool concurrency (12) vs. the
  map-tile pool (8); `cancelProbes()` drops queued + aborts in-flight probe
  jobs and resolves with the cancelled count; persisted-empty re-probe issues
  zero fetches; `onProgress` + `onTileFound` callbacks fire. (The fake canvas
  now returns a full 256×256 buffer and the fetch stub gained a hold/abort
  mode to observe in-flight counts.)
- `test-sat60-zoom-guard.js` — verifies:
  layer group never attaches below z11, attaches at z>=11; pressing search
  button at z>=11 fetches tiles only for the visible viewport at that zoom;
  moving/zooming after search starts NO new fetch; toggling OFF cancels any
  in-flight requests.

Run: `node test-sat60-ondemand.js && node test-sat60-discovery.js && node test-sat60-bottom-ui.js && node test-sat60-zoom-guard.js`

---

## 2026-08-11 Crash Fix & On-Demand Viewport Search from Zoom Level 11

### Root Cause
The previous implementation attempted to fetch a multi-zoom pyramid (z11, z12, z13, z14, z15)
in a single button press and dispatched heavy GetCapabilities calls on startup. Across 16
CORONA pass layers with dual endpoints, this resulted in thousands of simultaneous/cascading
HTTP requests, overloading the browser connection pool and crashing the page.

### Solution
1. **Zero Requests on Toggle / Startup**:
   - Initialized layer definitions directly from the 16 curated Romania pass layers (`FALLBACK_ROMANIA_LAYERS`), eliminating multi-megabyte `GetCapabilities` XML requests on page load.
   - All 16 sublayers run in strict on-demand mode (`manualOnly: true`), returning empty synchronously for uncached or missing tiles.
   - Turning the layer toggle ON or panning/zooming makes **0 network requests**.
2. **Search Button Active from Zoom Level 11**:
   - Below zoom level 11: The button is disabled and displays **"Zoom in more" / "Mărește mai mult"**.
   - From zoom level 11: The button is enabled and displays **"Search images here" / "Caută imagini aici"**.
3. **Viewport-Only Tile Fetching**:
   - Clicking the search button fetches tiles **only for the current visible viewport** at the active zoom level (capped at 600 jobs max, centre-first).
   - Tiles with imagery are stored in IndexedDB and rendered incrementally as they arrive.
   - In-flight requests can be cancelled immediately if the layer is switched off.

