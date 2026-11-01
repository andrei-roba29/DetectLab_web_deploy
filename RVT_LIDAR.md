# LiDAR image effects and raw-DTM terrain filters — architecture and data audit

## Image-only workaround (current WMS deployment)

Every LiDAR sublayer has a Settings button. The panel defaults to **17 explicitly labelled photographic simulations** (even where a DTM has separately been registered), not RVT algorithms or measurements: directional lighting, image gradients, local contrast, and pseudo-colour channel mixes applied to the fetched WMS/WMTS/XYZ imagery. They are *not* suitable for deriving terrain heights or archaeological evidence. The six image sliders are exposure, highlights, shadows, contrast, brightness, and sharpness, plus opacity. Original imagery outside the selected **1 km radius** remains visible and unchanged. The six Looking for chips intentionally do not pretend to have scientifically verified ratings. A true ground profile and metre-based RVT measure/stretch controls stay unavailable on imagery-only layers. A registered numeric DTM adds an optional “Use numeric DTM instead” switch for the supported true-RVT methods.

The user must switch on the sublayer, press **Choose and prefetch a 1 km area**, and click its centre on the map. `js/lidar-photo-filter.js` fetches at most 96 image tiles on desktop or 48 on narrow screens, planning the deepest level the provider publishes first and stepping down only as far as that budget requires (so the disc is prepared at the layer's real detail, not at the zoom the pick was made from), through the same map3d mirror tile URL builder/CORS-aware proxy fetch path used by 3D, or its canvas-tile renderer. It rejects incomplete tile sets instead of silently showing partial results. It retains original decoded RGBA pixels in memory: switching among the 17 photo looks and dragging image sliders re-renders cached pixels, without WMS requests. A masked photo overlay replaces original layer pixels only inside the circle; clearing the effect restores the original tiles. On entering 3D, the existing 3D entry gate asks whether to seed its normal LiDAR disc dialog with this area or choose another. **3D fetches its own terrain/tiles; the 2D image-effect cache is not reused as 3D terrain.** On a static deployment, the 3D tile proxy must be available for CORS-restricted WMS hosts; inaccessible tiles produce an error and the effect is not applied.



## Step 0 — what is actually in this checkout?

**No elevation GeoTIFF/COG/DEM/float tile pyramid is committed or configured.** The existing Leaflet LiDAR layers are rendered XYZ/WMTS/WMS PNG or ArcGIS `exportImage` tiles. A pointwise elevation identify service does **not** make the displayed tile an elevation raster. None can currently be processed as a bare-earth DTM. The **true RVT** filters are opt-in and disabled unless an administrator registers a real local DTM; the new image-only looks work on fetched pixels. Existing layers remain unchanged outside the prepared circle, or when no effect has been selected. The source examples are **not** real data or active configurations.

| Existing layer | Actual website input | Required for RVT |
|---|---|---|
| Romania HD/AR/AB/BH/CS, Ro 1 m / 2–5 m, LAKI III CS/DJ/GJ/MH, and the derivative row | ArcGIS MapServer rendered tiles (`js/map-app.js`, `LIDAR_SUB_LAYERS`) | Obtain licensed bare-earth MDH/DTM GeoTIFFs per county/coverage; verify datum, permissions and ground sampling; **blocked**. |
| Albania ASIG LiDAR sublayers | WMS imagery mounted dynamically in `#albaniaLidarLayers` (`js/asig-albania-layers.js`) | Obtain bare-earth ASIG numeric elevation rasters for the relevant coverage and validate permissions; **blocked**. |
| Netherlands AHN4/5/6 | ArcGIS AHN DTM 0.5 m ImageServer *rendered* with raster function (`js/ahn-layer.js`); identify returns individual raw heights | Acquire AHN4 DTM 0.5 m open GeoTIFF/COG (EPSG:28992, NAP); AHN5/6 require separate coverage manifests; **blocked until acquired**. |
| Norway Kartverket | `NHM_DTM_25833` `exportImage` hillshade and `identify` (`js/hoydedata-layer.js`) | Obtain Kartverket NHM bare-earth DTM raster in EPSG:25833 with reuse rights; not DSM or the already-rendered local relief; **blocked**. |
| Poland GUGiK | NMT shaded WMS (`js/geoportal-nmt-layer.js`) | Obtain ISOK/NMT numeric 1 m DTM GeoTIFF, CRS EPSG:2180; confirm applicable licence; **blocked**. |
| Spain IGN | Mapa LiDAR WMS `EL.GridCoverage` rendered image (`js/ign-mdt-layer.js`) | Obtain IGN PNOA-LiDAR bare-earth MDT GeoTIFF in its local metre CRS; **blocked**. |
| Switzerland swisstopo | swissALTI3D relief WMTS / WMS rendered image (`js/swisstopo-relief-layer.js`) | Obtain licensed swissALTI3D numeric DTM GeoTIFF (CH1903+/LV95, EPSG:2056); **blocked**. |
| England EA | Composite DTM 1 m WMTS PNG layers including colour elevation (`js/ea-lidar-wmts-layer.js`) | Download EA LiDAR Composite **DTM 1 m** numeric GeoTIFF in EPSG:27700; an elevation-coloured PNG is *not* height data; **blocked**. |
| France IGN | LiDAR HD rendered terrain overlay via `DL.url2d('lidar.fr-mnh')` (`js/map-app.js`, registry) | Acquire IGN LiDAR HD MNT bare-earth numeric COG/TIFF with suitable rights and metre CRS; **blocked**. |
| Denmark Dataforsyningen | DHM `skyggekort` hillshade WMTS (`js/dataforsyningen-dhm-layer.js`) | Obtain DHM/Terræn bare-earth numeric raster in EPSG:25832; token used for imagery is not a DTM; **blocked**. |
| Sweden Lantmäteriet | Markhöjdmodell terrängskuggning *rendered* WMS (`js/lantmateriet-hojdmodell-layer.js`) | Obtain authorised bare-earth Markhöjdmodell numeric raster (EPSG:3006); paid-service credentials alone do not unlock height data; **blocked**. |
| Finland MML | national ALS hillshade WMTS (`js/finland-layers.config.js`) | Obtain National Land Survey Finland numeric elevation model raster (EPSG:3067); **blocked**. |

Resolution descriptions above come from layer metadata and service descriptions, **not from possession of numerical elevation files**; for other layers the dataset-specific resolution and CRS must be verified from the acquired files. A registered source is accepted only when it is a single-band GeoTIFF in a projected metre CRS. The service does not call WMS, scrape imagery or infer heights from colour.

## Architecture / deployment

Static vanilla JS/Leaflet frontend (`js/rvt-panel.js`) + Express same-origin `/api/rvt/*` allow-listed proxy + local Python 3.11 raster sidecar (`rvt_service/server.py`). The sidecar uses `rvt.vis` **2.2.3** with the values of `rvt.default.DefaultValues`; methods and stretch ranges are recorded in [`rvt_service/methods.json`](rvt_service/methods.json). It reads a trusted local one-band DTM, builds a virtual Web Mercator grid using Rasterio, reads a padded window, computes from actual **float heights**, crops to 256×256, then sends little-endian float32 with NaN for no-data. File revision + layer + method + measure + XYZ tile key an on-disk cache. Same-origin JS paints from float arrays in Canvas: histogram, clipping, stretch and opacity updates do not request more tiles. Measure changes are debounced. Floats are cached by the Python service and retained in visible tile canvases in the browser. Hillshade/slope/SLRM use the same server path for correctness, rather than claiming a WebGL implementation.

**Deployment:** This repo publishes the site from Netlify as static files. Netlify cannot execute the Python sidecar and there is intentionally no Netlify route that silently falls back to rendered imagery. On the current static deployment true numeric RVT is unavailable; the photo workaround works on opt-in WMS image areas where the 3D tile transport/proxy can return readable pixels. Outside the prepared circle imagery stays untouched. To enable filters, deploy Express plus the Python sidecar behind the same origin (or reverse proxy `/api/rvt` to Express). Set `RVT_SIDECAR_URL=http://127.0.0.1:8765/` on Express and `RVT_SOURCES=/absolute/path/sources.json` on the Python host. Do not expose the sidecar or the source manifest publicly. Copy `rvt_service/sources.example.json` to `rvt_service/sources.json` and replace example paths with **real** local rasters whose usage terms allow derivative visualisations. `RVT_CACHE` optionally points to persistent storage. Register only an actually acquired DTM; metadata enables only registered countries. Use a production process manager, bounded worker concurrency and disk quota for cache; invalidate cache when source files change (mtime/size are included in keys).

Example development install (Python 3.11; rvt's *file I/O* helpers require GDAL but this service imports `rvt.vis` only):

```sh
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r rvt_service/requirements.txt
pip install --no-deps rvt-py==2.2.3
RVT_SOURCES="$PWD/rvt_service/sources.json" python -m rvt_service.server
# In a second terminal, serve the static site and the Express API from one origin.
# Express must have RVT_SIDECAR_URL=http://127.0.0.1:8765/
python -m unittest rvt_service.test_server
```

### Limits and missing features

* Padding is at least the method's search radius, conservatively 2× the SLRM trend radius + 2 px, 3× the MSRM feature width + 2 px. Padding is capped at 128 pixels per side for 256² output (so large search radii fail clearly instead of producing seams). RVT SLRM accepts **10–50 DEM pixels**: metre controls convert using current ground resolution and requests outside that domain are rejected. Zoom-dependent Mercator ground resolution is approximated at tile centre (cos(latitude)); not a replacement for project-CRS native-resolution offline pyramids. Heavy 32-direction sky illumination is slow; cache/precompute on large areas. Tile edges read the same neighbouring DTM values; outside coverage or source no-data is transparent, with a one-pixel masked halo. Registered countries are **not merged**; adjacent coverage stays independent.
* **MSTP** default broad scale `(223, 2023, 180)` pixels is unsuitable for live 256 px tiles and is listed but disabled pending a padded offline *RGB float* pyramid. VAT, Combined VAT, and Prismatic openness are listed but disabled rather than substituting made-up single-band math for the published colour blending recipes. CRIM/e²MSTP/e³MSTP are listed but intentionally not implemented without validated recipes. No authoritative very-suitable-by-feature table was verified in this task: the six feature chips have an intentionally empty `lookingFor` mapping marked **needs verification**, not invented ratings.
* The frontend draws photo-effect thumbnails from cached source image pixels after a successful prefetch; numeric RVT mode instead uses real float tiles. When no readable tiles exist it says “No preview.” The histogram samples every fourth visible pixel from loaded float tiles (ignores NaNs); percentile fit uses the sample. The default 1 m **Range** multiplies display stretch width rather than changing height calculations. The `RVT defaults` label applies to the RVT computation/stretches; the user-requested 20 **metre** SLRM smoothing differs from RVT's native 20 **pixel** default when ground resolution is not 1 m. This discrepancy is deliberate and not hidden.

## Attribution / reference

Relief Visualization Toolbox (RVT-py), © ZRC SAZU and University of Ljubljana, licensed **Apache-2.0** (package `rvt_py-2.2.3.dist-info/LICENSE`, [source](https://github.com/EarthObservation/RVT_py)). Cite: Kokalj, Ž. & Somrak, M. (2019), *Why Not a Single Image? Combining Visualizations to Facilitate Fieldwork and On-Screen Mapping*, Remote Sensing 11(7), 747. Data-provider attribution is displayed separately when a source is active; check each provider's licence before deploying.

## Per-sublayer UI and section tool

A gear **Settings** button is attached to every existing LiDAR sublayer row (European, Romanian counties, and dynamic Albania/Denmark rows) without replacing the WMS service or changing its toggle. The 17-method list is grouped 3/3/5/6; Openness is one method with a positive/negative direction selector in true-DTM mode. On WMS-only layers, all 17 entries have **distinct photo-only simulations**. True RVT methods remain available only on registered numeric DTMs; unsupported numerical methods explain why they are unavailable. The screenshot's MSRM -2.7…2.7 m and 2.5 m display range are UI presets, not the upstream RVT 2.2.3 stretch of -2.5…2.5 m. The six Looking for chips remain unverified and do not claim ratings. Feature-size “play” buttons have unknown semantics and are **not fabricated**.

When a bare-earth DTM is registered, **Section along a line** lets the user click two points on the map (up to 5 km apart). The new `/api/rvt/profile/:layer` endpoint samples 101 heights from that DTM, charts heights alongside values from any already loaded float visualization tiles (separate scales), and copies the numerical samples as CSV. It never samples the WMS pixel colours. The tool is disabled where no DTM exists.

### 2D image adjustments in 3D

When the user chooses the same prepared 1 km area in the 3D entry dialog, the
viewer drapes the photo filter's **processed image pixels** over the terrain,
using the same method, adjustments, alpha and circular mask as 2D. These remain
image effects, not elevation data. The 3D source overzooms the prepared native
tiles; lower zooms are assembled from the cached parent tiles. Raw 3D prefetch
entries never replace the adjusted pixels. A different layer or circle keeps
its normal 3D imagery. Changes to the image effect refresh the focused 3D
source. Selection markers are UI and are not draped as a yellow fill.

Run `node test-lidar-photo-3d.js` for the pixel, layer/area matching, and
protocol precedence checks. `node test-lidar-area-first.js` covers area
selection and cancellation.

## Photo effects on LAKI III and Ro5m — service level windows

The LiDAR photo effect (`js/lidar-photo-filter.js`) prefetches every zoom level from 0 up to the chosen zoom, and one missing tile voids the whole 1 km area. Some ArcGIS MapServer caches publish only a window of levels (`minLOD`/`maxLOD`):

| Layer | Service `minLOD`–`maxLOD` | Before | Now |
|---|---|---|---|
| Ro2m, Ro1m | 0–16 | works | unchanged |
| Ro5m | 7–15 | `maxNativeZoom: 16`; z0–6 requested | `minZoom: 7`, `maxNativeZoom: 15` |
| CS / DJ / GJ / MH LAKI III | 9–17 | z0–8 requested, prepare failed | levels 9…zoom only |

`zoomTiles()` now starts at the layer's `minzoom` and `chooseZoom()` clamps to `[minzoom, maxzoom]`. Checked by `node test-lidar-photo-filter.js`.

## The area's depth belongs to the layer, not to the view it was picked from

**Report (2026-11-01):** *"when choosing a LiDAR area for LiDAR settings from a
great distance, for example zoom 10, when zooming in, that area is really
blurred — like the tiles used for applying the setting are for the same zoom
level that the map had when the area was chosen."*

Exactly that. `chooseZoom()` seeded its plan with `Math.floor(map.getZoom())`:

```js
/* before */
let z = Math.max(lo, Math.min(hi, Math.floor(map.getZoom())));   // ← the view
while (z > lo && zoomTiles(center, z, lo).length > MAX_TILES) z--;
```

At z10 the 1 km disc is **19 px wide** (106 m per pixel at 46° N), so the whole
area was one tile — and `PhotoLayer` was created with
`maxNativeZoom: session.zoom`. Every step closer upscaled that single 100 m/px
tile: already soft at z12, unusable at z16. Picking the same spot from z17 gave
a 1.7 m/px disc, which is why the bug looked like "it depends where I was
standing when I tapped".

### 1. The plan starts at the provider's ceiling

`nativeCeiling()` reads `maxNativeZoom` (the pyramid) before `maxZoom` (only the
display ceiling, above which Leaflet upscales anyway) and `chooseZoom()` walks
**down** from there until the whole disc fits the budget:

| Layer | published levels | native | disc tiles at native | prepared (96 / 48 budget) |
|---|---|---|---|---|
| Ro1m / Ro2m | 0–16 | 16 | 73 | **z16** / z15 |
| Ro5m | 7–15 | 15 | 30 | **z15** / z15 |
| CS / DJ / GJ / MH LAKI III | 9–17 | 17 | 180 | **z16** / z15 |

(Counts at 46.8° N, where a 1 km disc covers 36 tiles at z16 and 110 at z17.)

The tap zoom is no longer an input: the same centre always plans the same disc.
The prepared levels are still every level from the layer's `minzoom` up to that
depth (the lower ones are single tiles), so the effect is visible — and masked
correctly — from the provider's minimum upwards; `settleMasks()` now hides the
overlay only below `session.minzoom`, not below `session.zoom`.

### 2. Above the prepared depth, the exact level is fetched

Preparing to `maxNativeZoom` would blow both the tile budget and the memory
(one decoded 256×256 RGBA tile is 262 KB): 180 tiles at LAKI III's native z17
is 47 MB. So the overlay is created with `maxNativeZoom: nativeCeiling(entry)`
and `PhotoLayer.createTile` has a second path: for `coords.z > session.zoom` it

1. paints the deepest cached parent scaled into the tile as a stand-in, so the
   circle is never a transparent hole over the masked original LiDAR;
2. fetches **that** level through the same `fetchPixels()` transport (the
   provider usually answers from the HTTP cache, because the live LiDAR layer
   underneath is drawing the same URLs);
3. repaints the tile with the real pixels when they arrive, and drops them
   again on `tileunload`.

A tile that cannot touch the disc (the grid is bigger than 1 km) requests
nothing at all. `tile3d()` gained the matching exact-hit branch, so a 3D
round-trip after a close-in 2D view reuses those deep pixels instead of
overzooming the prepared ones.

Net effect: the disc is sharp at every zoom the provider actually serves — the
prepared levels instantly, anything deeper as it is looked at.

Checked by `node test-lidar-photo-filter.js` (the plan ignores `map.getZoom()`
and stays inside the budget) and the new `node test-lidar-photo-deep-zoom.js`
(real prepare at z10 → depth 16, deeper tile requested by its own level, tiles
outside the disc never requested, prepared levels drawn from memory).

## Leaving 3D resets the area and its settings

**Report (2026-11-01):** *"when applying settings to a certain LiDAR area, then
seeing it in 3D and going back to 2D, the applied filter and setting should be
reset back to normal, because it crashed the PWA app."*

The effect used to survive the hand-off. That is a lot of memory to keep: a
prepared disc holds up to 96 decoded 256×256 RGBA tiles on desktop (73 at a
1 km, z16 disc) or 48 on a phone — 19 MB / 12 MB of `ImageData`, on top of the
photo overlay's canvases — and it was all still held while MapLibre's deck had
been built *and* torn down. On an installed PWA (iOS especially) the returning
2D map then had to repaint its own tiles while that cache was still allocated,
and the app died on the way back.

**Now the prepared area does not outlive the 3D view.** `close()` in
`js/map3d-terrain.js` announces the hand-off once, after the deck is gone:

```js
root.dispatchEvent(new CustomEvent('detectlab:3d-closed', { detail: {} }));
```

Two listeners answer it:

| listener | what it puts back |
| --- | --- |
| `js/lidar-photo-filter.js` → `reset()` | `stop()` the photo effect (overlay removed, the original LiDAR tiles un-masked, marker gone), **clear the decoded tile cache**, and every photo adjustment back to its default |
| `js/rvt-panel.js` → `resetSettings()` | `areaReady` false, the RVT float overlay removed, the float tile store and section line dropped, the stored photo/RVT settings for every layer deleted, and the settings window and minimized dock entry closed |

So after a 3D round trip the LiDAR sublayer looks exactly like a normal layer
again, and the next opening of **LiDAR Settings** starts from a clean slate:
choose the area again, adjust again. Nothing is reset when the 3D view is never
opened (cancelling the 3D entry dialog leaves the prepared area alone — `close()`
returns before announcing), and the image-effect bridge *into* 3D is untouched:
the pixels are still there for the deck while 3D is open.

Checked by `node test-lidar-photo-deep-zoom.js` (the `detectlab:3d-closed`
listener drops the session, removes the overlay and restores the defaults),
`node test-lidar-area-first.js` (the panel closes,
the effect is stopped and a new area can be prepared) and
`node test-map3d-terrain.js` (the viewer announces the hand-off from `close()`).
