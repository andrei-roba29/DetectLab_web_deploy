# Spain LiDAR layer — IGN/IDEE relief (PNOA-LiDAR MDT) over WMTS

The Spain row of the LiDAR panel now fetches the **"Relieve"** (shaded relief)
tiles of Spain's national LiDAR-derived digital terrain model, live from the
Instituto Geográfico Nacional's IDEE tile service, as the user pans and zooms.
Nothing is downloaded or pre-generated.

| | |
| --- | --- |
| Service | `https://servicios.idee.es/wmts/mdt` (WMTS 1.0.0, GeoServer/GeoWebCache) |
| Layers used | `Relieve` (default), `EL.ElevationGridCoverage` (dropdown) |
| Tile matrix set | `GoogleMapsCompatible` — EPSG:3857, 256 px, **levels 0…20** |
| Format | `image/png` |
| Key / token | **none, and none must be added** |
| Licence | CC BY 4.0 (`scne.es`); access constraints: *"No se aplican condiciones"* |
| Attribution | `Relieve © Instituto Geográfico Nacional de España (CC BY 4.0)` |

Code: **`js/ign-mdt-layer.js`** (all configuration in one block at the top),
wired into the Spain row of `js/map-app.js` / `index.html`.
Tests: **`node test-spain-idee-relieve.js`** (74 checks).

---

## 1. What was verified before coding (2026-10-06, live)

From `GET https://servicios.idee.es/wmts/mdt?service=WMTS&request=GetCapabilities&version=1.0.0`:

| Question | Answer from the live service |
| --- | --- |
| Exact relief layer identifier | **`Relieve`** — Title *"Sombreado del Relieve"*, hillshade of the MDT at a **25 m** grid, completed offshore/worldwide with GEBCO 2021, EMODnet and Copernicus DEM v1.1 |
| Styles | `Relieve` is declared; `style=default` is also accepted (returns a cached tile) |
| Formats | `image/jpeg`, `image/png` → **PNG chosen**, so the basemap shows through |
| Min/max zoom | `GoogleMapsCompatible` `TileMatrixSetLimits` run **0 … 20** ⇒ `maxNativeZoom = 20` (read from the capabilities, not guessed) |
| Covered extent | `Relieve` itself is published with a *global* bounding box (−179 −89 → 179 89) because of the bathymetry fill. The Spanish MDT extent is the one on `EL.ElevationGridCoverage`: **−18.211 27.634 → 4.779 43.944** = peninsula + Balearics + **Canary Islands**. The layer is clipped to that box. |
| Other useful layers | **`EL.ElevationGridCoverage`** — *"Modelo Digital del Terreno"*, built from **PNOA-LiDAR 2nd coverage, class 2 (ground), 2 m grid** (5 m 1st-coverage MDT in south-west Castilla y León); same tile matrix set, PNG/JPEG. This is the dropdown's second entry. **There is no slope layer and no separate hypsometric layer on this service.** |
| Tile request works? | `…&layer=Relieve&style=default&tilematrixset=GoogleMapsCompatible&format=image/png&TileMatrix=12&TileRow=1544&TileCol=2002` → **HTTP 200, `content-type: image/png`, 48 507 bytes**, `geowebcache-cache-result: HIT` |
| z/x/y mapping | The response's `geowebcache-tile-bounds: -450061.22,4921321.63,-440277.28,4931105.57` and `geowebcache-crs: EPSG:3857` match the standard XYZ tile (12/2002/1544) to the centimetre ⇒ **`TileMatrix={z}`, `TileCol={x}`, `TileRow={y}` with no conversion**. (GeoWebCache's internal bottom-origin index `[2002, 2551, 12]` is an implementation detail; the WMTS row in the URL is the normal top-origin XYZ `y`.) |
| HTTPS / mixed content | HTTPS end to end, `strict-transport-security: max-age=31536000` ⇒ safe to load from the HTTPS site; no mixed-content block |
| CORS | **`access-control-allow-origin: *`** on the tile response (tested with a foreign `Origin`) ⇒ plain `<img>` tiles work, **and** `fetch()` / `crossOrigin="anonymous"` / canvas `getImageData()` reads are allowed too. The service also sends `x-frame-options: SAMEORIGIN` and `frame-ancestors 'self' *.idee.es *.ign.es *.cnig.es *.arcgis.com`, which only restricts iframing IGN's own pages — it does not affect tile images. |
| Licence / fees | `AccessConstraints`: *"No se aplican condiciones"*; `Fees`: **"CC BY 4.0 scne.es"**; contact `ign@transportes.gob.es` |

**Not verified (and not verifiable from a headless environment):**

* how the tiles actually *look*, and pixel-exact visual alignment with the
  DetectLab basemap — covered by the manual checklist in §6;
* the service's rate limits / fair-use thresholds — IGN publishes none for this
  cache; the implementation is deliberately conservative (see §5);
* behaviour of `EL.ElevationGridCoverage` at every zoom: one tile was fetched
  (200, `image/png`, 1 611 bytes, cache HIT) but its colour ramp was not
  inspected.

### Why not the previous WMS

The old Spain row called the INSPIRE WMS
`https://servicios.idee.es/wms-inspire/mdt` with
`LAYERS=EL.ElevationGridCoverage&STYLES=Elevaciones`. That style name is not
what the service publishes, and a dynamically rendered elevation coverage is
the wrong product for a relief overlay: requests returned 200 and drew nothing
useful. The WMTS cache above is the same data, pre-rendered, faster, and on the
exact XYZ grid Leaflet already uses. The old constant
(`SPAIN_LIDAR_WMS_URL`) is left in `js/map-app.js` for any external caller but
is no longer used to build the layer.

---

## 2. How to run

It is a static app — no build step.

```bash
cd /path/to/DetectLab_web_deploy
python3 -m http.server 8080      # or any static server
# open http://localhost:8080/index.html
```

Then: **LiDAR panel → "Spain · IGN relief (PNOA-LiDAR MDT)"** → toggle on,
pick a product in the dropdown, drag the opacity slider.

Run the tests:

```bash
node test-spain-idee-relieve.js
```

---

## 3. How to change the layer, the region or anything else

Everything tunable is in the single `CONFIG` block at the top of
`js/ign-mdt-layer.js`:

```js
var CONFIG = {
    WMTS_URL: 'https://servicios.idee.es/wmts/mdt',
    PROXY_URL: window.IGN_MDT_PROXY_URL || '',   // optional caching proxy / CDN
    DEFAULT_MODE: 'relieve',
    MODES: {
        relieve:   { label: '…', layer: 'Relieve',                  style: 'default' },
        elevacion: { label: '…', layer: 'EL.ElevationGridCoverage', style: 'default' }
    },
    TILE_MATRIX_SET: 'GoogleMapsCompatible',
    FORMAT: 'image/png',
    OPACITY: 0.7,
    MIN_ZOOM: 5,
    MAX_NATIVE_ZOOM: 20,     // real maximum from GetCapabilities
    MAX_ZOOM: 20,
    KEEP_BUFFER: 1,
    BOUNDS: [[27.63, -18.22], [43.95, 4.78]],
    ATTRIBUTION: 'Relieve © Instituto Geográfico Nacional de España (CC BY 4.0)'
};
```

* **Add another layer to the dropdown** → add an entry to `MODES` with the
  identifier exactly as GetCapabilities spells it. The `<select>` in
  `index.html` is re-filled from `window.IgnMdt.modeKeys()` at start-up, so no
  HTML change is strictly required.
* **Change the region** → edit `BOUNDS` (`[[southLat, westLng], [northLat, eastLng]]`).
  Leaflet then never requests a tile outside it. To show the worldwide relief
  that the `Relieve` layer also contains (GEBCO/EMODnet/Copernicus outside
  Spain), widen the bounds to `[[-85, -180], [85, 180]]`.
* **Change the default opacity** → `OPACITY` (the slider in `index.html` starts
  at the matching `value="70"`).
* **Put a cache in front of the public server** → set
  `window.IGN_MDT_PROXY_URL = 'https://your-cache.example.com/wmts/mdt'` before
  `map-app.js` runs; the query string is appended unchanged.

---

## 4. Licence and attribution

* Data: **Modelo Digital del Terreno de España / Sombreado del Relieve**,
  © Instituto Geográfico Nacional (IGN), derived from **PNOA-LiDAR** (second
  coverage, ground class, 2 m grid; 25 m grid for the relief shading), plus
  GEBCO 2021 / EMODnet / Copernicus DEM v1.1 outside the national territory.
* Licence declared by the service: **CC BY 4.0** (`Fees: "CC BY 4.0 scne.es"`),
  access constraints *"No se aplican condiciones"* — free reuse, including
  commercial, with attribution. See <https://www.scne.es/licencia.html> and
  <https://www.ign.es/web/ign/portal/informacion-licencias>.
* Required credit, shown in the Leaflet attribution control whenever the layer
  is on and in the ⓘ info popup:

  > **Relieve © Instituto Geográfico Nacional de España (CC BY 4.0)**

* IGN asks that reuse does not suggest IGN endorses your product, and that the
  source is cited as *"Sistema Cartográfico Nacional"* (scne.es) when the
  derived product is redistributed.

---

## 5. Being a good citizen of a public government server

The implementation deliberately keeps the request volume low:

* `keepBuffer: 1` — barely any off-screen preloading;
* `updateWhenZooming: false`, `updateWhenIdle: true` — no tile storm while the
  user drags or pinch-zooms;
* `bounds` clipped to Spain and `minZoom: 5` — no requests outside coverage;
* `maxNativeZoom: 20` — above z20 Leaflet upscales instead of requesting tiles
  that do not exist. (The relief itself is a 25 m grid, so beyond roughly z15
  no new detail appears, only smoother upsampling — lowering
  `MAX_NATIVE_ZOOM` to 16 is a legitimate way to cut requests further.)
* **For production, put a caching proxy or CDN in front of the service.** Tiles
  are static (`last-modified: 2024`), so a long TTL is safe and polite.

### Nginx caching proxy (7 days)

```nginx
proxy_cache_path /var/cache/nginx/idee levels=1:2 keys_zone=idee:50m
                 max_size=10g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name mdt-cache.example.com;

    location /wmts/mdt {
        proxy_pass         https://servicios.idee.es/wmts/mdt;
        proxy_set_header   Host servicios.idee.es;
        proxy_ssl_server_name on;

        proxy_cache        idee;
        proxy_cache_key    "$request_uri";
        proxy_cache_valid  200 7d;          # tiles: one week
        proxy_cache_valid  404 1h;          # "no tile here": short
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_lock   on;              # one upstream fetch per tile
        add_header         X-Cache-Status $upstream_cache_status;

        add_header         Cache-Control "public, max-age=604800";
        add_header         Access-Control-Allow-Origin "*";
    }
}
```

Then set `window.IGN_MDT_PROXY_URL = 'https://mdt-cache.example.com/wmts/mdt';`.

### Cloudflare Worker (7 days)

```js
export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    const upstream = new URL('https://servicios.idee.es/wmts/mdt');
    upstream.search = incoming.search;

    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    const cache = caches.default;

    let response = await cache.match(cacheKey);
    if (response) return response;

    response = await fetch(upstream.toString(), { cf: { cacheTtl: 604800, cacheEverything: true } });
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
    response.headers.set('Access-Control-Allow-Origin', '*');
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
```

---

## 6. Manual test checklist

1. **Alignment, Madrid.** Zoom to Madrid at **z12** with the Spain row on at
   70 % opacity. The **Sierra de Guadarrama** ridge north-west of the city must
   sit exactly on the mountains of the basemap; the Manzanares and Jarama
   valleys must line up with the rivers. No half-tile offset anywhere.
2. **Network.** DevTools → Network, filter `wmts/mdt`: every tile request is
   **200** with `content-type: image/png`, and most carry
   `geowebcache-cache-result: HIT`. No 400, 403 or 404 inside Spain.
3. **Toggle.** Switching the row off removes every tile and the attribution
   line; switching it back on restores both.
4. **Opacity slider.** 0 % → invisible, 100 % → opaque; the percentage label
   follows, and the setting survives a product switch.
5. **Dropdown.** Switch to *"Elevación · INSPIRE colour ramp"*: the URLs change
   to `layer=EL.ElevationGridCoverage`, the tiles redraw, no layer flicker.
   Switch back to *Relieve*.
6. **Canary Islands.** Fly to Tenerife (28.29 N, 16.62 W): relief is present —
   the Teide cone is unmistakable — proving the bounds include the Canaries.
7. **Outside coverage.** Pan to France or Morocco: no tile requests are made at
   all (bounds clipping), the console stays quiet and no broken-image icons
   appear.
8. **Deep zoom.** Zoom to z20 over a quarry or hillfort: tiles are still
   requested up to 20 and no error appears; past z20 Leaflet upscales.
9. **Console.** Over a whole session there is at most **one**
   `[IgnMdt] some … tiles are unavailable` warning, never one per tile.
10. **Other countries untouched.** Norway, Poland and the Netherlands rows
    still behave exactly as before.

---

## 7. Known limitations

* **Resolution of the shading.** `Relieve` is rendered from a **25 m** MDT, not
  from the 1 m/2 m LiDAR grid, so it is a landscape-scale relief, not a
  micro-topography product. For archaeological micro-relief in Spain the
  PNOA-LiDAR point clouds themselves (CNIG download centre) are still needed —
  there is no public national 1 m hillshade WMS/WMTS at the time of writing.
* **The `Relieve` layer is global.** Outside Spain it shows GEBCO/EMODnet
  bathymetry and Copernicus relief. The layer is clipped to the Spanish MDT
  extent on purpose; widening `BOUNDS` would silently turn it into a worldwide
  relief layer.
* **No GetFeatureInfo-based elevation readout** is wired up, although the
  service declares `text/plain` info formats for both layers.
* **`style=default`** is used because the live service accepts it for both
  layers; the capabilities also declare named styles. If IGN ever tightens
  style validation, set `style` per mode in `CONFIG.MODES`.
* **Service-side caching dates from 2024** (`last-modified`), so a tile may lag
  behind the newest PNOA-LiDAR coverage.
* IGN publishes no SLA for this endpoint. A transient outage shows as
  transparent tiles plus one console warning, never as broken images.
