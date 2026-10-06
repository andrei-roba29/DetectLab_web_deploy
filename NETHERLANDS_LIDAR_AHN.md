# Netherlands LiDAR layer — AHN relief over ArcGIS `exportImage`

The Netherlands row of the LiDAR panel now renders the **AHN** (Actueel
Hoogtebestand Nederland) 0.5 m LiDAR terrain model as live relief tiles from
the public Esri Nederland ImageServers. Every Leaflet tile is one
`/exportImage` request in Web Mercator, reprojected on the fly by the service
from RD New (EPSG:28992). Nothing is downloaded or pre-generated.

| | |
| --- | --- |
| Services | `https://ahn.arcgisonline.nl/arcgis/rest/services/Hoogtebestand/{AHN4,AHN5,AHN6}_{DTM,DSM}_50cm/ImageServer` |
| Default product | **AHN4 DTM**, rendering rule `AHN - Hillshade (Multidirectionaal)` |
| Key / token | **none** |
| Licence | AHN is open data, CC BY 4.0 (`copyrightText: "Esri Nederland, AHN"`) |
| Attribution | `AHN hillshade © AHN / Esri Nederland (CC BY 4.0)` |

Code: **`js/ahn-layer.js`** (all configuration in one block at the top).
Tests: **`node test-netherlands-ahn.js`** (89 checks).

---

## 1. The two bugs this fixes

**1 — the missing operation.** The old builder composed
`…/AHN6_DSM_50cm/ImageServer?f=image&bbox=…`, i.e. it hit the *service root*
instead of the `/exportImage` **operation**. Verified live on 2026-10-06:

```
GET …/AHN6_DSM_50cm/ImageServer?bbox=…&f=image   → 200, content-type: text/html
GET …/AHN6_DTM_50cm/ImageServer/exportImage?…    → 200, content-type: image/png
```

An `<img>` fed HTML fires neither `onload` with pixels nor an obvious error —
it just renders nothing, which is why the row looked switched-off. (This is the
same trap that was fixed for Norway earlier; the shared
`_createArcGisImageServerLayer` helper in `js/map-app.js` now appends
`/exportImage` too, so no future country can inherit it.)

**2 — AHN6 has only partial coverage.** `/identify` at the same points:

| Point | AHN4 | AHN5 | AHN6 |
| --- | --- | --- | --- |
| Veluwe, 52.10 N 5.80 E | — | `NoData` | **31.649 m** |
| Limburg, 50.80 N 5.95 E | **167 m** | — | `NoData` |

AHN5 and AHN6 are still being flown, so either alone leaves large holes. The
default is now **AHN4** (complete national coverage, 2020–2022); AHN5 and AHN6
remain selectable in the dropdown for the newest data where it exists.

### Other things verified on the live services (2026-10-06)

* The `/Hoogtebestand` folder lists AHN2…AHN6; `AHN4_DTM_50cm`,
  `AHN4_DSM_50cm`, `AHN5_DTM_50cm`, `AHN6_DTM_50cm`, `AHN6_DSM_50cm` all exist,
  `pixelSizeX/Y = 0.5`, `pixelType F32`, spatial reference **EPSG:28992**.
* `rasterFunctionInfos` on AHN4 DTM include exactly the names used here:
  `AHN - Hillshade (Multidirectionaal)`, `AHN - Shaded Relief`,
  `AHN - Slope (kleur)`, plus colour ramps, aspect, contour and
  `Boven en onder NAP`. **No rendering rule in the config was guessed.**
* `maxImageWidth/Height = 15000` ⇒ a 256 px tile is well inside the limit;
  `allowRasterFunction: true`.
* A real tile (AHN4 DTM hillshade, Limburg, 256 px) returned **200,
  `image/png`, 27 157 bytes**, `cache-control: max-age=43200`.
* **CORS:** the server echoes the caller's `Origin` in
  `access-control-allow-origin` (with `access-control-allow-credentials: true`
  and `vary: Origin`) — so `<img>` tiles work, and `fetch()` /
  `crossOrigin="anonymous"` / canvas reads work too. Note the echo-style header
  means a wildcard-only CDN cache must vary on Origin.
* HTTPS with HSTS; no mixed-content problem.

**Not verified:** how the shading looks at every zoom, pixel-exact alignment
with the DetectLab basemap, and the service's rate limits — see the checklist
below.

---

## 2. How to run

```bash
cd /path/to/DetectLab_web_deploy
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

LiDAR panel → **"Netherlands · AHN relief (0.5 m)"** → toggle on, choose a
product, set the opacity. Tests: `node test-netherlands-ahn.js`.

---

## 3. How to change the product, the region or anything else

Everything lives in the `CONFIG` block at the top of `js/ahn-layer.js`:

```js
MODES: {
    dtm:    { label: '…', service: 'AHN4_DTM_50cm', renderingRule: 'AHN - Hillshade (Multidirectionaal)' },
    relief: { label: '…', service: 'AHN4_DTM_50cm', renderingRule: 'AHN - Shaded Relief' },
    slope:  { label: '…', service: 'AHN4_DTM_50cm', renderingRule: 'AHN - Slope (kleur)' },
    dsm:    { label: '…', service: 'AHN4_DSM_50cm', renderingRule: 'AHN - Hillshade (Multidirectionaal)' },
    ahn5:   { label: '…', service: 'AHN5_DTM_50cm', renderingRule: 'AHN - Hillshade (Multidirectionaal)' },
    ahn6:   { label: '…', service: 'AHN6_DTM_50cm', renderingRule: 'AHN - Hillshade (Multidirectionaal)' }
},
OPACITY: 0.8, MIN_ZOOM: 8, MAX_NATIVE_ZOOM: 19, MAX_ZOOM: 21,
BOUNDS: [[50.65, 3.20], [53.70, 7.25]],
ATTRIBUTION: 'AHN hillshade © AHN / Esri Nederland (CC BY 4.0)'
```

* **Add a product** → one more `MODES` entry with a `renderingRule` taken from
  `…/ImageServer?f=pjson` → `rasterFunctionInfos`. The `<select>` is refilled
  from `window.AhnLidar.modeKeys()` at start-up.
* **Change the region** → `BOUNDS` (`[[southLat, westLng], [northLat, eastLng]]`).
* **Caching proxy** → `window.AHN_PROXY_BASE = 'https://ahn-cache.example.com/arcgis/rest/services/Hoogtebestand'`
  before `map-app.js` runs. Only *tiles* go through the proxy; `/identify`
  always goes straight to the service.
* **Click-to-read elevation** is available as
  `window.AhnLidar.identify(latlng, mode)` → `{elevation, service, raw}` and
  `formatIdentify(result)` → `"Elevation: 31.6 m NAP"`. It is not bound to a
  click handler in the UI yet.

---

## 4. Licence and attribution

* Data: **AHN — Actueel Hoogtebestand Nederland**, the national LiDAR height
  model (DTM/DSM, 0.5 m), published as open data; the ArcGIS services are
  hosted by **Esri Nederland** (`copyrightText: "Esri Nederland, AHN"`).
* AHN is distributed under **CC BY 4.0** (see <https://www.ahn.nl/> and the
  PDOK/AHN open-data terms). Credit shown in the Leaflet attribution control
  whenever the layer is on:

  > **AHN hillshade © AHN / Esri Nederland (CC BY 4.0)**

* The previous "CC0 1.0 / Rijkswaterstaat" note in the panel was wrong for
  these ArcGIS endpoints and has been removed.

---

## 5. Being a good citizen of a public server

* `keepBuffer: 1`, `updateWhenZooming: false`, `updateWhenIdle: true` — minimal
  off-screen and in-gesture requests.
* `bounds` clipped to the Netherlands and `minZoom: 8` — a z7 request would
  cover half the country in one 256 px image.
* `maxNativeZoom: 19` — 0.5 m data is ≈0.3 m/px at z19; above that Leaflet
  upscales instead of asking for more.
* Unlike a WMTS cache these are **dynamically rendered** images, so each new
  tile costs the server real CPU. **Put a caching proxy or CDN in front of it
  in production** — the responses already say `cache-control: max-age=43200`.

### Nginx caching proxy (7 days)

```nginx
proxy_cache_path /var/cache/nginx/ahn levels=1:2 keys_zone=ahn:50m
                 max_size=10g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name ahn-cache.example.com;

    location /arcgis/rest/services/Hoogtebestand/ {
        proxy_pass         https://ahn.arcgisonline.nl/arcgis/rest/services/Hoogtebestand/;
        proxy_set_header   Host ahn.arcgisonline.nl;
        proxy_ssl_server_name on;

        proxy_cache        ahn;
        proxy_cache_key    "$request_uri";       # bbox + renderingRule are in the URI
        proxy_cache_valid  200 7d;
        proxy_cache_valid  400 404 1h;
        proxy_cache_lock   on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header         X-Cache-Status $upstream_cache_status;

        add_header         Cache-Control "public, max-age=604800";
        add_header         Access-Control-Allow-Origin "*";   # upstream echoes Origin
    }
}
```

### Cloudflare Worker (7 days)

```js
export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    const upstream = new URL('https://ahn.arcgisonline.nl' + incoming.pathname + incoming.search);

    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    const cache = caches.default;

    let response = await cache.match(cacheKey);
    if (response) return response;

    response = await fetch(upstream.toString(), { cf: { cacheTtl: 604800, cacheEverything: true } });
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'public, max-age=604800');
    response.headers.set('Access-Control-Allow-Origin', '*');
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
```

---

## 6. Manual test checklist

1. **It draws at all.** Toggle the Netherlands row on over Amsterdam at z14 —
   this is the regression that matters: the old row drew nothing anywhere.
2. **Network.** DevTools → Network: every request is
   `…/AHN4_DTM_50cm/ImageServer/exportImage?…`, **200**, `content-type:
   image/png`. There must be no request ending in `ImageServer?f=image`.
3. **Alignment.** At z16 over Nijmegen or the Utrechtse Heuvelrug, the relief
   edges follow the basemap's roads, dikes and river banks exactly.
4. **Micro-relief.** Zoom to z18–19 on the Veluwe: Celtic-field banks and
   burial mounds should be visible; switch to *slope (colour)* for a second
   reading of the same terrain.
5. **Dropdown.** Walk through all six products; each redraws without the layer
   flickering off, and the URLs change service and/or `renderingRule`.
6. **Partial coverage is visible, not broken.** Pick *AHN6* and pan to Limburg:
   tiles come back transparent (NoData), the basemap shows through, no
   broken-image icons, at most one console warning.
7. **Opacity slider** 0 → 100 % tracks smoothly and survives a product switch.
8. **Outside the Netherlands** (Belgium, Germany): no requests are made at all.
9. **Other countries untouched:** Norway, Poland and Spain rows still work.

---

## 7. Known limitations

* **Dynamic rendering, not a tile cache** — first paint of a new area is
  slower than Spain's or Poland's cached services, and the server does real
  work per tile. Use the caching proxy in production.
* **AHN5/AHN6 holes are silent:** outside the flown blocks the service returns
  transparent pixels, which looks identical to "layer off" in a flat landscape.
  The labels say *partial cover* for that reason.
* **DSM includes vegetation and buildings** — useful for detecting earthworks
  under open ground only; the DTM is the archaeological default.
* **Alignment depends on the service's reprojection** from RD New to Web
  Mercator; at z19 a sub-pixel softness is expected (bilinear interpolation).
* **No elevation popup wired in the UI yet**, although `AhnLidar.identify()`
  works and is covered by tests.
* The old `NETHERLANDS_LIDAR_IMAGE_SERVER_URL` constant still exists in
  `js/map-app.js` for external callers, but nothing builds the layer from it
  any more.
