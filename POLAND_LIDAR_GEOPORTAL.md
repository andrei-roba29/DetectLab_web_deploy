# Poland LiDAR — GUGiK / Geoportal.gov.pl terrain shading (live WMS)

**Status: 2026-10-06.** The *Poland* row of the LiDAR panel now shows the
LiDAR-derived terrain shading of the national elevation model (ISOK / NMT
1 m), fetched live from the official **token-free** GUGiK OGC services as the
user pans and zooms. Nothing is downloaded or pre-generated.

Scope: **this change touches the Poland row only.** Norway, the Netherlands,
Spain, Switzerland, the UK, France and Denmark are untouched.

---

## 1. Why the old layer returned 200 and drew nothing

The row used to request these:

```
https://mapy.geoportal.gov.pl/wss/service/PZGIK/DanePomNMT/WMS/SkorowidzeWUkladzieKRON86
  LAYERS = gugik:SkorowidzDanychPomiarowychLIDAR2011,…,gugik:…LIDAR2019
```

*Skorowidze* means **index sheets**. Those layers publish the footprints and
metadata of the LiDAR *measurement* projects (which sheet was flown, in which
height system, in which year) — they are a catalogue, not imagery. The
requests were valid, the server answered `200`, and the tiles were empty.

The terrain shading lives in a completely different service family:
`PZGIK/NMT/GRID1/…`.

---

## 2. Discovery — what the live services actually say

### Tokens: what I did **not** use

The Geoportal viewer internally calls

```
https://mapy.geoportal.gov.pl/gprest/services/ISOK_Cien/MapServer/tile/{level}/{row}/{col}?token=…
```

That is a viewer session endpoint. It is **not used anywhere in this code**,
and no token appears in any request we send — pinned by
`test-poland-geoportal-nmt.js`.

### WMTS `…/PZGIK/NMT/GRID1/WMTS/ShadedRelief` — verified, then rejected

`?SERVICE=WMTS&REQUEST=GetCapabilities` (HTTPS, 200) says:

| Property | Value |
|---|---|
| Layer identifier | **`Cieniowanie`** |
| TileMatrixSet | **`EPSG:2180` only** (13 levels, `EPSG:2180:0` … `EPSG:2180:12`) |
| Tile size | **512 × 512** |
| Format | **`image/jpeg` only** (no alpha) |
| TopLeftCorner | `850000.0 100000.0` (PL-1992) |
| Scale denominators | 7 559 538 → 944.94 |
| WGS84 bbox | 13.8 48.8 → 24.4 55.0 |
| Terms | *"Korzystanie z usługi … oznacza akceptację … Regulaminu … http://www.geoportal.gov.pl/"* |

So the WMTS is a **Polish national grid (EPSG:2180), 512 px, JPEG** service.
Using it in a Web-Mercator Leaflet map would mean registering EPSG:2180 with
proj4, building a custom `L.CRS` with those 13 resolutions and that origin,
and living without transparency — and the app's map is a single shared
EPSG:3857 map used by ~40 other layers.

### WMS `…/PZGIK/NMT/GRID1/WMS/ShadedRelief` — the one I picked

`?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0` (HTTPS, 200):

| Property | Value |
|---|---|
| Title | *Numeryczny Model Terenu – Cieniowanie* ("cieniowanie NMT w siatce 1 m × 1 m") |
| Layer **name** | **`Raster`** (title *Cieniowanie w siatce 1m x 1m*) — confirmed in the 1.1.1 document, which lists `Raster` explicitly |
| Advertised CRS | `CRS:84`, `EPSG:4326`, `EPSG:2180`, `2176`, `2177`, `2178`, `2179` — **3857 is not advertised** |
| Formats | `image/png`, `image/png24`, `image/png32`, `image/jpeg`, `image/tiff`, … |
| MaxWidth / MaxHeight | **4096 × 4096** |
| Geographic bbox | 13.753705 48.880529 → 24.774761 54.950005 |
| Fees | *Brak opłat* (no fees) |
| Access constraints | *"Wykorzystanie usługi nie podlega żadnym ograniczeniom z wyłączeniem automatycznego pobierania i kolekcjonowania obrazów (tzw. harvesting)."* |

And the sibling `…/WMS/Hypsometry`: layer name **`Raster`** (*Dynamiczna
hipsometria*), and it **does** advertise `EPSG:3857`.

### The decision

**WMS, `CRS=EPSG:3857`, one `GetMap` per Leaflet tile.** Reasons:

1. it is the only option that renders aligned in the existing EPSG:3857 map
   with no proj4, no second CRS and no custom tile grid;
2. PNG + `TRANSPARENT=TRUE` keeps the basemap visible under the shading,
   which the JPEG WMTS cannot do;
3. although `ShadedRelief` does not *advertise* 3857, it **accepts and
   reprojects it**: a live `GetMap` with `CRS=EPSG:3857` returned
   `200` + `content-type: image/png`, not a `ServiceException` (the server
   does emit `text/xml` exceptions — a deliberately wrong `LAYERS` value
   returned *"Parameter 'layers' contains unacceptable layer names."*).

Because that behaviour is undocumented, the layer carries a safety net: after
`FALLBACK_AFTER_ERRORS` (6) tile failures it switches itself to per-tile
**EPSG:4326** requests (WMS 1.3.0 lat,lon axis order), which *is* advertised.
Both code paths are implemented and tested.

### What I verified vs. what I could not

**Verified live (2026-10-06):** both GetCapabilities documents (WMTS + WMS
1.3.0 and 1.1.1); the layer name `Raster`; formats; `MaxWidth/MaxHeight`;
bbox; the fees/constraints text; HTTPS works on every endpoint (no mixed
content); `CRS=EPSG:3857` GetMap returns `image/png`; the same for
`Hypsometry`; a wrong layer name returns a `ServiceException`;
**CORS**: `access-control-allow-origin: *` on the ShadedRelief response
(reflected Origin on Hypsometry) — so even canvas/`fetch()` reads would work,
though the layer only uses plain `<img>` tiles, which never need CORS;
`GetFeatureInfo` is **not** allowed (`RequestNotAllowed`), so there is no
click-to-read-elevation for Poland.

**Could not verify from here:** how the tiles look (no browser), whether the
reprojected 3857 output is pixel-perfect against the basemap, and the server's
rate limits. Those are the first three items of the manual checklist in §6.

---

## 3. What was built

### `js/geoportal-nmt-layer.js` (new, no build step, Leaflet 1.x only)

One clearly marked `CONFIG` block at the top holds the service base, the
optional proxy, the products, CRS + fallback CRS, format, opacity, zoom
window, tile size, keepBuffer, bounds and attribution.

| Export | Purpose |
|---|---|
| `GeoportalNMT.tileUrl(mode, bbox, size, crs)` | pure WMS 1.3.0 `GetMap` URL builder |
| `GeoportalNMT.createLayer(opts)` | `L.TileLayer` subclass; tile extent from Leaflet's `_tileCoordsToBounds` projected with `L.CRS.EPSG3857` |
| `layer.setMode('cieniowanie'\|'hipsometria')` | switches service and redraws |

| Key | Label | Service | WMS layer |
|---|---|---|---|
| `cieniowanie` | Cieniowanie · hillshade (NMT 1 m) | `ShadedRelief` | `Raster` |
| `hipsometria` | Hipsometria · colour relief | `Hypsometry` | `Raster` |

Behaviour: opacity `0.7`; `minZoom 10`, `maxNativeZoom 18`, `maxZoom 20`
(Leaflet upscales above 18); bounds clipped to Poland so no tile is requested
elsewhere; `errorTileUrl` = transparent 1 × 1 PNG (no broken-image icons);
one console warning per layer; `updateWhenZooming:false`,
`updateWhenIdle:true`, `keepBuffer:1`; automatic EPSG:4326 fallback.

### `js/map-app.js`, `index.html`, `sw.js` (Poland row only)

- the `poland` factory now calls `GeoportalNMT.createLayer(…)`;
- the dropdown offers **Cieniowanie / Hipsometria** (filled from the module at
  runtime too) and switching uses `setMode` instead of rebuilding the layer;
- opacity slider default 70 %; row relabelled *Poland · GUGiK NMT shading*;
- `js/geoportal-nmt-layer.js?v=20261006-poland` loads before `map-app.js` and
  is pre-cached by the service worker (`detectlab-v156-poland-nmt`);
- the old `Skorowidze` WMS constants stay in the file **only** as a reference
  to the measurement-data catalogue, with a comment; they are no longer used
  to draw anything.

---

## 4. How to run / change things

```bash
# static server from the repo root — there is no build step
python3 -m http.server 8080
# → http://localhost:8080 → Layers → LIDAR → Poland · GUGiK NMT shading
```

| I want to… | Do this (all in `js/geoportal-nmt-layer.js`) |
|---|---|
| change the default product | `CONFIG.DEFAULT_MODE` |
| add another GUGiK service | add to `CONFIG.MODES` (check its GetCapabilities for the layer name first — do not guess) |
| change the zoom window / opacity | `CONFIG.MIN_ZOOM`, `CONFIG.MAX_NATIVE_ZOOM`, `CONFIG.OPACITY` |
| change the region | `CONFIG.BOUNDS` (the data is Poland-only) |
| force the 4326 path | `CONFIG.CRS = 'EPSG:4326'` |
| route tiles through a cache | `window.GEOPORTAL_NMT_PROXY_BASE = 'https://…/WMS'` before the script tag |

---

## 5. Licence, attribution and fair use

- **Service terms.** The WMS capabilities state *Brak opłat* (no fees) and:
  *"Wykorzystanie usługi nie podlega żadnym ograniczeniom z wyłączeniem
  automatycznego pobierania i kolekcjonowania obrazów (tzw. harvesting)."* —
  free use, **except automated bulk downloading / collecting of the images
  (harvesting)**. The WMTS metadata adds that using the service means
  accepting the Geoportal **Regulamin** published at
  <https://www.geoportal.gov.pl/>.
- **Data.** NMT / ISOK elevation data has been free of charge since the
  31 July 2020 amendment of the *Prawo geodezyjne i kartograficzne*; it is
  published through geoportal.gov.pl and dane.gov.pl.
- **Attribution shown on the map** (Leaflet attribution control, visible
  whenever the layer is on):
  `Cieniowanie: © GUGiK / Geoportal.gov.pl (dane ISOK/NMT)` with a link to
  geoportal.gov.pl.
- **Practical consequence of the harvesting clause:** this implementation is
  deliberately *demand-driven* — tiles are requested only for what the user
  looks at, `keepBuffer` is 1 and nothing is stored offline. A caching proxy
  (below) is fine because it caches what users already requested; a crawler
  that walks the tile pyramid to build an offline set is **not**.

### Optional caching proxy (recommended for production traffic)

**Nginx**

```nginx
proxy_cache_path /var/cache/nginx/gugik levels=1:2
                 keys_zone=gugik:50m max_size=20g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name nmt-cache.example.com;

    location /wss/service/PZGIK/NMT/ {
        proxy_pass         https://mapy.geoportal.gov.pl;
        proxy_set_header   Host mapy.geoportal.gov.pl;
        proxy_ssl_server_name on;

        proxy_cache            gugik;
        proxy_cache_key        "$scheme$request_method$host$request_uri";
        proxy_cache_valid      200 7d;     # the national DTM changes rarely
        proxy_cache_valid      404 1m;
        proxy_cache_use_stale  error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_lock       on;         # collapse duplicate tile requests
        proxy_ignore_headers   Set-Cookie;
        proxy_hide_header      Set-Cookie;
        add_header X-Cache-Status $upstream_cache_status;

        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "public, max-age=604800" always;
    }
}
```

**Cloudflare Worker**

```js
// HOYDEDATA-style worker; then
//   window.GEOPORTAL_NMT_PROXY_BASE = 'https://<worker>/wss/service/PZGIK/NMT/GRID1/WMS';
const UPSTREAM = 'https://mapy.geoportal.gov.pl';
const TTL = 60 * 60 * 24 * 7; // 7 days

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/wss/service/PZGIK/NMT/')) {
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
      response.headers.delete('Set-Cookie');
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

1. **Layers → LIDAR → Poland · GUGiK NMT shading** on, then fly to
   **Kraków, 50.06 N 19.94 E, zoom 12**. The shading should appear over the
   basemap. Below **zoom 10** it must disappear and send no requests; outside
   Poland it must send no requests at all.
2. **DevTools → Network**, filter `ShadedRelief`: requests look like
   `…/PZGIK/NMT/GRID1/WMS/ShadedRelief?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Raster&STYLES=&CRS=EPSG%3A3857&BBOX=…&WIDTH=256&HEIGHT=256&FORMAT=image%2Fpng&TRANSPARENT=TRUE`
   → **200**, `content-type: image/png`, **no `token=` parameter anywhere**,
   no 400/401/403.
3. **Alignment:** pick the Vistula valley in Kraków, or the Tatra ridge south
   of Zakopane, and confirm the shaded relief follows the basemap river /
   ridge line while zooming 11 → 16. (This is the one thing that could not be
   checked without a browser — if it is offset, set
   `CONFIG.CRS = 'EPSG:4326'` and compare.)
4. **Product switch:** choose *Hipsometria* — the layer turns into a colour
   height ramp; requests now go to `…/WMS/Hypsometry`.
5. **Opacity:** drag the row slider 0 → 100 %; the layer fades without
   reloading tiles.
6. **Attribution:** `Cieniowanie: © GUGiK / Geoportal.gov.pl (dane ISOK/NMT)`
   is visible in the attribution control while the layer is on, and the link
   opens geoportal.gov.pl.
7. **Errors:** go offline and pan — blank tiles, no broken-image icons, one
   console warning; after six failures the console reports the EPSG:4326
   fallback.

Automated: `node test-poland-geoportal-nmt.js` (84 checks — no token / no
mixed content, config against the live capabilities, GetMap parameter format,
tile-grid alignment with the standard EPSG:3857 XYZ grid, the 4326 fallback,
error handling and the app wiring).

---

## 7. Known limitations

- **No `GetFeatureInfo`.** The service answers `RequestNotAllowed`, so there
  is no click-to-read-elevation for Poland (unlike the Norwegian layer).
- **EPSG:3857 is undocumented** for `ShadedRelief` — it works today and the
  layer falls back to EPSG:4326 automatically if that ever changes. The
  fallback is marginally less accurate: each tile is requested as a
  lat/lon rectangle, so Mercator's within-tile non-linearity introduces a
  sub-pixel to ~2 px shear at z10, shrinking at higher zooms.
- **Server-side rendering.** Every tile is drawn on demand from the 1 m grid;
  the first visit to an area is slower than a cached basemap, and the
  government server can be slow at peak times. See the proxy in §5.
- **No harvesting.** Do not pre-generate or crawl tiles (see §5).
- **WMTS not used.** If GUGiK ever publishes a `GoogleMapsCompatible`
  TileMatrixSet for Cieniowanie, switching to WMTS would be faster (it is
  pre-cached server-side); today only EPSG:2180 exists.
- **Coverage.** Poland only, and the NMT mosaic is seamless but assembled
  from projects of different ages and point densities.
