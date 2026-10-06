# Norway LiDAR — Kartverket hoydedata.no (live ImageServer tiles)

**Status: 2026-10-06.** The *Norway · Kartverket LiDAR* row of the LiDAR panel
now fetches Norwegian LiDAR-derived terrain directly from Kartverket's
`hoydedata.no` ArcGIS **ImageServer**, one `exportImage` request per map tile,
live as the user pans and zooms. Nothing is downloaded or pre-generated.

Scope: **this change touches the Norway row only.** Every other LiDAR country
(Netherlands, Poland, Spain, Switzerland, UK, France, Denmark) is untouched.

---

## 1. Why the old layer returned 200 and drew nothing

The previous Norwegian layer was a WMS:

```
https://wms.geonorge.no/skwms1/wms.hoyde-hoydedata-metadata-prosjekt
  LAYERS = "Vestfold 10pkt 2025:multiskyggerelieff"
```

That service publishes **one layer per survey project** (~1,356 of them). The
request is valid everywhere, so the server always answers `200 OK` with a
PNG — but outside the single selected project the PNG is fully transparent.
Result: successful requests, empty map.

There is a second, very similar trap on ArcGIS, and it is worth writing down
because the symptom is identical:

| Request | Result |
|---|---|
| `…/NHM_DTM_25833/ImageServer?f=image&bbox=…` | **200** · `content-type: text/html` → an `<img>` renders nothing |
| `…/NHM_DTM_25833/ImageServer/exportImage?f=image&bbox=…` | **200** · `content-type: image/png`, 21 136 bytes |

The `/exportImage` *operation* is mandatory. Both were verified live.

---

## 2. What was verified against the live service

Checked on 2026-10-06 via `…/ImageServer?f=pjson` and real requests:

| Question | Answer |
|---|---|
| Is `skyggerelieff` available? | **Yes.** `rasterFunctionInfos` = `["skyggerelieff", "None"]` on both NHM services. |
| Is `NHM_DSM_25833` the surface model? | **No — it does not exist (404).** Kartverket calls it **`NHM_DOM_25833`** (DOM = *digital overflatemodell*). Same raster function, same extent. |
| `maxImageWidth` / `maxImageHeight` | **4096 × 4096** (NHM services), 15000 × 15000 for `DTM_lokalhoyde_graatone`. 256 × 256 tiles are far inside the limit. |
| Native CRS / pixel size | EPSG:25833, 1 m (0.25 m for the local-relief service); reprojected to 3857 on the fly. |
| Service extent | `-100275, 6399725 → 1150255, 8000275` (EPSG:25833) — all of Norway. |
| Tile cache? | `exportTilesAllowed: false` — there is no pre-cached tile pyramid, `exportImage` is the only way. |
| Does `exportImage` work in Web Mercator? | **Yes**, `bboxSR=3857&imageSR=3857` returns `image/png`. |
| Is `identify` usable from the browser? | **Yes.** It returned `{"value":"17.5408", …}` for 67.28 N 14.40 E, and the server **reflects the request Origin** (`access-control-allow-origin: https://detectlab.ro`, `vary: Origin`). No proxy needed. |

**Not verified** (no way to do it from this environment): how the tiles *look*
on screen, and the server's rate limits / fair-use policy. Both need the
manual checklist in §6 and the caching note in §5.

---

## 3. What was built

### `js/hoydedata-layer.js` (new, no build step, Leaflet 1.x only)

All settings live in one clearly marked `CONFIG` block at the top: host,
optional proxy, the three products, opacity, zoom window, tile size, format,
attribution and the identify switch.

| Export | Purpose |
|---|---|
| `Hoydedata.exportImageUrl(mode, bbox3857, size)` | pure URL builder (`/exportImage`, `bboxSR`/`imageSR=3857`, `size=256,256`, URL-encoded `renderingRule`) |
| `Hoydedata.identifyUrl(mode, x, y)` | pure URL builder for `/identify` |
| `Hoydedata.createLayer(opts)` | `L.GridLayer` subclass — one `exportImage` request per tile; the extent comes from Leaflet's own `_tileCoordsToBounds(coords)` projected with `L.CRS.EPSG3857`, so the hillshade lines up with the basemap exactly |
| `Hoydedata.identify(latlng, mode)` | `Promise<{elevation, …}>` |
| `Hoydedata.formatIdentify(result)` | `"Elevation: 17.5 m"` / `"No elevation data here"` |
| `layer.setMode('dtm'\|'dsm'\|'lrm')` | switches product and redraws, without rebuilding the layer |

Products in the dropdown:

| Key | Label | Service | Rendering rule |
|---|---|---|---|
| `dtm` | DTM · terrain hillshade (1 m) | `NHM_DTM_25833` | `skyggerelieff` |
| `dsm` | DSM · surface hillshade (1 m) | `NHM_DOM_25833` | `skyggerelieff` |
| `lrm` | DTM · local relief (0.25 m) | `DTM_lokalhoyde_graatone` | `LokalHoyde` |

The third one is a bonus: a local relief model removes the landform and leaves
small surface anomalies — the most useful of the three for archaeology.

Behaviour:

- **Opacity** default `0.7`, driven by the existing row slider.
- **Zoom window** `minZoom 8`, `maxNativeZoom 17`, `maxZoom 20` (overzoomed
  above 17 instead of failing).
- **Bounds** per product, so Leaflet never requests a tile outside Norway.
- **Tile errors** swap in a 1×1 transparent PNG and report success to Leaflet:
  no broken-image icons, no retry storm, one console warning per layer.
- **Gesture safety** `updateWhenZooming: false`, `updateWhenIdle: true`,
  `keepBuffer: 1` (shared with `js/tile-perf.js` when present).
- **Click → elevation**: while the layer is on, a map click calls `/identify`
  and shows `Elevation: N m` in a popup. It ignores the click that ends a pan,
  ignores clicks outside the product bounds and below zoom 8.

### `js/map-app.js` (Norway row only)

- `createNorwayLidarLayer()` now returns `Hoydedata.createLayer(…)`.
- The GetCapabilities catalogue fetch and the 1,356-project dropdown are gone;
  `_populateNorwayModeSelect()` fills the same `<select>` with the three
  products. `window.setNorwayLidarMode(key)` is the new entry point, and
  `window.setNorwayLidarRegion` is kept as an alias.
- `_setNorwayIdentifyEnabled(on)` attaches/detaches the identify click handler
  together with the layer.

### `index.html` / `sw.js`

- `js/hoydedata-layer.js?v=20261006-norway` loaded before `map-app.js`,
  pre-cached by the service worker (`detectlab-v155-norway-hoydedata`).
- Norway row: dropdown relabelled, opacity default 70 %, layer-info text
  updated. **Attribution** `Hillshade © Kartverket (CC BY 4.0)` is attached to
  the layer, so Leaflet's attribution control shows it whenever the layer is on.

---

## 4. How to run / change things

```bash
# any static server from the repo root — there is no build step
python3 -m http.server 8080
# → http://localhost:8080  →  Layers → LIDAR → Norway · Kartverket LiDAR
```

| I want to… | Do this |
|---|---|
| change the default product | `CONFIG.DEFAULT_MODE` in `js/hoydedata-layer.js` |
| add another hoydedata service | add an entry to `CONFIG.MODES` (check `…/ImageServer?f=pjson` for its `rasterFunctionInfos` first) |
| change the hillshade rendering | the `renderingRule` of that mode — only names listed by the service work |
| change opacity / zoom window | `CONFIG.OPACITY`, `CONFIG.MIN_ZOOM`, `CONFIG.MAX_NATIVE_ZOOM` |
| move the area | nothing to do — the layer is country-wide; `CONFIG.MODES[*].bounds` only stops requests outside the data |
| turn off click-to-identify | `CONFIG.IDENTIFY.ENABLED = false` |
| route tiles through a cache | `window.HOYDEDATA_PROXY_BASE = 'https://…/arcgis/rest/services'` before the script tag, or set `CONFIG.PROXY_BASE` |

---

## 5. Be kind to a public server — optional caching proxy

`hoydedata.no` is a public national service with no API key and no published
rate limit. The layer already keeps `keepBuffer: 1` and `minZoom: 8` so it
barely preloads outside the viewport, but **for production traffic put a
caching proxy or CDN in front of `exportImage`**: the imagery is static, so a
7-day cache removes almost all of the load.

Point the layer at it with `window.HOYDEDATA_PROXY_BASE`.

### Nginx

```nginx
proxy_cache_path /var/cache/nginx/hoydedata levels=1:2
                 keys_zone=hoydedata:50m max_size=20g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name hoyde-cache.example.com;

    location /arcgis/rest/services/ {
        proxy_pass         https://hoydedata.no;
        proxy_set_header   Host hoydedata.no;
        proxy_ssl_server_name on;

        proxy_cache            hoydedata;
        proxy_cache_key        "$scheme$request_method$host$request_uri";
        proxy_cache_valid      200 7d;      # declassified terrain does not change
        proxy_cache_valid      404 1m;
        proxy_cache_use_stale  error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_lock       on;          # collapse duplicate tile requests
        add_header X-Cache-Status $upstream_cache_status;

        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "public, max-age=604800" always;
    }
}
```

### Cloudflare Worker

```js
// wrangler deploy; then HOYDEDATA_PROXY_BASE = 'https://<worker>/arcgis/rest/services'
const UPSTREAM = 'https://hoydedata.no';
const TTL = 60 * 60 * 24 * 7; // 7 days

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/arcgis/rest/services/')) {
      return new Response('Not found', { status: 404 });
    }
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });

    let response = await cache.match(cacheKey);
    if (!response) {
      response = await fetch(UPSTREAM + url.pathname + url.search, {
        cf: { cacheTtl: TTL, cacheEverything: true }
      });
      response = new Response(response.body, response);
      response.headers.set('Cache-Control', `public, max-age=${TTL}`);
      response.headers.set('Access-Control-Allow-Origin', '*');
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  }
};
```

---

## 6. Manual test checklist

1. Open the site, **Layers → LIDAR**, switch on **Norway · Kartverket LiDAR**.
2. Fly to **Bodø, 67.28 N 14.40 E, zoom 11** (or any Norwegian coast). The
   hillshade should appear over the basemap. Below **zoom 8** it must disappear
   and send no requests.
3. **DevTools → Network**, filter `exportImage`: requests must be
   `…/ImageServer/exportImage?f=image&format=png32&bbox=…&bboxSR=3857&imageSR=3857&size=256,256&…`
   returning **200** with `content-type: image/png`. No `400`s. If you see 400,
   the suspects are, in order: bbox order (`xmin,ymin,xmax,ymax`),
   `bboxSR`/`imageSR`, and `size` not matching the tile size.
4. **Alignment:** pick a recognisable feature — the Saltstraumen strait, a
   fjord edge, an island coastline — and confirm the hillshade shoreline sits
   on the basemap shoreline while zooming 9 → 15.
5. **DTM vs DSM:** switch the dropdown to *DSM · surface hillshade* over a
   forest or a town; buildings and tree canopy should appear. *DTM · local
   relief* should look flat-grey with small bumps.
6. **Opacity:** drag the row slider 0 → 100 %; the hillshade fades without
   reloading tiles.
7. **Attribution:** `Hillshade © Kartverket (CC BY 4.0)` is visible in the
   bottom-right attribution control while the layer is on.
8. **Click to identify:** click on land in Norway → popup `Elevation: N m`
   (Bodø town centre is ≈ 17 m). Click in the sea → `No elevation data here`.
9. **Errors:** throttle the network to offline and pan — tiles stay blank, no
   broken-image icons, exactly one console warning.

Automated: `node test-norway-hoydedata.js` (88 checks — URL format, tile-grid
alignment against the standard EPSG:3857 XYZ grid, zoom window, DTM/DSM switch,
error handling, identify parsing, and the app wiring).

---

## 7. Known limitations

- **No tile cache upstream.** `exportTilesAllowed: false`: every tile is
  rendered on demand, so the first visit to an area is slower than a cached
  basemap. See §5.
- **Overzoom above z17.** The layer keeps requesting z17 pixels and lets
  Leaflet scale them; at z19–20 the hillshade looks soft. Raise
  `MAX_NATIVE_ZOOM` only if you are willing to send 4× more requests — the
  source is 1 m, so z17 is already close to native resolution.
- **`identify` depends on CORS staying as it is.** Kartverket currently
  reflects the request Origin. If that ever changes, the popup degrades to
  *"Elevation unavailable"* and the fix is the same proxy as in §5 (add
  `Access-Control-Allow-Origin: *` there and set `CONFIG.HOST`).
- **Local relief is 0.25 m data**: heavy to render server-side, noticeably
  slower than the two hillshades at low zoom.
- **Coverage.** Norway is fully covered by the national models, but newly
  flown projects appear in `hoydedata.no` before they are merged into the
  national mosaics.

---

## 8. Separate finding, not changed (out of scope)

While verifying the ArcGIS request format I found that the **Netherlands ·
AHN6 DSM** row in the same panel builds its URL as
`…/AHN6_DSM_50cm/ImageServer?bbox=…&f=image` — i.e. the service root, without
`/exportImage`. That is the exact "200 + `text/html` → blank tile" failure
described in §1, so that layer is very likely blank for the same reason.

You asked me to limit this change to Norway, so **I left it alone**. The fix is
one line in `_createArcGisImageServerLayer` in `js/map-app.js` (append
`/exportImage` to the endpoint); say the word and I will apply and test it.
