# Country-scoped layer window + visible country bounds

## What changed

Selecting a country now *scopes* the layer catalogue and keeps the selection
visible on the map:

- **The layer window only offers layers that cover the selected country.**
  After a selection, every row in `#transpPanel` whose published coverage
  (`layerDefs` / `internationalLayerDefs` bounds in `js/map-app.js`) does not
  partially or entirely overlap the bounds of the country gets
  `.country-layer-unavailable` and is hidden (new CSS rule under
  `#transpPanel.country-filter-active`). Example: Italy selected → Denmark's
  DHM LiDAR disappears from the panel, while France's IGN MNT and the
  swisstopo relief (whose footprints reach Italy's bounds) stay. Group rows
  (LiDAR, historical, Roman, premium, vegetation, EU maps) hide too when none
  of their sublayers survives the filter — including the LiDAR group, whose
  European rows carry no group key and are matched by DOM containment.
- **The bounds of the selected country stay visible on the map.** The globe
  gate draws them for the whole locked view: the real country outline
  (`L.geoJSON` of the gate's geometry) once the atlas is loaded, the bbox
  rectangle until then (a selection restored from `localStorage` starts with
  the rectangle and upgrades as soon as `ensureReady()` / the 10 m shapefile
  refinement delivers geometry). The overlay is non-interactive, sits in its
  own pane `pane_country_bounds` at z-index **688** (above every data pane —
  LIDAR 610, historical maps ≤ 652 — under tracks 690 / measure 700), is
  replaced on every new selection and removed on unlock (“Exit view”,
  `reset()`).

## Files

- `js/map-app.js` — `filterLayersForCountry(iso)` now falls back to the
  stored selection bbox when `window._detectlabCountryLayer` is absent,
  filters group rows by membership (DOM containment with a parent-chain walk
  fallback; an element counts as inside itself, matching `Node.contains`,
  because the EU-maps row hosts its own expand icon), and
  `unfilterLayersForCountry()` restores group rows as well.
- `css/styles.css` — `#transpPanel.country-filter-active
  .country-layer-unavailable { display: none !important; }` (the class
  existed before but had no rule, so the filter never showed).
- `js/globe-country-picker.js` — `showCountryBoundsLayer` /
  `removeCountryBoundsLayer` / `refreshCountryBoundsLayer`, wired into
  `restrictLeafletToCountry`, `unlockCountryView`, `ensureReady` and
  `refineFromShapefile`; `state.boundsLayer` tracks the overlay.
- `tools/country-dock-preview.html` — the dev harness now carries a mini
  layer panel implementing the same contract (same row ids, same classes) and
  reports whether the bounds overlay is an outline or the bbox rectangle.
- `test-country-layer-filter.js` — regression suite (see below).
- `index.html` / `sw.js` — version bumps
  (`css/styles.css?v=20261008-country-layer-filter`,
  `js/map-app.js?v=20261008-country-layer-filter`,
  `js/globe-country-picker.js?v=20261008-country-bounds`), shell `v169`.

## Semantics

- *Partially or entirely covers* = `countryBounds.intersects(layerBounds)`,
  the same rectangle-intersection semantics as the green coverage highlight
  (`checkLayerVisibility`). Edge contact counts.
- Rows without a bounds record are left untouched (live/API layers that do
  not publish coverage yet).
- Layer on/off state is not changed by the filter — the map is locked to the
  country anyway, and switching back restores rows with their previous state.
- The filter belongs to the locked view: it applies on every selection
  (globe pick, dock switch, restored selection) and is released by
  “Exit view” / `DetectLabGlobeGate.unlock()` / `reset()`.
- Market note: bounds are exactly what the catalogue publishes. On the .eu
  market the Roman layers use the Empire-wide box (kept for Italy/Denmark),
  while vegetation-fingerprint rows still declare `ROMANIA_BOUNDS` and hide
  abroad.

## Manual QA

- `python3 -m http.server` at the repo root → open
  `/tools/country-dock-preview.html`: pick Italy → the mini panel loses the
  Denmark/Norway/Sweden/UK/Poland/Netherlands rows and the whole Romanian
  historical group, keeps France/Switzerland LiDAR and the EU maps row; the
  status line reports the bounds overlay (bbox rectangle → country outline
  once the atlas loads). “Exit view” restores everything.
- Run `node test-country-layer-filter.js`, then `node test-country-dock.js`,
  `node test-globe-canvas-picker.js` and `node test-layer-visibility.js`
  after touching any of this.
