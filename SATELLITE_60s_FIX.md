# Satellite Imagery 60's Layer — Fix Summary

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

### 4. Tile Cache (`/geoserver/gwc/service/wms`) vs. WMS Rendering Endpoint (`/geoserver/wms`)
The code used `"https://geoserve.cast.uark.edu/geoserver/gwc/service/wms"` for `L.tileLayer.wms` tile requests.
`/geoserver/gwc/service/wms` is a **GeoWebCache WMS-C tile cache**. It rejects arbitrary tile grid bounding boxes or resolutions with HTTP 400 (`Requested horizontal resolution ... exceeds 10% threshold`) or HTTP 500 when requesting Web Mercator tiles.

## Solution

### 1. Separate Discovery Endpoint from WMS Tile Rendering Endpoint
- **`SAT60_GWC_URL = "https://geoserve.cast.uark.edu/geoserver/gwc/service/wms"`**: Used exclusively for fetching `GetCapabilities` at page load because its XML capabilities document is lightweight (~2MB) and lists all Corona layers and bounding boxes.
- **`SAT60_WMS_URL = "https://geoserve.cast.uark.edu/geoserver/wms"`**: Used for `L.tileLayer.wms` tile requests. As standard GeoServer WMS, `/geoserver/wms` renders Web Mercator (`EPSG:3857` / `EPSG:900913`) transparent PNG map tiles for any zoom level and bounding box.

### 2. XML DOMParser Bounding-Box Filtering for Romania
Replaced naive regex layer extraction with an XML `DOMParser` parser in `discoverCoronaLayers(callback)`. For every `<Layer>` element in the `GetCapabilities` XML, the code reads `<LatLonBoundingBox>` (or `<BoundingBox SRS="EPSG:4326">`) and tests whether the layer's geographic footprint intersects Romania:
```javascript
var RO_MIN_X = 19.5, RO_MAX_X = 30.5;
var RO_MIN_Y = 43.5, RO_MAX_Y = 48.5;

if (maxx >= RO_MIN_X && minx <= RO_MAX_X && maxy >= RO_MIN_Y && miny <= RO_MAX_Y) {
    discovered.push(name);
}
```
This isolates the actual Corona frames covering Romania and ignores layers over other regions. Removed the arbitrary `if (layerNames.length > 300)` discard check.

### 54 Verified Romania Frame Fallback List
Replaced the broken fallback list with **54 verified Corona frame layer names** from CAST GeoServer whose bounding boxes cover Romanian territory:
- `"corona:1105-2235df064"`, `"corona:1105-2235df065"`, `"corona:1103-2167df101"`, `"corona:1103-2167df103"`, `"corona:1110-2289df053"`, and 49 more.
If `GetCapabilities` fails due to network or CORS issues, this curated list guarantees full Romania coverage.

### 3. Correct Zoom Bounds (`minZoom: 5`)
Updated `minZoom` on `L.tileLayer.wms` from `8` to `5`:
```javascript
minZoom: 5,               // fetch tiles starting from zoom 5 (Romania overview)
maxZoom: 18,
maxNativeZoom: 15
```
When a user toggles on "Satellite imagery 60's" at zoom level 6 or 7, Leaflet now immediately fetches and displays Corona satellite imagery tiles covering Romania.

### 4. Efficient WMS Layer Chunking
Discovered (or fallback) Romania frame names are batched into groups of 40 (`CHUNK_SIZE = 40`) comma-separated names per `L.tileLayer.wms` instance. This produces at most 2–4 WMS layer instances, keeping URL lengths well under safe server limits (~900 characters) while requiring only ~15–30 tile requests per viewport.

## Files Modified
- `/home/user/DetectLab_web_deploy/js/map-app.js`
  - Rebuilt `discoverCoronaLayers()` with DOMParser bounding-box filtering for Romania (`19.5°E–30.5°E, 43.5°N–48.5°N`).
  - Added `FALLBACK_ROMANIA_LAYERS` with 54 verified Corona frame names.
  - Split endpoints into `SAT60_GWC_URL` (capabilities) and `SAT60_WMS_URL` (rendering).
  - Changed `minZoom: 8` to `minZoom: 5` and updated `sampleUrl` debug coordinates to valid Romania tile `{x: 72, y: 45, z: 7}`.
- `/home/user/DetectLab_web_deploy/SATELLITE_60s_FIX.md`
  - Updated fix documentation and root-cause analysis.
