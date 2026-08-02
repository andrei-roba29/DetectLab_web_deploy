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
| `js/archeo-potential.js` | The whole layer: triangulation, filtering, scoring, rendering, UI wiring. |
| `index.html` | Premium-tab UI row (button "Candidate Areas / Zone candidati", toggle, legend, status) + `<script>` include. |
| `js/translations.js` | RO/EN labels for the new UI. |
| `sw.js` | Pre-cache list + cache version bump for the new script. |
| `test-archeo-potential.js` | Node test harness (pure logic + end-to-end pipeline with stubs). Run with `node test-archeo-potential.js`. |

---

## Workflow (button press)

1. Take the **current map center** (`map.getCenter()`).
2. Build a search circle of **10 km** (`SEARCH_RADIUS_M`).
3. Load every known archaeological site intersecting the circle from DetectLab's
   own API data already present in `window._localLayerData`
   (layers `0` = RAN sites, `5` = tumuli, `6` = site-boundary polygons).
4. Project the working area to local meters (center-latitude Web Mercator) and
   run a **Delaunay triangulation** (Bowyer–Watson) over the site coordinates.
5. Generate candidate seeds near the **centroids / interiors of the triangles**
   — i.e. empty spaces surrounded by known sites.
6. Apply the mandatory filters (below).
7. Score + classify every survivor (`Medium` / `High`).
8. Merge overlapping candidates and render **300 m purple circles**.

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
3. **Search circle** — candidates are only kept inside the 10 km radius.
4. **Separation** — after scoring, candidates closer than
   `CANDIDATE_MIN_SEPARATION_M` (900 m) to a higher-scored candidate are
   suppressed; output is capped at `MAX_CANDIDATES`.

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
```

---

## Performance

- **Global grid spatial index** (R-tree-style culling) is built lazily once
  over all loaded heritage features and cached; per-run queries only touch
  the cells overlapped by the 10 km circle.
- **UAT tile reads** reuse the app's per-tile promise cache, so a 10 km run
  performs at most a few hundred tile fetches regardless of candidate count.
- The analysis runs in **async chunks** (30 seeds per batch), yielding to the
  UI between batches so the map stays responsive; a run typically completes
  in a few milliseconds of CPU + the tile fetch latency.
- A Web Worker is intentionally not used: the only slow part (tile fetching)
  is already asynchronous and cached, and geometry is O(n log n)-ish over a
  few hundred points.

---

## Debugging

```js
_archeoPotentialResults()          // last results array
_archeoPotentialDebug.config       // live config object
_archeoPotentialResetCache()       // force the global site index rebuild
```

The console logs one summary line per run, e.g.:
`[ArcheoPotential] 41 sites, 63 triangles, 71 seeds, 22 passed filters, 9 candidates (3 high, 6 medium) — 143 ms`.
