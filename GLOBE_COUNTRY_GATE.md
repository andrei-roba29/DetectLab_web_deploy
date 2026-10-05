# 3D Globe Country Gate

## What changed

The old flat Leaflet-based country picker (`js/country-selector.js` +
`css/country-selector.css`) is retired. In its place, the **first thing an
authenticated visitor sees in the map card** is now a real 3D globe:
MapLibre GL JS in `globe` projection, rendering the whole Earth with
atmosphere/sky shading, slowly auto-rotating until the visitor interacts
with it.

New files:

- `js/globe-country-picker.js` — the whole feature (fetch/parse, globe
  construction, hover/click, Leaflet handoff, persistence).
- `css/globe-country-picker.css` — the gate overlay, legend, loading/error
  states, "Change Country" pill.

## Behaviour

1. **Login gate → globe gate.** `js/map-app.js` calls
   `window.DetectLabGlobeGate.attach(leafletMap)` right after the Leaflet
   map is constructed. The module listens for `detectlab:authchange`
   (dispatched by `js/auth.js`) and opens the globe the moment a session is
   confirmed — unless the visitor already picked a country before (see
   Persistence below), in which case the globe never has to load at all.
2. **Countries, styled as requested.** Every European country (plus a few
   immediate neighbours — same list the old picker used) is tinted a
   translucent grey-violet (`#6b5f82` @ 34% opacity) with a solid **black**
   outline. Hovering a country swaps its fill to translucent **neon green**
   (`#39ff14`) using MapLibre `feature-state`, with all polygons that belong
   to the same ISO code (islands, exclaves…) highlighted together.
3. **Data source.** The polygons are streamed (NDJSON / GeoJSONSeq, parsed
   incrementally so a large file never blocks the main thread) from the
   project's Supabase bucket:
   `.../storage/v1/object/public/Harti/europe-places.geojsonseq`.
   If that payload is unreachable, too small, or doesn't yield at least 15
   recognisable countries, the module **silently falls back** to a public
   Natural Earth country-outline file so the feature never hard-locks the
   app. If WebGL itself is unavailable, a plain `<select>` of countries
   (built from a static name table, no network required) replaces the 3D
   canvas entirely.
4. **Selecting a country.** Clicking a country flies the camera to it, then
   hands off to the existing Leaflet map:
   - `window._detectlabSelectedCountry` / `..CountryName` / `..CountryBounds`
     are set, plus a tiny shim on `window._detectlabCountryLayer` so the
     pre-existing `filterLayersForCountry()` in `js/map-app.js` keeps working
     unmodified (it hides any layer catalogue row whose coverage rectangle
     doesn't intersect the selected country).
   - The Leaflet map gets `setMaxBounds()` (padded 25% around the country)
     and a `setMinZoom()` computed from `getBoundsZoom()`, so the visitor can
     pan/zoom freely **inside** the country but can never scroll out to see
     the rest of the globe again.
   - `document.dispatchEvent(new CustomEvent('detectlab:country-selected', …))`
     fires for any other widget that wants to react.
5. **Persistence & re-entry.** The chosen `{iso, name, bbox}` is saved to
   `localStorage['detectlab_selected_country_v1']`. Returning visitors skip
   the globe entirely — the map opens straight into their country. A
   "Change Country" pill (top-right of the map card, only visible once a
   country is active) reopens the globe gate to pick a different one.
6. **Logout safety.** If the user logs out while the globe gate happens to
   be open, the gate force-closes so the existing `#mapAuthGate` / login
   modal (both rendered above it) stay reachable.

## Notes for future changes

- Country name/ISO detection tries `ISO_A2`/`ISO3166-1-Alpha-2`-style
  properties first, then falls back to a bundled EN/RO name dictionary
  (`NAMES` in `js/globe-country-picker.js`) — this covers both the Supabase
  dataset and the Natural Earth fallback regardless of their exact schema.
- The MapLibre library itself is lazy-loaded from unpkg
  (`maplibre-gl@5.16.0`) only the first time the gate actually has to
  render, so visitors who never see the gate (returning users, logged-out
  visitors) never pay for it.
- The base globe style is OpenFreeMap's `dark` style (no API key needed).
