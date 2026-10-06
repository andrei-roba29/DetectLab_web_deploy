# England LiDAR layer — Environment Agency LIDAR Composite over WMTS

The UK row of the LiDAR panel now fetches the **Environment Agency LIDAR
Composite hillshade of the 1 m digital terrain model** live from the official
public WMTS on `environment.data.gov.uk`, as the user pans and zooms. Nothing
is downloaded or pre-generated.

| | |
| --- | --- |
| Service | `https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wmts` (GeoServer + GeoWebCache, KVP WMTS 1.0.0) |
| Default layer | `Lidar_Composite_Hillshade_DTM_1m`, style `hillshade` |
| Tile matrix set | `WebMercatorQuad` = EPSG:3857, 256 px — the standard XYZ/OSM grid |
| Max zoom | **24** (WebMercatorQuad `TileMatrixSetLimits`, levels 0–24) |
| Coverage | **England only** (~99% of England at 1 m); not Scotland, Wales or Northern Ireland |
| Key / token | **none, and none must be added** |
| Licence | Open Government Licence v3.0 — "© Environment Agency copyright and/or database right 2022. All rights reserved." |

Code: **`js/ea-lidar-wmts-layer.js`** (all configuration in one block at the
top), wired into the UK row of `js/map-app.js` / `index.html`.
Tests: **`node test-uk-ea-lidar-wmts.js`** (84 checks).

---

## 1. What was verified before coding (2026-10-06, live)

GetCapabilities:
`https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wmts?service=WMTS&request=GetCapabilities&version=1.0.0`

| Question | Answer from the live service |
| --- | --- |
| Layer identifiers on this service | **`Lidar_Composite_Hillshade_DTM_1m`**, `Lidar_Composite_Elevation_DTM_1m`, `Lidar_Composite_DTM_1m` |
| Styles | GeoServer publishes an **empty default style** for all three (no named `<Style>` identifier). The documented example sends `style=hillshade`; the server accepts **both** `style=hillshade` and `style=` and returns the identical tile (verified byte-size/ETag-identical response headers, `geowebcache-cache-result: HIT` either way). The shading is baked into the layer, not selected by the style parameter. |
| Formats | `image/png` (used here), `image/jpeg`, `image/vnd.jpeg-png`, `image/vnd.jpeg-png8`, `image/png8`. **`transparent=true` is optional** — PNG tiles are already transparent outside the data. It is sent anyway, and is harmless. |
| TileMatrixSets | **`WebMercatorQuad`** (used here), `EPSG:900913`, `EPSG:4326`, `British National Grid`. WebMercatorQuad = EPSG:3857, 256 px, 2^z × 2^z ⇒ `tileMatrix = z`, `tileCol = x`, `tileRow = y`, no custom projection needed. |
| Min / max zoom | `TileMatrixSetLimits` for WebMercatorQuad run **level 0 → level 24** ⇒ **`maxNativeZoom: 24`** (read from the capabilities). Level 24 limits are rows 5 234 540–5 700 720, cols 8 057 504–8 485 839. |
| Extent (hillshade layer) | WGS84 **-7.104775741839742 49.85060473351981 → 2.0842821419111135 55.87708724246775** ⇒ Leaflet `bounds [[49.85060473351981, -7.104775741839742], [55.87708724246775, 2.0842821419111135]]` (the plain `Lidar_Composite_DTM_1m` publishes a slightly larger box, which the module carries per product) |
| Example tile | the documented `…&tileMatrix=15&tileRow=10989&tileCol=16183` → **200, `content-type: image/png`**, `geowebcache-cache-result: HIT`, `geowebcache-gridset: WebMercatorQuad`, tile bounds `-245821.48,6596821.29 → -244598.49,6598044.28` (EPSG:3857) — exactly the standard grid cell, so alignment is guaranteed |
| Max-zoom proof | Dorset at **z19 → 200 image/png** (`MISS`, rendered on demand), **z24 → 200 image/png**, **z25 → `text/xml`** ServiceException ⇒ the pyramid really stops at 24 |
| Outside coverage | A tile **outside the published limits** (Edinburgh, z13/4023/2552) returns **`content-type: text/xml`** — a GeoWebCache `ServiceException`, *not* a transparent PNG and *not* a 404 body you can draw. Inside the limits but over Wales/Scotland/the sea, you get a valid **empty (transparent) PNG**. Hence: clip the layer to the published bounds, and keep a transparent `errorTileUrl` for the rest. |
| CORS | Tile responses carry **`access-control-allow-origin: *`** (plus `vary: Origin`) ⇒ plain `<img>` tiles work, and so do `fetch()` and canvas `getImageData()`. **The XML exception responses carry no CORS header**, so a `fetch()`-based pipeline would see an opaque failure outside coverage — another reason to clip to bounds. `crossOrigin` is left off since `<img>` tiles need nothing. |
| HTTPS | HTTPS only, Cloudflare in front of GeoServer; no mixed content on an https page |
| Caching | `cache-control: max-age=120` (2 minutes!) + `last-modified` + `cf-cache-status: DYNAMIC`. The upstream rasters change roughly annually, so this TTL is far shorter than the data warrants — a caching proxy is worth it (§5). |

### Other layers found (reported, and which ones were wired in)

| Service | Layer | What it is | Max zoom | In the dropdown? |
| --- | --- | --- | --- | --- |
| `lidar-composite-digital-terrain-model-dtm-1m` | `Lidar_Composite_Hillshade_DTM_1m` | 1 m **terrain** hillshade | 24 | **yes (default)** |
| ″ | `Lidar_Composite_Elevation_DTM_1m` | same DTM, colour-ramped elevation | 24 | **yes** |
| ″ | `Lidar_Composite_DTM_1m` | plain grey terrain model (what the row used to show) | 24 | **yes** |
| `lidar-composite-digital-surface-model-last-return-dsm-1m` | `Lidar_Composite_Hillshade_LZ_DSM_1m` | 1 m **surface** hillshade (buildings, trees, structures) | 24 | **yes — this one comes from a sibling service; say the word and I'll drop it** |
| ″ | `Lidar_Composite_Elevation_LZ_DSM_1m`, `Lidar_Composite_LZ_DSM_1m` | colour / grey surface model | 24 | no |
| `…first-return-digital-surface-model-fz-dsm-1m` (exists per data.gov.uk) | first-return DSM | canopy tops | not read | no |
| DTM/DSM **2 m** and DTM **10 m** composites | — | coarser composites, same programme | not read | no — the 1 m layers already serve every zoom |

Everything else on the Defra platform (survey index catalogues WMS/WFS, the
OGC API-Features service, WCS) is metadata or download plumbing, not imagery.

### Not verifiable from here

Visual alignment and how the shading actually looks (a headless check cannot
judge pixels), and whether the Environment Agency applies a concrete request
quota — see §4. Both are covered by the manual checklist in §6.

### What changed in the app

The row previously rendered the same rasters through the **WMS**
(`…/geoservices/datasets/13787b9a-…/wms`, one GetMap render per tile) and
defaulted to `Lidar_Composite_DTM_1m`, the flat grey model. That endpoint still
works, but every tile was a fresh render. The WMTS serves the same pixels from
GeoWebCache (`HIT` on most requests), so it is faster for the user and much
kinder to the server — and the default is now the hillshade, which is what you
actually read earthworks from. `window.UK_LIDAR_WMS_URL` is kept for external
callers.

---

## 2. How to run

It is a static app — no build step.

```bash
cd /path/to/DetectLab_web_deploy
python3 -m http.server 8080      # or any static server
# open http://localhost:8080/index.html
```

Then: **LiDAR panel → "England · EA LIDAR hillshade (DTM 1 m)"** → toggle on,
pick a product, drag the opacity slider. The map flies to England when the row
is enabled.

Run the tests:

```bash
node test-uk-ea-lidar-wmts.js
```

---

## 3. How to change the layer, style, region or anything else

Everything tunable is in the single `CONFIG` block at the top of
`js/ea-lidar-wmts-layer.js`:

```js
var CONFIG = {
    HOST: 'https://environment.data.gov.uk',
    PROXY_HOST: window.EA_LIDAR_PROXY_HOST || '',   // optional caching proxy / CDN
    VERSION: '1.0.0',
    TILE_MATRIX_SET: 'WebMercatorQuad',   // = standard XYZ / EPSG:3857
    FORMAT: 'image/png',                  // percent-encoded in the URL
    TRANSPARENT: true,
    DEFAULT_MODE: 'hillshade',
    MODES: {
        hillshade:    { service: 'lidar-composite-digital-terrain-model-dtm-1m',
                        layer: 'Lidar_Composite_Hillshade_DTM_1m', style: 'hillshade',
                        maxNativeZoom: 24, bounds: [[49.8506…, -7.1047…], [55.8770…, 2.0842…]] },
        elevation:    { … 'Lidar_Composite_Elevation_DTM_1m' … },
        dtm:          { … 'Lidar_Composite_DTM_1m' … },
        dsmHillshade: { service: 'lidar-composite-digital-surface-model-last-return-dsm-1m',
                        layer: 'Lidar_Composite_Hillshade_LZ_DSM_1m', … }
    },
    OPACITY: 0.7, MIN_ZOOM: 6, MAX_ZOOM: 24, KEEP_BUFFER: 1,
    BOUNDS: [[49.85060473351981, -7.104775741839742],
             [55.87708724246775, 2.0842821419111135]],
    ATTRIBUTION: '© Environment Agency copyright and/or database right 2022 · …OGL v3.0…'
};
```

* **Add a layer to the dropdown** → one more `MODES` entry with the service
  path, the identifier exactly as GetCapabilities spells it, **its own
  `maxNativeZoom`** (from that layer's `TileMatrixSetLimits`) and **its own
  `bounds`** (from its `WGS84BoundingBox`). The `<select>` in `index.html` is
  refilled from `window.EaLidarWmts.modeKeys()` at start-up, so no HTML change
  is strictly required. Example (2 m composite, if you want a lighter layer):
  `{ label: 'Hillshade DTM 2 m', service: 'lidar-composite-digital-terrain-model-dtm-2m', layer: 'Lidar_Composite_Hillshade_DTM_2m', style: 'hillshade', maxNativeZoom: <read it>, bounds: <read it> }`.
* **Change the style** → `MODES[x].style`. These layers ignore it (empty
  default style), but the parameter is kept because the published example uses
  it and other Defra layers do have named styles.
* **Change the region** → `BOUNDS` / per-mode `bounds`
  (`[[southLat, westLng], [northLat, eastLng]]`). Leaflet then never requests a
  tile outside.
* **Change the default opacity** → `OPACITY` (the slider in `index.html` starts
  at the matching `value="70"`).
* **Put a cache in front of the service** → set
  `window.EA_LIDAR_PROXY_HOST = 'https://ea-lidar-cache.example.com'` before
  `map-app.js` runs; the rest of the path and query is appended unchanged.

### Other map libraries

The same template works everywhere, because WebMercatorQuad *is* XYZ:

```js
const TEMPLATE =
  'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wmts' +
  '?service=WMTS&request=GetTile&version=1.0.0' +
  '&layer=Lidar_Composite_Hillshade_DTM_1m&style=hillshade' +
  '&tileMatrixSet=WebMercatorQuad&format=image%2Fpng&transparent=true' +
  '&tileMatrix={z}&tileRow={y}&tileCol={x}';

// Leaflet (what this app does)
L.tileLayer(TEMPLATE, {
  maxNativeZoom: 24, minZoom: 6, opacity: 0.7, keepBuffer: 1,
  bounds: L.latLngBounds([[49.8506, -7.1048], [55.8771, 2.0843]]),
  attribution: '© Environment Agency copyright and/or database right 2022'
}).addTo(map);

// OpenLayers
new ol.layer.Tile({
  opacity: 0.7,
  source: new ol.source.XYZ({
    url: TEMPLATE.replace('{z}', '{z}').replace('{y}', '{y}').replace('{x}', '{x}'),
    maxZoom: 24, attributions: '© Environment Agency copyright and/or database right 2022'
  })
});

// MapLibre GL JS
map.addSource('ea-lidar', {
  type: 'raster', tileSize: 256, maxzoom: 24,
  bounds: [-7.1048, 49.8506, 2.0843, 55.8771],
  tiles: [TEMPLATE],
  attribution: '© Environment Agency copyright and/or database right 2022'
});
map.addLayer({ id: 'ea-lidar', type: 'raster', source: 'ea-lidar',
               paint: { 'raster-opacity': 0.7 } });
```

---

## 4. Licence, attribution and usage conditions

* **Licence: Open Government Licence v3.0.** The dataset page
  ([LIDAR Composite DTM 1 m](https://environment.data.gov.uk/dataset/13787b9a-26a4-4775-8523-806d13af58fc))
  states *Licence: Open Government Licence* and *Use limitation: "There are no
  public access constraints to this data. Use of this data is subject to the
  licence identified."* Free to copy, publish, adapt and use commercially.
* **Attribution required.** The dataset's own **attribution statement** is
  **"© Environment Agency copyright and/or database right 2022. All rights
  reserved."** The OGL additionally requires the acknowledgement **"Contains
  public sector information licensed under the Open Government Licence v3.0"**.
  The layer therefore shows, in the Leaflet attribution control whenever it is
  on:

  > © Environment Agency copyright and/or database right 2022 · Contains public
  > sector information licensed under the Open Government Licence v3.0

* **Usage / fair use.** Neither the dataset page nor the service capabilities
  publish a rate limit or quota; the platform's `Fees`/`AccessConstraints` are
  `NONE` and the WMS capabilities say the data is *"made freely available by
  Defra and its agencies for your use"*. There is no registration and no key.
  Treat it as a shared public resource: the implementation is deliberately
  frugal (§5), and anything beyond personal/low traffic should go through a
  cache. Service status and contact: `dspcustomerforum@environment-agency.gov.uk`.

---

## 5. Being a good citizen of a public government service

* `keepBuffer: 1` — barely any off-screen preloading;
* `updateWhenZooming: false`, `updateWhenIdle: true` — no tile storm while
  dragging or pinch-zooming;
* `bounds` clipped to each product's published extent and `minZoom: 6` — no
  requests for Scotland, Ireland or the continent;
* `maxNativeZoom: 24` — above it Leaflet upscales instead of requesting tiles
  the service rejects (z25 returns an XML exception). Note that the *data* is
  1 m, so everything past ~z19–20 is interpolation: if you want to spare the
  server the live renders, lower `maxNativeZoom` to 20 — the picture barely
  changes;
* cached tiles come back as `geowebcache-cache-result: HIT`, i.e. no rendering
  work on the server at all — one more reason to prefer this WMTS over the WMS;
* **for production traffic put a caching proxy or CDN in front.** The service
  only sends `max-age=120`, while the composite is rebuilt about once a year.

### Nginx caching proxy (7 days)

```nginx
proxy_cache_path /var/cache/nginx/ealidar levels=1:2 keys_zone=ealidar:50m
                 max_size=10g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name ea-lidar-cache.example.com;

    location /spatialdata/ {
        proxy_pass         https://environment.data.gov.uk/spatialdata/;
        proxy_set_header   Host environment.data.gov.uk;
        proxy_ssl_server_name on;

        proxy_cache            ealidar;
        proxy_cache_key        "$request_uri";
        # The upstream says max-age=120; the data changes ~annually, so override.
        proxy_ignore_headers   Cache-Control Expires;
        proxy_cache_valid      200 7d;        # tiles: one week
        proxy_cache_valid      400 404 1h;    # "no tile here": short
        proxy_cache_lock       on;            # one upstream fetch per tile
        proxy_cache_use_stale  error timeout updating http_500 http_502 http_503 http_504;
        add_header             X-Cache-Status $upstream_cache_status;

        add_header             Cache-Control "public, max-age=604800";
        add_header             Access-Control-Allow-Origin "*";
    }
}
```

Then set `window.EA_LIDAR_PROXY_HOST = 'https://ea-lidar-cache.example.com';`.

### Cloudflare Worker (7 days)

```js
export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/spatialdata/')) return new Response('Not found', { status: 404 });

    const upstream = new URL('https://environment.data.gov.uk' + incoming.pathname + incoming.search);
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

1. **Alignment, Dorset coast.** Zoom to roughly 50.70 N, 2.45 W at **z13** with
   the England row on at 70 %. The hillshade must sit exactly on the basemap:
   check the coastline at Lulworth/Durdle Door and a chalk ridge (the Purbeck
   ridge) — no half-tile offset, no stair-stepping along the shore.
2. **Network.** DevTools → Network, filter `environment.data.gov.uk`: every
   request is **200** with `content-type: image/png`, on URLs of the form
   `…/wmts?service=WMTS&request=GetTile&…&tileMatrix=13&tileRow=2753&tileCol=4040`.
   Most responses carry `geowebcache-cache-result: HIT`. No 400, 403 or 404
   inside England.
3. **Toggle.** Switching the row off removes every tile and the attribution;
   switching it back on restores both.
4. **Opacity slider.** 0 % → invisible, 100 % → opaque; the label follows and
   the setting survives a product switch.
5. **Dropdown.** *Elevation DTM 1 m* → a colour height ramp. *DTM 1 m* → the
   flat grey model. *Hillshade DSM 1 m* → buildings, hedgerows and woodland
   appear in the shading (use a town edge to see the difference clearly).
   Back to *Hillshade DTM 1 m* for bare-earth work.
6. **Zoom cap.** Tiles are still requested at z19–20 (a few `MISS`, rendered on
   demand). Past z24 Leaflet upscales and no z25 request appears — a real z25
   request returns an XML exception.
7. **Outside coverage.** Pan into **Scotland** (Edinburgh) and **Wales**
   (Snowdonia), then over the Irish Sea: no broken-image icons, no error
   overlay, at most **one** `[EaLidarWmts] …tiles are unavailable` line in the
   console for the whole session. North of ~55.88 N no request is made at all;
   inside the box but outside the survey the service returns an empty
   transparent tile, which simply shows the basemap.
8. **Attribution.** With the row on, the map credit reads "© Environment Agency
   copyright and/or database right 2022 · Contains public sector information
   licensed under the Open Government Licence v3.0", and the OGL link opens.
9. **Other countries untouched.** Norway, Poland, Spain, Netherlands and
   Switzerland rows still behave as before.

---

## 7. Known limitations

* **England only.** The Environment Agency surveys England (~99% at 1 m).
  Scotland (Scottish Remote Sensing Portal), Wales (DataMapWales / NRW) and
  Northern Ireland (OSNI/LPS) publish their own LiDAR through different
  services — not wired in here. The published bounding box is a rectangle, so
  it clips a little of Wales, Ireland and the Scottish border; there the
  service returns a valid **empty** tile, not an error.
* **It is a rendered hillshade, not elevation data.** No click-to-read height.
  The same datasets are available as WCS and as 5 km GeoTIFF downloads if you
  need the numbers.
* **One fixed light direction.** The service publishes a single pre-rendered
  hillshade per model; there is no azimuth/altitude parameter, so you cannot
  re-light it from a different angle in the browser (that needs the raw DTM via
  WCS and client-side shading).
* **Composite of many surveys, 2000–2022.** Adjacent blocks can differ in age
  and quality; the survey index catalogues (WMS/WFS on the same platform) show
  which survey covers a given spot.
* **`max-age=120` upstream.** Without a proxy the browser re-validates tiles
  often; see §5.
* **Zoom beyond ~20 is interpolation** of 1 m data, even though the service
  accepts requests up to z24.
