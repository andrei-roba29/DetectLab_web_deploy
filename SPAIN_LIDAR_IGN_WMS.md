# Spain LiDAR layer — IDEE/IGN "Mapa LiDAR" over WMS

The Spain row of the LiDAR panel streams the **"Mapa LiDAR"** service of
Spain's national SDI (IDEE, run by the Instituto Geográfico Nacional / CNIG):
a shaded LiDAR digital **surface** model with the PNOA-LiDAR vegetation and
building heights and the SCN hydrography on top, rendered per tile as the user
pans and zooms. Nothing is downloaded or pre-generated.

| | |
| --- | --- |
| Service | `https://wms-mapa-lidar.idee.es/lidar` (WMS, MapServer behind Apache) |
| Layer | `EL.GridCoverage` — Title *"Mapa LiDAR"*, queryable, style `default` |
| Version used | **1.1.1** → the projection parameter is `SRS=`, not `CRS=` |
| Projection | `EPSG:3857` (Web Mercator); the service also advertises 4326, 4258, 25828-31, 32628-31, CRS:84, 3035, 4083 |
| Format | `image/png`, transparent, 256 × 256 per tile (service MaxWidth/Height 4096) |
| Tiled | `TILED=TRUE`, `CONTINUOUSWORLD=TRUE` (MapServer tiling hints) |
| Keys / tokens | **none, and none must be added** |
| Licence | CC BY 4.0 (`http://www.scne.es/#Mapa-LiDAR`); access constraints *"no se aplican condiciones"* |
| Attribution | `Mapa LiDAR © IDEE · Instituto Geográfico Nacional / CNIG — Sistema Cartográfico Nacional (CC BY 4.0)` |

Code: **`js/ign-mdt-layer.js`** (all configuration in one block at the top),
wired into the Spain row of `js/map-app.js` / `index.html`.
Tests: **`node test-spain-mapa-lidar-wms.js`** (95 checks).

> The module keeps its original file name (`ign-mdt-layer.js`) and its
> `window.IgnMdt` global on purpose, so the map wiring and the other country
> test suites keep working unchanged. The *service* it talks to is new.

---

## 1. What was verified before coding (2026-10-07, live)

From `GET https://wms-mapa-lidar.idee.es/lidar?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`
(and the same request with `VERSION=1.3.0`):

| Question | Answer from the live service |
| --- | --- |
| Title / owner | **Modelo Digital de Superficies LiDAR de España** — IDEE / SCNE / IGN, contact `ign@fomento.es` |
| What the product is | A **shaded LiDAR surface model** built from the **PNOA-LiDAR** point clouds with three overlays: two **normalized surface models** — vegetation and buildings — colour-ramped by height, plus the **rasterized hydrography** of the Sistema Cartográfico Nacional. INSPIRE theme *Elevaciones*. IGN states that **building and vegetation heights can be read from ≈1:20 000** |
| Layers | **exactly one: `EL.GridCoverage`**, Title *"Mapa LiDAR"*, `queryable="1"`, SCNE identifier `mapa_lidar`. There is no second product to switch to |
| Styles | one: **`default`** (*"Estilo por defecto del mapa lidar"*); an empty `STYLES=` selects it |
| Extent | `EX_GeographicBoundingBox` **−19 27 → 5 44** (peninsula, Balearics **and Canaries**); `BoundingBox CRS="EPSG:3857"` **−2 115 070 / 3 123 470 → 556 597 / 5 465 440** |
| Formats | `image/png` (chosen), `image/jpeg`, `image/gif`, `image/png; mode=8bit`, `image/tiff`, `application/x-pdf`, `image/svg+xml` |
| GetFeatureInfo | `text/html`, **`text/xml`**, `application/vnd.ogc.gml`, `application/json`, `text/plain` |
| A real tile | `…&SERVICE=WMS&REQUEST=GetMap&LAYERS=EL.GridCoverage&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&VERSION=1.1.1&CONTINUOUSWORLD=true&TILED=true&INFO_FORMAT=text%2Fxml&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&BBOX=…` → **HTTP 200, `content-type: image/png`, 256 × 256**, e.g. 151 362 bytes for the z12/x2002/y1544 tile (Toledo/Madrid area) and 145 617 bytes for the reference BBOX in the brief |
| Headers on a tile | `access-control-allow-origin: *`, `cache-control: max-age=31536000`, `strict-transport-security: max-age=31536000`, `server: Apache/2.4.6 (CentOS) mod_fcgid/2.3.9` |
| Identify | `INFO_FORMAT=text/xml` answered *"Altura vegetación: 4.1 m"* at one point and *"Altura edificio: 19.3 m"* at another, under the title *"Altura sobre el suelo"* (internal sub-layers `gfi-vegetacion-h30`, `gfi-edificacion-…`, `lidar-teselado`); on no-data points it answers `Search returned no results.` (no error) |
| Errors | an unknown `LAYERS=` returns a MapServer text error (`msWMSLoadGetMapParams(): … Invalid layer(s)`), so the module always sends `EL.GridCoverage` |
| Coverage edge | a tile over Paris still answers **HTTP 200 `image/png`** — a transparent blank (334 bytes) — so a stray tile outside Spain degrades to "nothing drawn", never to an error icon |

> The tile and identify requests above were issued with the exact KVP the
> module emits, through a fetching proxy (`api.microlink.io`), from a build
> container that has no direct route to `idee.es`. Re-run any of them in a
> normal browser/network and the same response arrives directly.

**Not verified (and not verifiable from a headless environment):**

* how the tiles actually *look* and pixel-exact alignment with the basemap —
  covered by the manual checklist in §6;
* the service's rate limits / fair-use thresholds — IGN publishes none, and the
  implementation is deliberately conservative (§5);
* which PNOA-LiDAR coverage each area comes from: a Tenerife tile is a fully
  rendered 157 kB PNG, so the extent is right, but IGN's metadata for the
  Mapa LiDAR product (CSW record `spaign_mapa_lidar_cob2`) is titled
  *"Mapa LIDAR 2ª Cobertura (2015-actualidad)"*, while the archived INSPIRE
  metadata of the service describes the first coverage — the service itself
  does not say per tile;

### Why not the previous sources

* The row first asked the INSPIRE WMS `servicios.idee.es/wms-inspire/mdt` for
  `EL.ElevationGridCoverage` with `STYLES=Elevaciones` — a style name the
  service does not publish, and the wrong product anyway (a bare terrain
  model, not the LiDAR heights).
* It then used the WMTS relief cache `servicios.idee.es/wmts/mdt`
  (`Relieve` hillshade) — a 25 m *terrain* shading, i.e. again not the LiDAR
  surface model.
* Both endpoints are now **gone from the shipped files** (`map-app.js`,
  `index.html`, `js/ign-mdt-layer.js`, `sw.js`): `SPAIN_LIDAR_WMTS_URL` and
  the dead `SPAIN_LIDAR_WMS_URL` pointing at the INSPIRE service are removed,
  `window.SPAIN_LIDAR_WMS_URL` now holds the Mapa LiDAR endpoint, and
  `idee.es` was added to `PASSTHROUGH_HOSTS` in `sw.js` so these tiles never
  enter the app-shell cache path.

---

## 2. How to run

It is a static app — no build step.

```bash
cd /path/to/DetectLab_web_deploy
python3 -m http.server 8080      # or any static server
# open http://localhost:8080/index.html
```

Then: **LiDAR panel → "Spain · IGN relief (PNOA-LiDAR MDT)"** → toggle on,
drag the opacity slider. (The row label is kept as the user-facing name of the
row; the product behind it is the Mapa LiDAR MDS described above.)

Run the tests:

```bash
node test-spain-mapa-lidar-wms.js
```

## 3. How to change the layer, the extent or anything else

Everything tunable is in the single `CONFIG` block at the top of
`js/ign-mdt-layer.js`:

```js
var CONFIG = {
    WMS_URL: 'https://wms-mapa-lidar.idee.es/lidar',
    PROXY_URL: window.SPAIN_LIDAR_PROXY_URL || '',   // optional caching proxy / CDN
    DEFAULT_MODE: 'mapa_lidar',
    MODES: {
        mapa_lidar: { label: '…', layer: 'EL.GridCoverage', styles: '' }
    },
    VERSION: '1.1.1',        // → SRS= (not CRS=)
    SRS: 'EPSG:3857',
    FORMAT: 'image/png', TRANSPARENT: true,
    TILED: true, CONTINUOUSWORLD: true,
    INFO_FORMAT: 'text/xml',
    OPACITY: 0.7,
    MIN_ZOOM: 5,
    MAX_NATIVE_ZOOM: 20, MAX_ZOOM: 20,
    TILE_SIZE: 256, KEEP_BUFFER: 1, CROSS_ORIGIN: false,
    BOUNDS: [[27, -19], [44, 5]],
    ATTRIBUTION: '…'
};
```

* **Change the region** → edit `BOUNDS` (`[[southLat, westLng], [northLat, eastLng]]`).
  Leaflet then never requests a tile outside it. The value is the extent the
  capabilities declare; shrinking it (e.g. peninsula + Balearics only,
  `[[35.5, -9.6], [44, 4.6]]`) is a legitimate way to cut requests to the
  government server, at the cost of dropping the Canaries.
* **Change the zoom window** → `MIN_ZOOM` / `MAX_ZOOM` / `MAX_NATIVE_ZOOM`.
  The WMS renders on demand and has no tile pyramid of its own, so these are
  policy choices, not service limits; the published product is informative up
  to roughly 1:20 000 (≈ z14-15), above which the raster is simply upsampled.
* **Change the default opacity** → `OPACITY` (the slider in `index.html`
  starts at the matching `value="70"`).
* **Add a product** → add an entry to `MODES` with the identifier exactly as
  GetCapabilities spells it (`<select>` is refilled from
  `window.IgnMdt.modeKeys()` at start-up). Today the service publishes only
  `EL.GridCoverage`.
* **Put a cache in front of the public server** → set
  `window.SPAIN_LIDAR_PROXY_URL = 'https://your-cache.example.com/lidar'` before
  `map-app.js` runs; the query string is appended unchanged. The tiles already
  carry `cache-control: max-age=31536000`, so a long TTL is safe and polite.

---

## 4. Licence and attribution

* Data: **Mapa LiDAR — Modelo Digital de Superficies LiDAR de España**,
  © **IDEE / Instituto Geográfico Nacional (IGN) — CNIG**, built from
  **PNOA-LiDAR** coverage, plus the hydrography of the *Información
  Geográfica de Referencia* of the Sistema Cartográfico Nacional.
* Licence declared by the service: **CC BY 4.0** (`AccessConstraints: "CC BY 4.0
  http://www.scne.es/#Mapa-LiDAR"`, `Fees: "no se aplican condiciones"`) — free
  reuse, including commercial, with attribution.
  See <https://www.scne.es/licencia.html> and
  <https://www.ign.es/web/ign/portal/informacion-licencias>.
* Required credit, shown in the Leaflet attribution control whenever the layer
  is on and in the ⓘ info popup:

  > **Mapa LiDAR © IDEE · Instituto Geográfico Nacional / CNIG — Sistema Cartográfico Nacional (CC BY 4.0)**

* IGN asks that reuse does not suggest IGN endorses your product, and that the
  source is cited as *"Sistema Cartográfico Nacional"* (scne.es) when the
  derived product is redistributed.

---

## 5. Being a good citizen of a public government server

The implementation deliberately keeps the request volume low:

* `keepBuffer: 1` — barely any off-screen preloading;
* `updateWhenZooming: false`, `updateWhenIdle: true` — no tile storm while the
  user drags or pinch-zooms;
* `bounds` clipped to the declared extent and `minZoom: 5` — no requests
  outside coverage, and no 1:500 000-scale tiles nobody looks at;
* `TILED=TRUE` tells MapServer this BBOX is one cell of a grid, so it does not
  re-lay out labels/symbols for every request;
* `errorTileUrl` = transparent 1×1 PNG and **one** console warning per layer,
  so an outage shows as an empty layer, never as broken-image icons or a
  console flood.

### Nginx caching proxy (7 days)

```nginx
proxy_cache_path /var/cache/nginx/lidar levels=1:2 keys_zone=lidar:50m
                 max_size=10g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name lidar-cache.example.com;

    location /lidar {
        proxy_pass         https://wms-mapa-lidar.idee.es/lidar;
        proxy_set_header   Host wms-mapa-lidar.idee.es;
        proxy_ssl_server_name on;

        proxy_cache        lidar;
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

Then set `window.SPAIN_LIDAR_PROXY_URL = 'https://lidar-cache.example.com/lidar';`.

### Cloudflare Worker (7 days)

```js
export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    const upstream = new URL('https://wms-mapa-lidar.idee.es/lidar');
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

1. **Rendering, Madrid.** Zoom to Madrid at z12 with the Spain row on at 70 %.
   Building blocks must be tinted **red** and parks/trees **green** over the
   grey shaded surface, and the Manzanares/Jarama water must be **blue**. The
   lines must sit exactly on the basemap (no half-tile offset anywhere).
2. **Network.** DevTools → Network, filter `wms-mapa-lidar`: every tile request
   is **200** with `content-type: image/png`, carries
   `access-control-allow-origin: *`, and asks `SRS=EPSG%3A3857` (never `CRS=`),
   `VERSION=1.1.1`, `LAYERS=EL.GridCoverage`, `WIDTH=256&HEIGHT=256`.
3. **Toggle / opacity.** Switching the row off removes every request and the
   attribution line; the slider goes from invisible (0 %) to opaque (100 %) and
   the percentage label follows.
4. **Canary Islands.** Fly to Tenerife (28.29 N, 16.62 W): tiles are still
   requested — the declared extent includes the archipelago.
5. **Outside coverage.** Pan to Paris or Rabat: no tile requests at all
   (bounds clipping), the console stays quiet, no broken-image icons.
6. **Deep zoom.** Zoom to z20 over a quarry or hillfort: requests continue
   (the WMS renders on demand) and no error appears.
7. **Console.** Over a whole session there is at most **one**
   `[IgnMdt] a "EL.GridCoverage" tile could not be loaded…` warning, never one
   per tile — and none at all during normal use.
8. **Other countries untouched.** Norway, Poland, Netherlands, Switzerland,
   England, France, Denmark and Sweden rows still behave exactly as before.

---

## 7. Known limitations and differences from the previous layer

* **Different product.** The row now shows the **Mapa LiDAR surface model**
  (buildings/vegetation/water over a shaded DSM), not a hillshade of the bare
  terrain. Both are "LiDAR", but a user who knew the old relief will notice the
  red/green overlays. The underlying data are the PNOA-LiDAR point clouds
  (IGN's CSW record for the product is *"Mapa LIDAR 2ª Cobertura
  (2015-actualidad)"*), so this is not a terrain model either.
* **The row label still reads "Spain · IGN relief (PNOA-LiDAR MDT)"**, because
  the layer's display name was deliberately kept unchanged. It now under-
  describes the product; renaming it is a one-line change in `index.html` +
  `js/map-app.js` if wanted.
* **The product dropdown has a single entry** — the service publishes one
  layer, so the retired *Relieve / Elevación* pair cannot be reproduced. The
  `<select>` and `setSpainLidarMode()` wiring stay in place (they are filled
  from the module at start-up), so adding a second product later needs no HTML
  change.
* **Identify is service-supported but not wired to the UI.** The previous layer
  had no click behaviour, so none was added to avoid disturbing the panel's tap
  handling. The request is ready for whoever wires it:
  `window.IgnMdt.featureInfoUrl(mode, bbox, size, x, y)` /
  `layer.getFeatureInfoUrl(latLng)` with `INFO_FORMAT=text/xml`; the service
  answers with the vegetation/building height at that pixel
  (*"Altura vegetación: 4.1 m"*), and `Search returned no results.` where there
  is no data.
* **Styling is IGN's own.** Vegetation green, buildings red, water blue over a
  grey shaded surface; there is no style parameter to change that (the service
  publishes a single `default` style).
* **Dynamic rendering.** Unlike the retired WMTS cache there are no
  pre-generated tiles, so the first view of an area costs a render on IGN's
  side; the server does send `cache-control: max-age=31536000`, which the
  browser honours. For production, putting the caching proxy of §5 in front of
  it (or relying on the browser cache) is the polite option.
* **No SLA.** A transient outage shows as transparent tiles plus one console
  warning, never as broken images.
