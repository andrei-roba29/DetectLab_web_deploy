# Switzerland LiDAR layer — swisstopo relief shading over WMTS

The Switzerland row of the LiDAR panel now fetches **swisstopo's relief
shading of the national LiDAR terrain models** (swissALTI3D, plus
swissSURFACE3D and swissBATHY3D in the dropdown) live from the public
geo.admin.ch WMTS as the user pans and zooms. Nothing is downloaded or
pre-generated.

| | |
| --- | --- |
| Service | `https://wmts.geo.admin.ch` — RESTful WMTS 1.0.0 (parameters in the path) |
| Default layer | `ch.swisstopo.swissalti3d-reliefschattierung` ("swissALTI3D multidirektionales Relief") |
| Template | `https://wmts.geo.admin.ch/1.0.0/{Layer}/default/current/3857/{z}/{x}/{y}.png` |
| Tile matrix set | `3857` = EPSG:3857 Web Mercator, 256 px — the standard XYZ/OSM grid |
| Max zoom | **18** for the relief layers (`3857_18`), **17** for swissBATHY3D (`3857_17`) |
| Key / token | **none, and none must be added** |
| Attribution | **© swisstopo** |

Code: **`js/swisstopo-relief-layer.js`** (all configuration in one block at the
top), wired into the Switzerland row of `js/map-app.js` / `index.html`.
Tests: **`node test-switzerland-swisstopo-relief.js`** (80 checks).

---

## 1. What was verified before coding (2026-10-06, live)

Capabilities read from
`https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml` — that URL
**does** work and is the EPSG:3857 profile of the service (there are parallel
documents for EPSG:2056 and EPSG:21781).

| Question | Answer from the live service |
| --- | --- |
| Exact layer identifier | **`ch.swisstopo.swissalti3d-reliefschattierung`**, title *"swissALTI3D multidirektionales Relief"* — hillshade of swissALTI3D combining **six** sun positions, mean azimuth NW |
| Time values | Dimension `Time`, **default `current`, and `current` is the only value** for this layer (other swisstopo layers, e.g. SWISSIMAGE, publish yearly timestamps) |
| Format | **`image/png`** (the relief layers are PNG; SWISSIMAGE and the grey base map are JPEG) |
| TileMatrixSet | **`3857_18`** → levels 0…18, origin `-20037508.342789244 / 20037508.342789244`, 256 × 256 px, matrix width 2^z ⇒ identical to the standard XYZ/OSM grid, and **`maxNativeZoom = 18`** (read from the capabilities) |
| Extent | WGS84 bounding box **5.140242 45.398181 → 11.47757 48.230651** — Switzerland and Liechtenstein plus a margin of neighbouring territory |
| Example tile | `…/3857/11/1073/722.png` → **200, `content-type: image/png`, 84 325 bytes** |
| Max-zoom proof | `…/3857/18/136494/92258.png` (Bern) → **200 image/png, 25 090 B**; `…/3857/19/272989/184516.png` → **error, `content-type: application/json`, 93 B** ⇒ the pyramid really stops at 18 |
| HTTPS / mixed content | HTTPS throughout, served via CloudFront; safe on an HTTPS page |
| CORS | **`access-control-allow-origin: *`** plus `access-control-allow-methods: GET, HEAD, OPTIONS` ⇒ `<img>` tiles work **and** `fetch()` / `crossOrigin="anonymous"` / canvas `getImageData()` reads are allowed |
| Caching headers | `cache-control: public, max-age=14400, s-maxage=31556952` (4 h browser, ~1 year shared cache); tiles mostly answer `x-tiles-s3-cache: hit` |

### Related layers found in the capabilities (all PNG, matrix set as noted)

| Layer | What it is | Max zoom | In the dropdown? |
| --- | --- | --- | --- |
| `ch.swisstopo.swissalti3d-reliefschattierung` | swissALTI3D multidirectional hillshade | 18 | **yes (default)** |
| `ch.swisstopo.swissalti3d-reliefschattierung_monodirektional` | swissALTI3D, single NW light — harder shadows, often better for small earthworks | 18 | **yes** |
| `ch.swisstopo.swisssurface3d-reliefschattierung-multidirektional` | swissSURFACE3D (LiDAR **surface** model: canopy, buildings) | 18 | **yes** |
| `ch.swisstopo.swisssurface3d-reliefschattierung_monodirektional` | same, single NW light | 18 | no (easy to add) |
| `ch.swisstopo.swissbathy3d-reliefschattierung` | **lake-floor** relief — relevant for pile-dwelling sites | **17** | **yes** |
| `ch.swisstopo.swissaltiregio-reliefschattierung_monodirektional` / `_multidirektional` | swissALTIRegio, includes neighbouring countries | 18 | no |
| `ch.swisstopo.digitales-hoehenmodell_25_reliefschattierung` | old DHM25 relief | — | no |
| `ch.swisstopo.hangneigung-ueber_30`, `ch.swisstopo-karto.hangneigung` | **slope** maps (>30°, and slope classes) | not read | no — a tile fetched fine (200 PNG) but their matrix-set maximum was not read, so they are not shipped with a guessed `maxNativeZoom` |
| `ch.swisstopo.pixelkarte-grau` | grey national map, JPEG, **matrix set 3857_19** — a good optional basemap | 19 | no (DetectLab already has its own basemaps; see §3 for how to add) |

**Not verified (not possible from a headless environment):** how the shading
actually looks, pixel-exact alignment against the DetectLab basemap, and the
service's concrete rate limits (swisstopo publishes a "fair use" request
ceiling but not a number — see §4).

### Why the old wiring was wrong

The row called the **WMS** `https://wms.geo.admin.ch/` with
`LAYERS=ch.swisstopo.swisssurface3d.metadata`. That layer is the *metadata* of
swissSURFACE3D — acquisition footprints and their attributes — not terrain
imagery. Requests succeeded and drew tile outlines at best. The constant
`SWITZERLAND_LIDAR_WMS_URL` is kept in `js/map-app.js` for external callers but
is no longer used to build the layer.

---

## 2. How to run

It is a static app — no build step.

```bash
cd /path/to/DetectLab_web_deploy
python3 -m http.server 8080      # or any static server
# open http://localhost:8080/index.html
```

Then: **LiDAR panel → "Switzerland · swisstopo relief (swissALTI3D)"** →
toggle on, pick a product, drag the opacity slider.

Run the tests:

```bash
node test-switzerland-swisstopo-relief.js
```

---

## 3. How to change the layer, time, region or anything else

Everything tunable is in the single `CONFIG` block at the top of
`js/swisstopo-relief-layer.js`:

```js
var CONFIG = {
    HOST: 'https://wmts.geo.admin.ch',
    PROXY_HOST: window.SWISSTOPO_PROXY_HOST || '',   // optional caching proxy / CDN
    VERSION: '1.0.0', STYLE: 'default',
    TIME: 'current',                 // the only value these relief layers publish
    TILE_MATRIX_SET: '3857',         // = standard XYZ / Web Mercator
    EXT: 'png',
    DEFAULT_MODE: 'relief',
    MODES: {
        relief:  { label: '…', layer: 'ch.swisstopo.swissalti3d-reliefschattierung',                     maxNativeZoom: 18 },
        mono:    { label: '…', layer: 'ch.swisstopo.swissalti3d-reliefschattierung_monodirektional',      maxNativeZoom: 18 },
        surface: { label: '…', layer: 'ch.swisstopo.swisssurface3d-reliefschattierung-multidirektional',  maxNativeZoom: 18 },
        bathy:   { label: '…', layer: 'ch.swisstopo.swissbathy3d-reliefschattierung',                     maxNativeZoom: 17 }
    },
    OPACITY: 0.7, MIN_ZOOM: 7, MAX_ZOOM: 20, KEEP_BUFFER: 1,
    BOUNDS: [[45.398181, 5.140242], [48.230651, 11.47757]],
    ATTRIBUTION: '© swisstopo'
};
```

* **Add a layer to the dropdown** → one more `MODES` entry with the identifier
  exactly as GetCapabilities spells it **and its own `maxNativeZoom`** (take it
  from the `TileMatrixSet` name: `3857_18` → 18). The `<select>` in
  `index.html` is refilled from `window.SwisstopoRelief.modeKeys()` at
  start-up, so no HTML change is strictly required.
  Example — the grey national map as an optional basemap:
  `{ label: 'Landeskarte grau', layer: 'ch.swisstopo.pixelkarte-grau', maxNativeZoom: 19 }`
  (that one is JPEG, so also set `EXT: 'jpeg'` for it if you add per-mode
  extensions).
* **Change the time** → `TIME`. `current` is the latest data; layers that
  publish yearly values accept e.g. `2021`.
* **Change the region** → `BOUNDS` (`[[southLat, westLng], [northLat, eastLng]]`).
  Leaflet then never requests a tile outside it.
* **Change the default opacity** → `OPACITY` (the slider in `index.html`
  starts at the matching `value="70"`).
* **Put a cache in front of the public service** → set
  `window.SWISSTOPO_PROXY_HOST = 'https://swisstopo-cache.example.com'` before
  `map-app.js` runs; the rest of the path is appended unchanged.

### Other map libraries

The same template works everywhere, because the `3857` matrix set *is* XYZ:

```js
// OpenLayers
new ol.layer.Tile({
  opacity: 0.7,
  source: new ol.source.XYZ({
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/3857/{z}/{x}/{y}.png',
    maxZoom: 18, attributions: '© swisstopo'
  })
});

// MapLibre GL JS
map.addSource('swissalti3d', {
  type: 'raster', tileSize: 256, maxzoom: 18,
  tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/3857/{z}/{x}/{y}.png'],
  attribution: '© swisstopo'
});
map.addLayer({ id: 'swissalti3d', type: 'raster', source: 'swissalti3d', paint: { 'raster-opacity': 0.7 } });
```

---

## 4. Licence, attribution and usage conditions

* Since **1 March 2021** swisstopo publishes its standard digital products as
  **Open Government Data**: free of charge, for any purpose **including
  commercial use**, no registration, no permission, no licence key
  ([swisstopo FAQ on free geodata](https://www.swisstopo.admin.ch/en/faq-free-geodata),
  [Free Geodata](https://shop.swisstopo.admin.ch/en/free-geodata)).
* **The one condition is attribution.** swisstopo requires the source to be
  indicated as **«Source: Federal Office of Topography swisstopo»** or
  **«© swisstopo»**. This layer shows `© swisstopo` in the Leaflet attribution
  control whenever it is on, and in the ⓘ info popup.
* Creative Commons licences are explicitly **not** used — swisstopo's own
  terms of use apply (based on GeoIG/GeoIV):
  [Terms of use for free geodata and geoservices](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices).
* **Usage limit / rate limiting:** swisstopo states that for service-based use
  of the geoservices (WMS, WMTS, vector tiles) "a maximum number of requests
  per time unit is set as a usage limit. Within this limit, the use of the data
  services is free of charge. The usage limit is to be observed as far as
  possible ('fair use')". No concrete number is published, so the
  implementation is deliberately frugal (§5) and a caching proxy is
  recommended for production traffic.

---

## 5. Being a good citizen of a public government service

* `keepBuffer: 1` — barely any off-screen preloading;
* `updateWhenZooming: false`, `updateWhenIdle: true` — no tile storm while
  dragging or pinch-zooming;
* `bounds` clipped to the published extent and `minZoom: 7` — no requests
  outside Switzerland;
* per-product `maxNativeZoom` (18, or 17 for bathymetry) — above it Leaflet
  upscales instead of requesting tiles that do not exist (a z19 request returns
  a JSON error, not an image);
* **For production, put a caching proxy or CDN in front of the service.**
  swisstopo already sends `s-maxage=31556952`, so a long shared-cache TTL is
  explicitly sanctioned.

### Nginx caching proxy (7 days)

```nginx
proxy_cache_path /var/cache/nginx/swisstopo levels=1:2 keys_zone=swisstopo:50m
                 max_size=10g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name swisstopo-cache.example.com;

    location /1.0.0/ {
        proxy_pass         https://wmts.geo.admin.ch/1.0.0/;
        proxy_set_header   Host wmts.geo.admin.ch;
        proxy_ssl_server_name on;

        proxy_cache        swisstopo;
        proxy_cache_key    "$request_uri";
        proxy_cache_valid  200 7d;          # tiles: one week
        proxy_cache_valid  400 404 1h;      # "no tile here": short
        proxy_cache_lock   on;              # one upstream fetch per tile
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header         X-Cache-Status $upstream_cache_status;

        add_header         Cache-Control "public, max-age=604800";
        add_header         Access-Control-Allow-Origin "*";
    }
}
```

Then set `window.SWISSTOPO_PROXY_HOST = 'https://swisstopo-cache.example.com';`.

### Cloudflare Worker (7 days)

```js
export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    const upstream = new URL('https://wmts.geo.admin.ch' + incoming.pathname + incoming.search);

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

1. **Alignment, Bernese Alps.** Zoom to the Jungfrau region (46.54 N, 7.96 E)
   at **z11–z14** with the Switzerland row on at 70 %. Ridges and glacier
   tongues must sit exactly on the basemap's contours; check a lake shoreline
   (Thunersee or Brienzersee) for a half-tile offset.
2. **Network.** DevTools → Network, filter `wmts.geo.admin.ch`: every request
   is **200** `image/png` on paths like
   `/1.0.0/ch.swisstopo.swissalti3d-reliefschattierung/default/current/3857/13/4265/2883.png`.
   No 400, 403 or 404 inside Switzerland.
3. **Toggle.** Switching the row off removes every tile and the `© swisstopo`
   attribution; switching it back on restores both.
4. **Opacity slider.** 0 % → invisible, 100 % → opaque; the label follows and
   the setting survives a product switch.
5. **Dropdown.** Switch to *mono-directional*: the shadows harden and the URLs
   change to `…reliefschattierung_monodirektional…`. Switch to
   *swissSURFACE3D*: forests and buildings appear in the relief. Switch to
   *swissBATHY3D* over Lake Neuchâtel: the lake floor is shaded and the land is
   transparent.
6. **Zoom cap.** At z18 tiles are still requested; past z18 Leaflet upscales
   and **no** z19 request appears in the Network panel (a real z19 request
   returns a JSON error). With swissBATHY3D selected the cap is z17.
7. **Outside coverage.** Pan to Lyon or Munich: no tile requests at all, no
   console noise, no broken-image icons.
8. **Console.** Over a whole session there is at most **one**
   `[SwisstopoRelief] some … tiles are unavailable` warning.
9. **Other countries untouched.** Norway, Poland, Spain and the Netherlands
   rows still behave as before.

---

## 7. Known limitations

* **It is a rendered hillshade, not elevation data.** No click-to-read height;
  swisstopo's height API (`api3.geo.admin.ch/rest/services/height`) would be a
  separate addition.
* **swissALTI3D relief is rendered from the 0.5–2 m terrain model but the tile
  pyramid stops at z18** (≈0.6 m/px), so the finest micro-relief visible in a
  locally computed hillshade of the raw swissALTI3D rasters is not reachable
  through this service.
* **swissSURFACE3D is a surface model** — vegetation and buildings are in the
  shading; use swissALTI3D for bare-earth archaeology.
* **swissBATHY3D covers only the mapped lakes**; everywhere else it returns a
  valid, fully transparent 334-byte PNG (verified), which looks like "layer
  off" rather than an error.
* **The slope layers are not wired in** because their TileMatrixSet maximum was
  not read from the capabilities; adding them means reading that first (§3).
* **No concrete rate limit is published** by swisstopo — only a "fair use"
  ceiling, so heavy deployments should proxy and cache (§5).
