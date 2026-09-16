# Archeological Potential Sites — "Zone cu potențial arheologic"

Premium map analysis layer for DetectLab.

> **This layer does NOT predict archaeological sites with AI.** It identifies
> candidate areas that *statistically* have a higher probability of containing
> undiscovered sites, based only on the spatial distribution of the already
> known archaeological sites around the current map center.

---

## Files

| File | Purpose |
|---|---|
| `js/archeo-potential.js` | The whole layer: triangulation, filtering, scoring, score field, rendering, pin/radius, UI wiring. |
| `js/leaflet-heat.js` | `L.heatLayer` (simpleheat). **No longer used by this layer** — the heatmap is now the layer's own score raster (see below). Still in the app shell, so keep it precached. |
| `js/vertical-opacity-control.js` | Mirrors the layer's radius slider vertically on the map and docks its action button bottom-centre (`DISTANCE_SOURCES`, `syncDistanceDock`). |
| `index.html` | Premium-tab UI row (pin switch, radius slider, output-mode buttons, run button, dual legend, status) + `#layerActionDock` + `<script>` includes. |
| `css/styles.css` | `.archeo-pot-*` (row, pin, mode buttons, legend, heat bar), `.layer-action-dock*`, `[data-kind="distance"]` mirror colours. |
| `js/translations.js` | RO/EN labels for the new UI. |
| `sw.js` | Pre-cache list + cache version bump for the new scripts. |
| `test-archeo-potential.js` | Node test harness (pure logic + field pipeline + bubble separation + heat canvas with stubs). Run with `node test-archeo-potential.js`. |
| `test-vertical-opacity-control.js` | Covers the distance mirror + action dock. Run with `node test-vertical-opacity-control.js`. |

---

## Clicking a candidate — popup with star rating

Every candidate circle is **clickable**. Clicking opens a small popup with:

- **Classification + raw score %** (`High Potential — 72%`).
- **5-star rating** — the score (0–1) is converted to `score × 5 / 5` stars with
  partial fill (e.g. `0.72 → 3.6/5`). The stars' color comes from the score's
  heat scale: **red** (low) → **amber** (medium) → **violet** (high), so the
  color itself also encodes the score.
- **Distance to the closest known site** (always ≥ 700 m by the mandatory
  distance filter — the exact value is shown, e.g. `812 m`).
- Full scoring breakdown: nearby site count, average distance, local density,
  triangle quality, and coordinates.

Internally the color mapping lives in `scoreColor()` and the star markup in
`starRatingHtml()` (both exposed on `_archeoPotentialDebug`); the heat-scale
stops are defined in `SCORE_COLOR_STOPS`.

---

## Workflow (button press)

1. Take the **purple pin** dropped on the map (`#archeoPotPinToggle` on) or,
   without a pin, the **current map center** (`map.getCenter()`).
2. Build a search circle from the **radius slider** (`#archeoPotDistance`,
   1–10 km; `currentRadiusM()`). Headless callers that pass no radius still get
   `SEARCH_RADIUS_M` (10 km).
3. Load every known archaeological site intersecting the circle from DetectLab's
   own API data already present in `window._localLayerData`
   (layers `0` = RAN sites, `5` = tumuli, `6` = site-boundary polygons).
4. Project the working area to local meters (center-latitude Web Mercator) and
   run a **Delaunay triangulation** (Bowyer–Watson) over the site coordinates.
   Triangles are bucketed in a uniform index (`TRI_INDEX_CELL_M`) so any point
   finds its containing triangle in O(1).
5. **Tile the whole circle with a regular grid** (`buildFieldCells`) — cell size
   adapts to the radius (`gridCellM`, capped by `FIELD.BUBBLE_MAX_CELLS` /
   `FIELD.HEAT_MAX_CELLS` so phones stay responsive).
6. Score **every cell** (`scoreCandidate` + `triScoreAt`) after the mandatory
   exclusion checks; excluded cells are recorded with a reason (`uat`,
   `heritage`) instead of being dropped silently.
7. Render the field in the selected output mode (bubbles / heatmap) plus the red
   exclusion mask.

> `window.computeArcheoPotential(centerLat, centerLng, radiusM, opts)` still
> runs the **original candidate pipeline** (few, separated, Medium/High only)
> and is what the Archeological Report layer consumes — its signature and result
> shape are unchanged. The map layer uses the separate
> `window.computeArcheoPotentialField(...)` score field.

---

## Two output modes (bubbles / heatmap)

Both modes read the **same dense score field**; they only differ in how they
show it (`#archeoPotModeBubbles` / `#archeoPotModeHeat`,
`setArcheoPotentialMode`). Switching modes re-renders the last analysis
immediately — the rendering follows the UI mode, not the mode the field was
computed with.

| | **Bubbles** | **Heatmap** |
|---|---|---|
| Geometry | a **sparse selection** of the best cells (`selectBubbles`), one `L.circle` each, with **its own radius** | a **score raster** (1 px per grid cell) drawn on a canvas anchored to the geography |
| Grid | `FIELD.BUBBLE_CELL_M` 250 m, ≤ `BUBBLE_MAX_CELLS` 2200 | `FIELD.HEAT_CELL_M` 120 m, ≤ `HEAT_MAX_CELLS` 9000 |
| Score encoding | three purple tiers (`STYLE.low/medium/high`) + popup with star rating | `HEAT_GRADIENT` ramp (`#10233f → #1f7fc4 → #23c48e → #f2b134 → #8b3ff0`) **plus** alpha growing with the score |
| Pane | `pane_archeo` (z 660) | `pane_archeo_heat` (z 656) |

**Every point is considered**: `stats.scored + stats.excludedUat +
stats.excludedHeritage === stats.cells`.

### Bubbles — the "sweet spot"

Drawing one bubble per scored cell made the map unreadable: up to ~2200
overlapping circles that also covered the heritage radii. Bubbles are now a
selection (`CONFIG.BUBBLE`), and a cell only becomes a bubble when its **whole
disc** fits:

- **score ≥ `BUBBLE.MIN_SCORE`** (0.30) — weak cells stay in the heatmap;
- **≥ `MASK_CLEARANCE_M`** (90 m) of free ground to the red mask, measured
  exactly: distance to the 700 m heritage rings, to the site polygons and to
  the UAT built-up rectangles (point→box distance, boxes are cell-sized);
- **≥ `GAP_M`** between any two bubbles, so they never touch or interleave;
- radius = `min(bubbleBaseRadiusM, clearance − MASK_CLEARANCE_M)`, and a cell
  whose radius would drop below `RADIUS_FLOOR_M` is not drawn at all.

Size and count scale with the slider radius, so 1 km and 10 km analyses look
equally airy:

| | 1 km | 4 km | 10 km |
|---|---|---|---|
| base radius | 150 m | 266 m | 420 m |
| gap | 88 m | 164 m | 260 m |
| bubble cap (`PER_KM2` 0.22, `MIN_BUBBLES` 10, `MAX_BUBBLES` 140) | 10 | 11 | 69 |

Selection is greedy by score (highest first) with a real pairwise distance
check, using a uniform grid index. If the area is so fragmented by the
intravilan that fewer than 4 bubbles fit at the preferred size, one relaxed
pass runs (`RADIUS_FLOOR_M`, 60 % of the gaps) — otherwise the map would come
back empty.

### Heatmap — a real score surface

`leaflet-heat` accumulates **alpha** from overlapping blobs. With a dense grid
every pixel is covered by dozens of blobs, so alpha saturates at 1 nearly
everywhere and the whole surface ends up one colour; on top of that its blob
radius is in pixels and its canvas is repositioned only on `moveend`, so the
heat visibly slides while zooming.

The layer now builds its own surface (`buildHeatRaster`):

1. every scored cell writes its score into a `cols × rows` grid
   (`field.grid`, cells carry `row`/`col`);
2. scores are **normalised over the run's own 2nd–98th percentile**
   (`heatScoreWindow`) — if that window is narrower than `HEAT.MIN_WINDOW`
   (0.12) it is expanded around the median, so a narrow score band still shows
   contrast instead of a flat colour;
3. a separable gaussian blur (`HEAT.SMOOTH_SIGMA_CELLS` = 1 cell) smooths
   **between scored cells only** — excluded cells stay transparent, so the red
   mask is not painted over;
4. each cell is coloured through the 256-entry ramp LUT (`buildHeatRamp`) and
   given an alpha between `HEAT.ALPHA_MIN` (0.46) and `HEAT.ALPHA_MAX` (0.97)
   — weak zones read as faint, strong zones as saturated;
5. the small raster is drawn scaled between the **geographic** corners of the
   grid, on a canvas positioned with the same contract as the Patrimoniu
   canvases in `map-app.js`: `containerPointToLayerPoint([0,0])` +
   `project(latlng) − pixelOrigin` on every settled view
   (`move/moveend/zoom/zoomend/viewreset/resize`), and the renderer transform
   (`getZoomScale` + `_getNewPixelOrigin`, scaled around the recorded bitmap
   anchor) during `zoomanim`/pinch. Unrounded projection keeps a zoom jump from
   multiplying a half-pixel rounding error into a visible slide.

So a colour always means the same thing — the score of that ground — and the
surface stays glued to the map at every zoom. `test-archeo-potential.js`
asserts both: the drawn width equals the grid's geographic extent at z10/z13/
z16 (±2 %), and the ramp steps are far apart in RGB.

**Excluded areas are red** (in both modes) and live in `pane_archeo_mask`
(z 658): UAT-excluded cells merged into row-run `L.rectangle`s, the 600 + 100 m
heritage protection rings, and the site-boundary polygon outlines. Red is
reserved for exclusions — the score ramp ends in violet instead.

---

## Map-side controls (distance mirror + action dock)

`js/vertical-opacity-control.js` registers the analysis layers' distance/radius
sliders explicitly (`DISTANCE_SOURCES`, by id — never through the generic
`[id*="Opacity"]` panel selector):

| Layer | slider | toggle | docked button |
|---|---|---|---|
| LIDAR Scanner | `#lidarScannerDistance` (10–50 km) | `#lidarScannerToggle` | `#lidarScannerRun` |
| Archeological Potential Sites | `#archeoPotDistance` (1–10 km) | `#archeoPotPinToggle` | `#archeoPotRunBtn` |
| Archeological Report | `#archReportDistance` (1–10 km) | `#archReportToggle` | `#archReportRunBtn` |

Pressing the layer row (or switching the layer on) opens the **vertical mirror**
on the right — same interaction as the opacity sliders, but `data-kind="distance"`
formats the value in km, shows a `DISTANCE`/`RAZĂ` caption and colours the mirror
per layer through `data-owner`. The layer's own action button is **physically
moved** into `#layerActionDock` (bottom-centre of the map screen) with a radius
chip beside it, and returned to its panel row when the mirror closes. While the
dock is open, `body.layer-dock-open` lifts the other bottom-centre floating
controls (`--layer-dock-clearance`) so nothing overlaps.

The purple pin (`#archeoPotPinToggle`) works like the LIDAR/report points: tap
the map to drop it, drag the slider to resize its circle, press the docked
button to analyse that exact radius. Turning the layer off also closes the pin
mode, the mirror and the dock.


---

## Mandatory filters (all must pass)

1. **Inside the UAT "red zone"** — the candidate's pixel on the UAT raster
   (Cloudflare R2 tiles, zoom 14, read through the app's existing
   `window._uatGetTile` cache) must be **opaque** (drawn red = inside a UAT
   polygon). Transparent pixels (non-red) are discarded. Missing/unreadable
   tiles **fail closed** (candidate discarded), matching the policy the rest
   of the app uses for its UAT checks.
2. **Distance from existing sites** — every known site has a protection radius
   (`SITE_RADIUS_M` = 600 m, the same value as the app's heritage circles).
   A candidate must be at least `SITE_RADIUS_M + SITE_BUFFER_M` (600 + 100 m)
   from every site's center. Polygon sites (layer 6) are represented by
   guard points along their perimeter (every `POLYGON_GUARD_STEP_M` m) plus
   their centroid, and candidates may not fall **inside** a site polygon.
3. **Search circle** — cells are only generated inside the slider radius
   (1–10 km; 10 km = `SEARCH_RADIUS_M` for headless callers).
4. **Separation** *(legacy candidate pipeline only)* — after scoring, candidates
   closer than `CANDIDATE_MIN_SEPARATION_M` (900 m) to a higher-scored candidate
   are suppressed; output is capped at `MAX_CANDIDATES`. The score **field**
   keeps every cell (that is the point of the dense modes), so it applies no
   separation and no cap.

---

## Scoring (0..1, configurable weights)

| Factor | How it's computed | Config |
|---|---|---|
| Nearby sites | sites within 1.5 km, normalized by 6 (`2 → 0.33`, `4 → 0.67`, `6+ → 1.0`) | `SCORING.NEARBY_RADIUS_M`, `NEARBY_COUNT_REF` |
| Avg. distance | mean distance to the 5 nearest sites, `1 − avg/3000 m` | `SCORING.K_NEAREST`, `AVG_DIST_REFERENCE_M` |
| Triangulation | triangle quality (equilateral = 1, sliver → 0) × centroid-proximity bonus | `MIN_TRIANGLE_QUALITY`, `MAX_SAMPLES_PER_TRIANGLE` |
| Density | sites within 3 km, normalized by 8 | `SCORING.DENSITY_RADIUS_M`, `DENSITY_COUNT_REF` |

Weights (default `0.30 / 0.25 / 0.25 / 0.20`) live in `CONFIG.SCORING`.
Classification thresholds in `CONFIG.CLASSIFY`:

- `score < 0.25` → **discarded**
- `0.25 ≤ score < 0.55` → **Medium Potential**
- `score ≥ 0.55` → **High Potential**

**Adding a new criterion later:** add a normalized factor in
`scoreCandidate()` and a weight row in `SCORING` — nothing else changes.

---

## Live configuration (no redeploy)

```js
// from the browser console
ARCH_POTENTIAL_CONFIG.SEARCH_RADIUS_M = 15000;          // 15 km working area
ARCH_POTENTIAL_CONFIG.SITE_RADIUS_M = 300;              // smaller site radii
ARCH_POTENTIAL_CONFIG.CLASSIFY.SCORE_HIGH_FROM = 0.6;   // stricter High class
ARCH_POTENTIAL_CONFIG.SCORING.W_TRIANGLE = 0.35;        // boost triangle weight
ARCH_POTENTIAL_CONFIG.SHOW_TRIANGULATION = true;        // debug: draw triangles
ARCH_POTENTIAL_CONFIG.BUBBLE.PER_KM2 = 0.35;            // more bubbles per km²
ARCH_POTENTIAL_CONFIG.BUBBLE.RADIUS_M = 520;            // bigger bubbles at 10 km
ARCH_POTENTIAL_CONFIG.HEAT.MIN_WINDOW = 0.2;            // even stronger heat contrast
```

---

## Performance

- **Global grid spatial index** (R-tree-style culling) is built lazily once
  over all loaded heritage features and cached; per-run queries only touch
  the cells overlapped by the 10 km circle.
- **UAT tile reads** reuse the app's per-tile promise cache, so a 10 km run
  performs at most a few hundred tile fetches regardless of candidate count.
- The analysis runs in **async chunks** (`FIELD.CHUNK_SIZE` = 120 cells per
  batch for the field, 30 seeds per batch for the legacy pipeline), yielding to
  the UI between batches so the map stays responsive; progress is reported
  through `opts.onProgress` into the status line.
- **Grid caps keep phones alive**: `gridCellM()` grows the cell size until the
  circle holds at most `BUBBLE_MAX_CELLS` (2200) / `HEAT_MAX_CELLS` (9000)
  cells, so a 10 km run costs the same as a 3 km run.
- Bubble **popups are built lazily** (`bindPopup(fn)`), and there are only a
  few dozen bubbles to bind in the first place (`CONFIG.BUBBLE`).
- The heat surface is a **tiny raster** (≤ ~115 × 115 px) drawn with a single
  `drawImage` per settled view — no per-cell DOM, no per-zoom recomputation of
  the scores.
- The UAT mask merges excluded cells into **row-run rectangles** instead of one
  rectangle per cell (a few hundred shapes instead of a few thousand).
- A Web Worker is intentionally not used: the only slow part (tile fetching)
  is already asynchronous and cached, and geometry is O(n log n)-ish over a
  few hundred points.

---

## Debugging

```js
_archeoPotentialResults()          // scored cells of the last run (field mode)
_archeoPotentialBubbles()          // the sparse bubble selection actually drawn
_archeoPotentialHeat()             // the heat canvas layer (canvas, _lastFrame, anchor)
_archeoPotentialHeatRaster()       // heat raster: rgba, values, valid, window, bbox
_archeoPotentialField()            // full field: grid, results, bubbles, excluded, heat, stats
_archeoPotentialState()            // { pinMode, pin, radiusKm, radiusM, mode, resultsVisible, running }
setArcheoPotentialMode('heat')     // 'bubbles' | 'heat'
setArcheoPotentialPinMode(true)    // arm the purple pin (map clicks place it)
_archeoPotSetPoint(46.77, 23.59)   // drop the pin from the console
setArcheoPotentialRadiusKm(4)      // move the radius slider (1–10)
computeArcheoPotentialField(lat, lng, radiusM, { mode: 'heat' })  // field without rendering
_archeoPotentialDebug.config       // live config object (incl. CONFIG.FIELD / BUBBLE / HEAT)
_archeoPotentialResetCache()       // force the global site index rebuild
```

The console logs one summary line per run, e.g.:
`[ArcheoPotential] bubbles · 41 sites, 2230 cells (375 m), 2162 scored, 0 UAT-excluded, 68 heritage-excluded (64 high, 128 medium, 1970 low) — 340 ms`.
