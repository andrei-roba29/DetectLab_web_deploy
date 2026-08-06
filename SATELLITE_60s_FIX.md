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
