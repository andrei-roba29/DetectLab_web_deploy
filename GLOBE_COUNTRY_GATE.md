# 3D Globe Country Gate (canvas edition)

## What changed

The country gate — the first thing an authenticated visitor sees in the map
card — is now an **orthographic globe drawn on a plain 2D `<canvas>` with
d3-geo**. The previous MapLibre GL implementation is retired: the WebGL globe
proved fragile in practice (context loss, driver blacklists, dependence on a
remote style/tile host) and country hover/selection through `feature-state`
hit-testing was unreliable. In the canvas engine every pixel is drawn by us
and picking is pure geometry (`projection.invert` + `d3.geoContains`), so the
initial render and the country selection can no longer miss.

The gate is now the *start* of a locked country view rather than a one-off
hand-off: picking a country pins the working map to it (tight `maxBounds` +
zoom floor, basemap untouched) and the search-bar country dock takes over
switching from there — see **COUNTRY_SELECTION_DOCK.md**.

Files:

- `js/globe-country-picker.js` — the whole feature (canvas globe engine,
  hover/click picking, fly-to animation, Leaflet handoff, persistence) plus
  the country-switching / locked-view API the dock uses
  (`listCountries`, `selectCountry`, `isLocked`, `unlock`, `exitView`).
- `css/globe-country-picker.css` — gate overlay, legend, zoom buttons,
  loading/error states, "Change Country" pill.
- `js/country-dock.js` + `css/country-dock.css` — the search-bar country dock,
  the World-hillshade checkbox and the "Exit view" button of the locked
  country view (see COUNTRY_SELECTION_DOCK.md).
- `js/d3.min.js` (7.9.0), `js/topojson-client.min.js` (3.1.0) — lazy-loaded
  **local** libraries (no CDN dependency; both precached by `sw.js`).
- `data/countries-50m.json` — world-atlas 2 TopoJSON, the primary country
  geometry, shipped with the site (public CDN mirror as fallback).
- `images/globe/earth-blue-marble.jpg`, `images/globe/earth-topology.png` —
  the Earth texture and the elevation map used for hillshading.
- `tools/globe-gate-preview.html` — dev-only harness that opens the gate
  without auth/Leaflet for visual checks.
- `js/maplibre-gl.js` / `css/maplibre-gl.css` — **deleted**.

## How the globe is drawn

1. **Base layer (raster).** For every canvas pixel inside the globe disc the
   inverse orthographic mapping gives a lon/lat, which samples a 2048×1024
   Blue Marble texture; a hillshade factor derived from `earth-topology.png`
   and a limb-darkening term shade it. The base layer is cached on an
   offscreen canvas and only rebuilt when rotation/zoom/size change —
   coarse (step 3) while dragging, refined to full resolution ~140 ms after
   the interaction stops. If the texture can't load, countries render over a
   flat land fill (`topojson.merge` of the atlas) — the gate never blocks on
   images.
2. **Vector overlay.** Every European country (same 50-ISO list as the
   retired flat picker) is drawn per frame with `d3.geoPath`: translucent
   grey-violet fill (`#6b5f82` @ 34%), black border over a pale casing.
   Hover = translucent **neon green** (`#39ff14`) + name label; micro-states
   (Malta, Monaco, Vatican…) get a ring marker when they'd be sub-pixel.
3. **Geometry sources.** `data/countries-50m.json` (local, instant) builds
   the gate; overseas territories are trimmed by polygon-centroid windows
   (France keeps metropolitan France, Russia draws fully but hands off only
   its European bbox). In the background the module then tries to stream the
   Natural Earth **10m** shapefile from the Supabase bucket
   (`.../Harti/ne_10m_admin_0_countries.shp`, matched to atlas countries by
   centroid containment) and swaps in the finer coastlines when it arrives —
   purely an enhancement, never a dependency.
4. **Interaction.** Pointer drag rotates (speed scaled by zoom), wheel and
   the on-screen +/− buttons zoom, two-finger pinch works on touch. The
   globe auto-spins slowly until the first interaction. Hover/click picking
   is exact point-in-polygon with a 12 px screen tolerance so micro-states
   stay clickable.
5. **Selecting a country.** A click flies the camera to the country
   (smoothstep rotation + zoom fitted to the country's angular size), then
   hands off to the existing Leaflet map exactly like before:
   `window._detectlabSelectedCountry` / `..Name` / `..Bounds` +
   the `_detectlabCountryLayer` shim (so `filterLayersForCountry()` in
   `js/map-app.js` keeps working unmodified), locking, and the
   `detectlab:country-selected` CustomEvent. The lock is deliberately tight —
   `maxBounds` = country bbox padded by 0.15° with viscosity 1, and the zoom
   floor one reachable step below the fitted zoom (Leaflet snaps zooms to whole
   levels; opening zoom capped at 11 for micro-states) — and **never touches the
   basemap**: a selection only moves the camera. The `<html>` element gets `country-view-locked` and a
   `detectlab:country-lockchange` event fires, which is what the dock's
   "Exit view" button reacts to (COUNTRY_SELECTION_DOCK.md).
6. **Persistence & re-entry.** Unchanged: the `{iso, name, bbox}` selection
   is saved to `localStorage['detectlab_selected_country_v1']`, returning
   visitors skip the globe entirely, and the "Change Country" pill reopens
   it.
7. **Failure mode.** If d3/topojson/the atlas can't load at all, a plain
   `<select>` of countries (static name table, `APPROX_CENTER` bboxes)
   replaces the canvas so the gate never hard-locks the app.
8. **Search bar follows the selection.** Once a non-RO country is active,
   the map search bar serves that country's localities, streamed from the
   project's Supabase `europe-places.geojsonseq` (NDJSON/RFC 8142, filtered
   per country while streaming — only the selected country stays in memory).
   Romania keeps the richer `OSM.geojson` source (real counties + manual
   additions). See `osmPlaceLookup` / `europePlaceLookup` in `js/map-app.js`
   and `test-europe-places-search.js`.

## Notes for future changes

- `sw.js` (cache `v167`) precaches the picker, d3, topojson-client, the atlas
  and the country dock; the two texture images are intentionally **not**
  precached (≈1.8 MB, and the texture-less fallback looks fine offline).
- Two suites guard this area: `node test-globe-canvas-picker.js` (globe,
  picking, geometry) and `node test-country-dock.js` (country list API, lock
  maths, dock UI, hillshade, exit view).
- Country name → ISO resolution uses the bundled EN/RO name dictionary
  (`NAMES`, incl. `alt` spellings such as "Bosnia and Herz.", "Macedonia",
  "Vatican" used by world-atlas). `test-globe-canvas-picker.js` asserts all
  50 countries resolve from the shipped atlas and that picking works — run
  `node test-globe-canvas-picker.js` after touching any of this.
- The module exposes `window.DetectLabGlobeGate` with the same API as
  before (`attach/open/close/hasSelection/reset/getSelection`), plus the
  country-switching / lock API the dock builds on
  (`listCountries/nameOf/selectCountry/prefetch/isLocked/getLockZoom/unlock/exitView`)
  and a `_test` hook for the node suites.
