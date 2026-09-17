# Multi-layer map performance — the crash on a sudden zoom

**Status: 2026-09-17.** Reported: with several *dense* raster layers open at the
same time — the LIDAR sub-layers (HD, AR, AB, BH, CS, „Romania 2–5 m/pixel",
„Romania 1 m/pixel agregare", the four LAKI III sheets) and **„Imagini
satelitare anii 60'"** (CORONA) together with the historical maps, the APM
2.0 stack and the basemap — a **sudden gesture** (an abrupt zoom-in, a fast
pinch, a violent drag) made the page **crash and reload itself**.

This document explains the cause, the fix (`js/tile-perf.js` + the wiring in
`js/map-app.js`), and the live knobs you can use without a redeploy.

---

## 1. Cause: the number of live tiles, not a leak

A decoded 256×256 RGBA tile costs ≈ **0.25 MB** (262 144 bytes) in the renderer.
Leaflet's defaults are tuned for **one** tile layer; this app can put **10–25**
of them in the same viewport:

| Leaflet default | Effect with a stack of dense layers |
|---|---|
| `updateWhenZooming: true` | every animation frame of a pinch/scroll zoom re-runs `_update()` for **every** layer and queues tiles |
| `updateWhenIdle: L.Browser.mobile` | `false` whenever the UA is spoofed („Desktop site" mode, some PWAs), so every **pan** frame does the same |
| `keepBuffer: 2` | a 2-tile ring of off-screen tiles kept alive **per layer** |
| `_pruneTiles()` keeps **5 ancestor + 2 descendant** zoom levels | while the zoom changes, levels nobody sees stay decoded |
| `fadeAnimation: true` | `_tileReady()` re-scans **all** tiles of the layer on every animation frame to fade them in |

During one fast zoom of a phone-sized viewport (390×780 → ~15 visible tiles per
layer) an activated stack of ~15 heavy layers therefore reaches **hundreds of
in-flight requests and thousands of decoded tiles within a second**. WebKit /
Chromium terminate the tab (out of memory) and the page „refreshes" itself.

The 60's layer alone was already fixed this way (`SATELLITE_60s_FIX.md` §6);
the same class of limits is now applied to **every** tile layer, so the crash
does not come back as soon as another dense layer (LIDAR, historical map, APM)
is part of the mix.

---

## 2. The fix

### 2.1 `js/tile-perf.js` — one governor for every tile layer

Loaded **right after `js/leaflet.js`** and **before `js/map-app.js`**, so it
patches the defaults before any layer exists:

1. **Gesture-safe defaults** (prototype options, so `L.tileLayer(...)`,
   `L.tileLayer.wms(...)` and every custom `GridLayer` inherit them; an explicit
   per-layer option always wins):
   `updateWhenZooming: false`, `updateWhenIdle: true` on low-power devices,
   `keepBuffer: 0` (phone) / `1` (desktop), `updateInterval: 200–250 ms`.
2. **One tile update per layer per gesture.** `_update()` called while a zoom is
   animating, or within a short settle window (`quietMs`: 160 ms desktop /
   260 ms phone) after the last gesture, is merged: the layers are queued and
   updated **once**, at the final zoom. Two rules keep that from ever costing a
   frame: a pan (which is not a zoom) flushes the queue immediately, and a layer
   with **no tiles on screen** — the first paint after switching it on, or any
   `viewprereset` wipe (`setView(..., {animate:false})`, `redraw()`) — is also
   updated immediately. Deferral is only ever applied while there is an older
   level to keep visible, so the governor can never leave an empty tile pane.
   No `setView`/`zoomend` ordering assumptions are made: the governor listens to
   `zoomstart / zoomend / movestart / moveend / move / zoom` and self-heals if a
   `zoomend` never arrives.
3. **Stricter pruning + a hard ceiling.** Pruning keeps **1–2 ancestor** levels
   (instead of 5) and **1–2 descendant** levels, and no layer may keep more than
   `maxRetainedTiles` (24 phone / 64 desktop) tiles *outside* the viewport — at
   least one full extra level is always allowed, so the zoom handoff (previous
   level scaled over the incoming one) does not blank out. Nothing is pruned
   while a zoom animation is on screen: the old levels are released right after
   the deferred update instead, so no blank flash is introduced.
4. **A page watchdog** (every 5 s, never mid-gesture) estimates the decoded-tile
   memory of the whole page. Above the device budget (≈80 MB phone / ≈350 MB
   desktop) the page switches to **conservation mode**: the off-screen rings of
   all layers are dropped, the retained levels are cut to 1/0, and a one-time
   translated notice suggests closing the layers that are not needed. Below 60 %
   of the budget it goes back to normal limits.

### 2.2 `js/map-app.js`

- The map calls `window.DLTilePerf.attach(map)` right after it is created.
- **LIDAR**: `_buildLidarLeafletLayer()` builds every sub-layer (xyz, WMS and
  WMTS-KVP branches alike) through a shared `_lidarPerfOptions()` helper, so the
  LIDAR stack explicitly carries `updateWhenZooming: false`,
  `updateWhenIdle: true` and the adaptive `keepBuffer`.
- **Sat60 / CORONA** keeps its own explicit options (the same values, verified
  by `test-sat60-mobile-crash.js`) and now takes its device class from
  `DLTilePerf.isLowPowerDevice()` so a single detector rules both, with the old
  local detection kept as fallback.

### 2.3 Other files

| File | Change |
|---|---|
| `js/translations.js` | `perf_layers_notice` (en + ro) for the conservation-mode notice |
| `index.html` | `<script src="js/tile-perf.js?v=20260917-tile-perf">` after Leaflet; `map-app.js` / `translations.js` re-versioned |
| `sw.js` | the new file + the re-versioned URLs added to `PRECACHE_URLS`, and `CACHE_NAME` bumped to `detectlab-v100-tile-perf` so installed PWAs drop the old shell and pick the governor up |
| `test-tile-perf.js` | new regression test (see §5) |
| `bench-tile-perf.js` | optional benchmark, needs `jsdom` (see §5) — not loaded by the site |

---

## 3. What is deliberately NOT changed

The governor only decides **when** and **how many** tiles stay alive:

- tile URLs, WMS-C parameter order (the byte-identical CORONA request), layer
  names, zoom gates, footprints, opacities, panes and z-index are untouched;
- no layer is ever turned off automatically — conservation mode drops only the
  tiles nobody is looking at, and the notice asks the user what to close;
- `zoomAnimation` stays on: the Patrimoniu canvases need the `zoomanim`
  transform (see the comment in the `L.map(...)` options), and with
  `updateWhenZooming: false` the zoom frames are pure CSS transforms anyway.

---

## 4. Live knobs (no redeploy)

```js
// Tune the governor before/while debugging (partial object is fine):
window.DLTILE_PERF = { quietMs: 300, maxLiveTiles: 250, keepBuffer: 0 };

// Force the phone profile / escape hatch for a single layer:
window.DLTILE_LOW_POWER = true;              // or window.SAT60_LOW_POWER_TILES
L.tileLayer(url, { dltilePerf: false });     // this layer opts out entirely

// Inspect and act at runtime:
window.DLTilePerf.stats();          // { tiles, layers, mb, budget, lowPower, conservation }
window.DLTilePerf.sweep();          // release the off-screen tiles of every layer now
window.DLTilePerf.inConservationMode();
window.DLTilePerf.onConservation = function (s) { /* your own UI */ };
```

---

## 5. Tests

```bash
node test-tile-perf.js            # governor: defaults, one update per gesture,
                                  # pruning levels, tile ceiling, conservation mode
node test-sat60-mobile-crash.js   # the CORONA fix still intact (47 checks)

# optional, needs jsdom (npm i jsdom) — real Leaflet + real governor, tile counts:
node bench-tile-perf.js
```

`test-tile-perf.js` runs the real `js/tile-perf.js` against a minimal fake
Leaflet in a VM, so it verifies behaviour (update counts, retained levels, the
tile ceiling, the notice) instead of only grepping the source, plus the wiring:
script order in `index.html`, the PWA precache, the LIDAR helper and the
Sat60/governor detector handshake. It also pins the two rules that keep the map
from ever looking empty: a first paint is never delayed, and a layer whose tiles
were wiped repaints during the gesture instead of waiting for the settle window.

`bench-tile-perf.js` loads the real `js/leaflet.js` (1.9.4) in jsdom and replays
both gesture paths with 12 dense layers on a 390×780 viewport:

| Path (12 layers) | Without governor | With governor |
|---|---|---|
| pinch — `_moveStart` + `_move{pinch}` ×20 + `_animateZoom` | 720 tiles requested, 180 live | **96 tiles (−87 %)**, 96 live |
| wipe — `setZoom(z, {animate:false})` ×4 | 432 tiles, no empty frame | 432 tiles, no empty frame |

The pinch row is the reported crash: without the governor every frame of the
gesture queues a viewport of tiles for every layer, and the levels nobody looks
at stay decoded. The wipe row is unchanged on purpose — there is nothing left on
screen to protect there, so the repaint must go through at once.

---

## 6. Notes / caveats

- **Visual effect on a phone**: on an *animated* gesture (pinch, wheel, double
  tap) the previous level stays on screen and is CSS-scaled, so the tiles of the
  final zoom appear ~0.2–0.3 s after the gesture ends. That is the same trade-off
  the 60's layer already shipped with; it is what removes the burst that killed
  the tab. Non-animated zooms (`setView(..., {animate:false})`, `redraw()`,
  `viewprereset`) are **not** delayed at all: there the old tiles are already
  gone, so the layer repaints immediately.
- **`keepBuffer: 0` on phones** means off-screen tiles are dropped immediately
  while panning; Leaflet's own mobile default (`updateWhenIdle`) already behaves
  this way. Desktop keeps a 1-tile ring.
- **If a device still reports memory pressure** (`window.DLTilePerf.stats().mb`
  near the budget), the honest fix is fewer simultaneous dense layers: LiDAR
  HD/AR/AB/BH/CS, „Romania 1 m" and the LAKI III sheets overlap, so two or three
  of them are usually enough for one area.
- The retired `js/Leaflet.VectorGrid.js` is not loaded by `index.html`; it now
  inherits the same defaults through the prototype, but the UAT layer is a plain
  `L.geoJSON` and is unaffected.
