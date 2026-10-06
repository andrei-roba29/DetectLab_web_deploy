# Denmark LiDAR layer — Danmarks Højdemodel hillshade from Dataforsyningen

The Denmark row of the LiDAR panel now fetches the **hillshade ("skyggekort")
of Danmarks Højdemodel**, the national LiDAR elevation model, live from
Dataforsyningen (Klimadatastyrelsen, formerly SDFI) as the user pans and
zooms. Nothing is downloaded or pre-generated.

| | |
| --- | --- |
| Service used | `https://api.dataforsyningen.dk/dhm_DAF` — **WMS 1.3.0 in EPSG:3857** |
| Default layer | `dhm_terraen_skyggekort` (bare-earth terrain hillshade) |
| Browser sees | `/api/geo/dk-dhm?service=WMS&request=GetMap&…` on **your own domain, with no token** |
| Token | server-side only, `DATAFORSYNINGEN_TOKEN` in `backend/.env` (gitignored) |
| Coverage | Denmark, `7.99125 54.4265 → 15.5995 57.7781` |
| Licence | Free geographic data, **CC BY 4.0** — "Indeholder data fra Klimadatastyrelsen, Danmarks Højdemodel" |

Code: **`js/dataforsyningen-dhm-layer.js`** (all configuration in one block at
the top, token deliberately *not* in it) + **`backend/src/routes/geoProxy.js`**
(token-adding, 7-day caching proxy). Tests:
**`node test-denmark-dataforsyningen-dhm.js`** (111 checks).

---

## 1. What was verified before coding (2026-10-06, live)

### 1.1 The WMTS (`dhm_terraen_skyggekort_DAF`)

`GetCapabilities` answers **without a token** (only imagery needs one):

| Question | Answer |
| --- | --- |
| Layer identifier | **`dhm_terraen_skyggekort`** |
| Styles | none published (a single, empty default style) |
| Formats | **`image/jpeg` only** — no transparency |
| TileMatrixSets | **`View1` and nothing else** |
| `View1` definition | CRS **`urn:ogc:def:crs:EPSG:6.3:25832`** (ETRS89 / UTM 32N), bounding box **120000 5900000 → 1000000 6500000**, top-left corner **120000 / 6500000**, tile size **256 × 256**, **14 levels (0–13)**, scale denominators **5 851 428.571 → 714.286** (= **1638.4 m/px → 0.2 m/px**), matrix sizes 3 × 2 … 17188 × 11719 |
| Layer extent | 2.47842 53.015 → 17.5578 58.6403 (the WGS84 envelope of the grid, not the data) |
| Example tile | the documented `TileMatrix=4&TileCol=15&TileRow=13` **without** a token → OGC `ExceptionReport`, *"User not authorized"* ⇒ a token is mandatory |

**So the warning in the brief is exactly right:** `View1` is a Danish national
grid, not XYZ. Treating it as `{z}/{x}/{y}` would put the hillshade hundreds of
kilometres from where it belongs.

### 1.2 Is there a Web Mercator option? — **Yes, via the WMS**

`https://api.dataforsyningen.dk/dhm_DAF?service=WMS&request=GetCapabilities&version=1.3.0`
(also readable without a token) publishes:

* **CRS list: `EPSG:4326, EPSG:4258, EPSG:25832, EPSG:25833, EPSG:32632,
  EPSG:32633, EPSG:4093–4096, EPSG:3395, EPSG:3857`** ⇒ **EPSG:3857 is
  supported**, the server reprojects.
* **Formats: `image/png`, `image/jpeg`** (+ GML/XML info formats) ⇒ PNG means
  real transparency, unlike the JPEG-only WMTS.
* Layers: `dhm_terraen_skyggekort` and `dhm_overflade_skyggekort`
  (extent **7.99125 54.4265 → 15.5995 57.7781**, MaxScaleDenominator 1e7),
  `dhm_kurve_traditionel` (2.5 m contours, max scale 130 000),
  `dhm_kurve_0_5_m` (16 000), `dhm_kurve_0_25_m` (11 000),
  `dhm_kote_0_5_m` / `dhm_kote_2_5_m`, `dhm_punktoprindelse`, `dhm_korrektion`.
* **Trap found the hard way:** `TRANSPARENT=true` is rejected —
  *"TRANSPARENT must be either TRUE or FALSE"*. It must be **upper case**.
* `GetMap` without a token → `ServiceException` *"User not authorized: User not
  authorized"*.

### 1.3 Chosen approach, and why

> **WMS `dhm_DAF` with `CRS=EPSG:3857` and `FORMAT=image/png`, requested one
> 256 px tile at a time through a same-origin proxy.**

* DetectLab is a **Leaflet map in Web Mercator** with OSM-style basemaps,
  CORONA imagery and seven other countries' LiDAR layers. Using the native
  `View1` grid would require `proj4leaflet` and switching the **whole map** to
  EPSG:25832 — every other layer would then be wrong. Not acceptable.
* MapLibre/OpenLayers users with a Danish-only map should prefer the native
  WMTS (see §3) — it is a pre-rendered cache and therefore faster.
* **Trade-off accepted:** a WMS GetMap is rendered on demand, so it is slower
  than a WMTS cache hit and has no upstream CDN cache. That is exactly why the
  proxy in §5 caches responses for 7 days.

### 1.4 Token, quota, CORS

| Question | What the documentation says |
| --- | --- |
| How is the token passed? | Either as the **HTTP header `token:`** — *"we recommend this, it is the most secure way"* — or as the query parameter `?token=…`. Dataforsyningen is stateless, so it must be sent on **every** request. HTTPS only; HTTP is not supported. (confluence.kds.dk → *Log ind og Token*) |
| Where does it come from? | Create a user on dataforsyningen.dk, then *Administrer token til webservice og API'er* → **OPRET NY TOKEN**. A user token is **32 hexadecimal characters**, has no expiry by default, and you can set a deletion date or delete/recreate it at any time. |
| Can it be restricted to my domain or IP? | **No such option is documented.** The only controls are: multiple tokens per user, an optional auto-delete date, and deleting a compromised token. ⇒ a browser-visible token can be used by anyone who copies it; use the proxy. |
| Rate limit / quota | **Nothing published.** No numeric quota or fair-use figure appears in the Dataforsyningen documentation, the service capabilities or the dataset pages. Treat it as a shared public resource (§5). *Not verifiable here.* |
| CORS | The API gateway **echoes the caller's Origin** (`access-control-allow-origin: https://<your-site>`, `vary: Origin`) rather than sending `*`. So `<img>` tiles, `fetch()` and canvas reads all work in direct mode. Through the proxy the question disappears — the tiles are same-origin. |
| Exceptions to the token rule | DAWA and the INSPIRE OGC services are token-free; the DHM services are not. |

### 1.5 What I could **not** verify

* **Nothing was ever requested with a real token** — I do not have one. Every
  imagery call above returned the "User not authorized" exception, which is
  itself the proof that the token is required. The first real tile must be
  checked by you (§6, step 2).
* Visual alignment and appearance, and the real-world speed of the WMS
  reprojection.
* The exact quota (none is published).

### 1.6 What changed in the app

The row previously called **Datafordeler** (`wms.datafordeler.dk/DHMNedboer/…`)
with `apikey=` taken from `window.DETECTLAB_DK_API_KEY` — a *client-side* key,
on a different platform (Datafordeler needs a username/password-based service
user, not a Dataforsyningen token), and the layer had no product choice and no
bounds. It is replaced by the Dataforsyningen WMS behind the token proxy.
`window.DENMARK_LIDAR_WMS_URL` is kept for external callers.

---

## 2. How to run

### 2.1 With the backend proxy (recommended — no token in the browser)

```bash
# 1. put your token in the gitignored backend env file
cd backend
cp .env.example .env            # if you do not have one yet
echo "DATAFORSYNINGEN_TOKEN=YOUR_TOKEN" >> .env

# 2. start the API (serves /api/geo/dk-dhm)
npm start                       # or: npm run dev

# 3. serve the static site
cd ..
python3 -m http.server 8080     # or your usual static host
```

In production the static site and `/api/*` must be on the **same origin** (the
existing DetectLab deployment already proxies `/api` to the Node backend), so
the browser requests `/api/geo/dk-dhm?…` with no token and no CORS.

Then: **LiDAR panel → "Denmark · DHM hillshade (DHM/Terræn)"** → toggle on,
pick a product, drag the opacity slider.

Run the tests:

```bash
node test-denmark-dataforsyningen-dhm.js
```

### 2.2 Without a backend — client-side token (**INSECURE**)

If you host the site statically and cannot run the proxy:

```html
<!-- before js/map-app.js -->
<script>window.DETECTLAB_DK_TOKEN = 'YOUR_TOKEN';</script>
```

The module then calls `api.dataforsyningen.dk` directly with `?token=…`.
**Every visitor can read that token and use your quota.** Limit the damage:

* use a **dedicated token** created only for this site, never your main one;
* give it an **auto-delete date** in the Dataforsyningen token administration
  and rotate it regularly;
* watch for abuse and delete/recreate the token if it leaks further;
* Dataforsyningen does **not** offer domain or IP restrictions, so there is no
  way to pin it to your site — this is why the proxy is the default.

Never commit the token: keep it in a gitignored `config.local.js`, inject it at
deploy time, or (best) use the proxy.

---

## 3. How to change the layer, product, region or anything else

Everything tunable is in the single `CONFIG` block at the top of
`js/dataforsyningen-dhm-layer.js` (**the token is not there on purpose**):

```js
var CONFIG = {
    PROXY_PATH: '/api/geo/dk-dhm',                        // same-origin, token added server-side
    DIRECT_URL: 'https://api.dataforsyningen.dk/dhm_DAF', // insecure client-token mode only
    WMS_VERSION: '1.3.0',
    CRS: 'EPSG:3857',        // matches the basemap
    FORMAT: 'image/png',     // transparency (the WMTS is JPEG only)
    TRANSPARENT: 'TRUE',     // upper case — the service rejects "true"
    MODES: {
        terrain:      { layer: 'dhm_terraen_skyggekort',   minZoom: 6  },
        surface:      { layer: 'dhm_overflade_skyggekort', minZoom: 6  },
        contours:     { layer: 'dhm_kurve_traditionel',    minZoom: 12 },
        contoursFine: { layer: 'dhm_kurve_0_5_m',          minZoom: 15 }
    },
    OPACITY: 0.6, MIN_ZOOM: 6, MAX_ZOOM: 20, KEEP_BUFFER: 1,
    BOUNDS: [[54.4265, 7.99125], [57.7781, 15.5995]],
    ATTRIBUTION: 'Indeholder data fra Klimadatastyrelsen, Danmarks Højdemodel (CC BY 4.0)',
    AUTH_MESSAGE: 'Invalid or missing Dataforsyningen token'
};
```

* **Add a product** → one more `MODES` entry with the WMS layer name and the
  `minZoom` implied by its `MaxScaleDenominator`, and add the layer name to
  `ALLOWED_LAYERS` in `backend/src/routes/geoProxy.js` (the proxy is not an
  open relay). The `<select>` is refilled from
  `window.DataforsyningenDHM.modeKeys()` at start-up.
* **Change the region** → `BOUNDS` (`[[southLat, westLng], [northLat, eastLng]]`).
* **Change the default opacity** → `OPACITY` (the slider in `index.html` starts
  at the matching `value="60"`).
* **Point at a different host** (e.g. a CDN in front of your proxy) →
  `PROXY_PATH`.

### Using the native WMTS instead (OpenLayers / MapLibre)

If your map can be Danish-only, the native `View1` grid is faster. In
OpenLayers, with the token added by your proxy:

```js
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs');
ol.proj.proj4.register(proj4);

const resolutions = [];           // 1638.4 → 0.2 m/px, 14 levels
for (let z = 0; z < 14; z++) resolutions.push(1638.4 / Math.pow(2, z));

new ol.layer.Tile({
  opacity: 0.6,
  source: new ol.source.WMTS({
    url: '/api/geo/dk-dhm-wmts',                    // your proxy → dhm_terraen_skyggekort_DAF
    layer: 'dhm_terraen_skyggekort',
    matrixSet: 'View1',
    format: 'image/jpeg',
    projection: 'EPSG:25832',
    tileGrid: new ol.tilegrid.WMTS({
      origin: [120000, 6500000],                    // from GetCapabilities
      resolutions,
      matrixIds: resolutions.map((_, z) => String(z)),
      tileSize: 256
    }),
    attributions: 'Indeholder data fra Klimadatastyrelsen, Danmarks Højdemodel (CC BY 4.0)'
  })
});
```

MapLibre has no custom-grid support: use the **WMS** instead, with
`{bbox-epsg-3857}` so the server reprojects:

```js
map.addSource('dk-dhm', {
  type: 'raster', tileSize: 256,
  bounds: [7.99125, 54.4265, 15.5995, 57.7781],
  tiles: ['/api/geo/dk-dhm?service=WMS&request=GetMap&version=1.3.0' +
          '&layers=dhm_terraen_skyggekort&styles=&crs=EPSG:3857' +
          '&bbox={bbox-epsg-3857}&width=256&height=256' +
          '&format=image%2Fpng&transparent=TRUE'],
  attribution: 'Indeholder data fra Klimadatastyrelsen, Danmarks Højdemodel (CC BY 4.0)'
});
map.addLayer({ id: 'dk-dhm', type: 'raster', source: 'dk-dhm',
               paint: { 'raster-opacity': 0.6 } });
```

---

## 4. Licence, attribution and conditions

* **Licence: CC BY 4.0.** The dataset pages on dataforsyningen.dk state:
  *"Anvendelsen af frie geografiske data reguleres af CC BY 4.0 licensen"* —
  free for the public sector, companies, associations and private use, for
  commercial and non-commercial purposes alike. Data owner:
  **Klimadatastyrelsen** (the agency formerly known as SDFI / Styrelsen for
  Dataforsyning og Infrastruktur).
* **Attribution is the condition.** The agency's *Vilkår for brug af frie
  geografiske data* asks for a source statement in the form
  *"Indeholder data fra Styrelsen for Dataforsyning og Infrastruktur,
  Danmarks Højdemodel, <date>"*, that the agency's name appears on the front
  of the service if other sources are credited there, and that a copy of (or a
  link to) the terms is available to third parties. With the renaming, the
  layer shows in the Leaflet attribution control whenever it is on:

  > Indeholder data fra **Klimadatastyrelsen**, Danmarks Højdemodel (CC BY 4.0)

  with links to dataforsyningen.dk and to the CC BY 4.0 deed.
* The data may **not** be used in a way that suggests the agency endorses you,
  and it is supplied "as is", with no guarantee of continued availability.
* A **token is required** for every imagery request (§1.4) — it is an access
  credential, not a licence fee; there is no charge.

---

## 5. Being a good citizen of a public agency server

* `keepBuffer: 1`, `updateWhenZooming: false`, `updateWhenIdle: true` — no tile
  storm while dragging or pinch-zooming, no far-viewport preloading;
* `bounds` clipped to the published Danish extent and a per-product `minZoom`
  (6 for the hillshades, 12/15 for the contours, matching each layer's
  `MaxScaleDenominator`) — no request is sent where the service would render
  nothing;
* **every GetMap is a live render**, so caching matters much more here than for
  a WMTS. The bundled proxy already caches 7 days; put a CDN in front of it for
  production traffic.

### The bundled Node/Express proxy

`backend/src/routes/geoProxy.js`, mounted at `/api`:

* adds the token as the **`token:` header** (the documented, safer form);
* **ignores** any token sent by the client;
* is **not an open proxy**: fixed upstream host and service, whitelisted
  layers, whitelisted formats (`image/png`, `image/jpeg`), `GetMap`/
  `GetCapabilities` only, width/height ≤ 1024;
* caches successful responses in a bounded in-process LRU for **7 days** and
  returns `Cache-Control: public, max-age=604800, immutable` with an
  `X-Proxy-Cache: HIT|MISS` header;
* answers **401 `{"error":"dataforsyningen_token_missing"}`** when the
  environment variable is absent and **401 `…_token_invalid`** when the agency
  refuses — which is what drives the client's non-blocking notice;
* never logs the token.

### Nginx variant (token in the proxy config, 7-day cache)

```nginx
proxy_cache_path /var/cache/nginx/dkdhm levels=1:2 keys_zone=dkdhm:50m
                 max_size=10g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name example.com;

    location /api/geo/dk-dhm {
        # The token lives here, in a file only root can read — never in the client.
        proxy_set_header token  $DATAFORSYNINGEN_TOKEN;   # or hard-code it in this file
        proxy_set_header Host   api.dataforsyningen.dk;
        proxy_ssl_server_name   on;
        proxy_pass https://api.dataforsyningen.dk/dhm_DAF$is_args$args;

        proxy_cache           dkdhm;
        proxy_cache_key       "$args";
        proxy_cache_valid     200 7d;
        proxy_cache_valid     400 401 403 404 1m;   # never cache an auth failure for long
        proxy_cache_lock      on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header            X-Cache-Status $upstream_cache_status;
        add_header            Cache-Control "public, max-age=604800";
    }
}
```

### Cloudflare Worker variant (token in a Worker secret, 7-day cache)

```js
// wrangler secret put DATAFORSYNINGEN_TOKEN
export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/geo/dk-dhm')) return new Response('Not found', { status: 404 });

    const upstream = new URL('https://api.dataforsyningen.dk/dhm_DAF');
    for (const [k, v] of incoming.searchParams) {
      if (k.toLowerCase() !== 'token') upstream.searchParams.set(k, v);
    }

    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) return response;

    const upstreamRes = await fetch(upstream.toString(), {
      headers: { token: env.DATAFORSYNINGEN_TOKEN },   // never exposed to the browser
      cf: { cacheTtl: 604800, cacheEverything: true }
    });
    const type = upstreamRes.headers.get('content-type') || '';
    if (!upstreamRes.ok || type.includes('xml')) {
      return new Response(JSON.stringify({ error: 'dataforsyningen_token_invalid' }),
        { status: 401, headers: { 'content-type': 'application/json' } });
    }

    response = new Response(upstreamRes.body, upstreamRes);
    response.headers.set('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
```

---

## 6. Manual test checklist

1. **Token in place.** `backend/.env` contains `DATAFORSYNINGEN_TOKEN=…` and
   the API is running. `curl -s -o /dev/null -w '%{http_code} %{content_type}\n'
   "http://localhost:3000/api/geo/dk-dhm?service=WMS&request=GetMap&version=1.3.0&layers=dhm_terraen_skyggekort&styles=&crs=EPSG:3857&bbox=1389319,7484713,1399103,7494497&width=256&height=256&format=image%2Fpng&transparent=TRUE"`
   → **`200 image/png`**.
2. **Network panel.** Zoom to Copenhagen (55.68 N, 12.57 E) at z10–12 with the
   Denmark row on at 60 %. In DevTools → Network every tile goes to
   **your own domain** (`/api/geo/dk-dhm?…`), returns **200 `image/png`**, and
   **no `token=` appears in any URL**. Second pass over the same area shows
   `X-Proxy-Cache: HIT`.
3. **Alignment.** Check the coastline: Amager and the Øresund shore, the
   Limfjord, or Lake Arresø. The hillshade edge must follow the basemap
   coastline exactly — a visible offset means the CRS is wrong (that is what
   would happen if the `View1`/EPSG:25832 grid were used as XYZ).
4. **Toggle.** Off removes every tile and the attribution; on restores both.
5. **Opacity slider.** 0 % → invisible, 100 % → opaque; the label follows and
   the setting survives a product switch.
6. **Dropdown.** *DHM Overflade* adds buildings and trees to the shading.
   *Højdekurver 2.5 m* draws contour lines (only from z12; nothing below).
   *Højdekurver 0.5 m* only from z15.
7. **Bad token.** Stop the API (or set an invalid token) and reload with the
   row on: a single small notice **"Invalid or missing Dataforsyningen token"**
   appears at the bottom of the screen and disappears by itself; no
   broken-image icons, no repeated console errors, the map stays usable.
8. **Outside coverage.** Pan to Hamburg or Stockholm: no tile requests at all.
9. **Other countries untouched.** Norway, Poland, Spain, Netherlands,
   Switzerland and England rows still behave as before.

---

## 7. Known limitations

* **A token is mandatory**, and Dataforsyningen offers no domain/IP pinning —
  so the proxy (or an equally server-side cache) is the only safe deployment.
  Without the backend the client-token mode works but exposes the token.
* **WMS, not WMTS.** Every tile is rendered on demand, so a cold view is
  slower than a cached WMTS tile would be and there is no upstream CDN cache;
  the 7-day proxy cache is doing the heavy lifting.
* **No Web Mercator tile cache exists upstream** — the only published grid is
  `View1` (EPSG:25832, JPEG). If DetectLab ever becomes Denmark-only, §3 shows
  the faster native-grid route.
* **It is a rendered hillshade, not elevation data.** For heights use the DHM
  WCS or the `dhm_kote_*` layers.
* **The hillshade is opaque where there is data**, hence the 0.6 default — at
  100 % it hides the basemap completely.
* **Nothing below z6** (MaxScaleDenominator 1e7) and nothing below z12/z15 for
  the contour layers: the service returns an empty image there by design.
* **No published rate limit** — unverifiable; be conservative and cache.
