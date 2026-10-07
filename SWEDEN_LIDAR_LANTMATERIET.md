# Sweden LiDAR — Lantmäteriet terrängskuggning (live WMS tiles)

**Status: 2026-10-07.** A new *Sweden · Terrängskuggning (höjdmodell 1 m)* row
in the LiDAR panel renders terrain shading and slope images computed from
Lantmäteriet's national LiDAR height model, one WMS `GetMap` request per
Leaflet tile, live as the user pans and zooms. Nothing is downloaded or
pre-generated.

Scope: **this change touches the Sweden row only.** Every other LiDAR country
(Netherlands, Norway, Poland, Spain, Switzerland, England, France, Denmark) is
untouched, and their test suites still pass.

---

## 1. The licensing answer, first — is `minkarta.lantmateriet.se` allowed?

**No. Not for a public website.** Use it to look at the layer while you are
signing an agreement, and nothing else.

The URL in the brief,
`https://minkarta.lantmateriet.se/map/hojdmodell`, is the backend of
Lantmäteriet's own end-user viewer **Min karta**. It answers without any
credentials, which makes it *look* like an open service. It is not. Five
independent pieces of evidence, all checked live:

| # | Evidence | Where it came from |
|---|---|---|
| 1 | Its `GetCapabilities` carries the metadata id **`fdd69965-97f5-4296-88de-0f1a4316eafa`** | the live 1.1.1 capabilities document |
| 2 | That id is the INSPIRE record for the product **"Markhöjdmodell Visning"** (ex "Höjdmodell Visning"), whose *Resource constraints* read: *"Licens för användning av resurs krävs. Avgift för användning av resurs tas ut…"* — **a licence is required and a fee is charged** | [INSPIRE Geoportal record](https://inspire-geoportal.ec.europa.eu/srv/api/records/fdd69965-97f5-4296-88de-0f1a4316eafa?language=all) |
| 3 | The Geotorget product card for *Markhöjdmodell Visning* says **Avgift: Ja**, *Villkor: Avtalsvillkor*, **Licensavgift 75 625,00 kr/år incl. VAT**, and publishes the real access point as `https://maps.lantmateriet.se/hojdmodell/wms/v1.1` | [geotorget.lantmateriet.se](https://geotorget.lantmateriet.se/geodataprodukter/markhojdmodell-visning-api) |
| 4 | That access point answers **`401 Authorization Required` (nginx)** — verified | live request |
| 5 | When Locus Map asked Lantmäteriet about consuming the Min karta services from a third-party client, the answer was *"That service is not for free access with other clients."* The Swedish OSM community reached the same conclusion for the same reason: *"man får inte använda Minkarta-tjänsten utan tillåtelse"* | [help.locusmap.eu](https://help.locusmap.eu/topic/support-for-swedish-lantmateriets-min-karta-wms), [community.openstreetmap.org](https://community.openstreetmap.org/t/wms-server-lantmateriet/137129) |

Lantmäteriet's own **Min karta** terms are narrow and confirm this: you may
publish *"bilder eller skärmklipp"* — images or screenshots — from Min karta,
marked `© Lantmäteriet` + CC BY 4.0. Permission to publish a screenshot is not
permission to wire the service into your map as a live tile source.

One more trap worth stating plainly: **the 2025 EU High-Value-Datasets (HVD)
reform did not make this service free.** It made *downloads* free.
Lantmäteriet's own summary of the change says it explicitly —
*"Visningstjänster har kvar avgiften"* (view services keep the fee).

### What to use instead

| Option | Cost | Live tiles? | Terms | Verdict |
|---|---|---|---|---|
| **A. Geotorget "Markhöjdmodell Visning"** WMS at `maps.lantmateriet.se/hojdmodell/wms/v1.1` | **75 625 kr/yr** incl. VAT | ✅ yes, exactly what we built | Avtalsvillkor, `© Lantmäteriet` | **The sanctioned route. This is what the code targets by default.** |
| **B. Geotorget "Markhöjdmodell Nedladdning"** — 1 m DTM as COG via STAC, `api.lantmateriet.se/stac-hojd/v1` | **0 kr** | ❌ download, you render hillshade yourself | *Användningsvillkor för värdefulla datamängder* (HVD) — **not CC0** | The free path, but it means hosting your own raster pipeline |
| **C. Geotorget "Laserdata Nedladdning, skog"** — classified point cloud (COPC) via the same STAC API | **0 kr** | ❌ download | *Användningsvillkor för Laserdata Nedladdning, skog* | Best raw data; heaviest to operate |
| D. `minkarta.lantmateriet.se` | 0 kr | ✅ | **none that cover you** | ❌ not for production |

Both free options still need a **Geotorget account** (free to create) and an
ordered *behörighet* for the product; the fee is what is zero, not the
paperwork.

> If the 75 625 kr/yr is not in budget, the honest engineering answer is
> **option B**: pull 1 m DTM COGs for the areas you care about and serve your
> own hillshade. That is a different feature from this one, and it is the only
> free way to get Swedish LiDAR terrain shading onto a public site legally.

---

## 2. What was verified live, and what was not

Checked on **2026-10-07** against `minkarta.lantmateriet.se/map/hojdmodell`
(the only reachable instance — the licensed one is behind 401, by design).

### Verified ✅

| Question | Answer |
|---|---|
| Does `GetCapabilities` respond? | **Yes**, both `VERSION=1.1.1` and `1.3.0`. Title *"Visningstjänst höjdmodell"*. Content-type `application/vnd.ogc.wms_xml`. |
| What software is it? | **MapServer** — an invalid `LAYERS` returns `msWMSLoadGetMapParams(): WMS server error. Invalid layer(s) given…`. (Relevant if you use OpenLayers: `serverType: 'mapserver'`.) |
| **Is there more than `terrangskuggning`?** | **Yes — four layers**: `terrangskuggning` (Terrängskuggning), `terranglutning` (Terränglutning, gråton — slope in greyscale), `terranglutning_brunton` (Terränglutning, brunton — slope in brown/purple), `ursprung_kvalitet` (Ursprung och kvalitet — source & quality metadata). All four are in the dropdown. |
| **Is EPSG:3857 supported?** | **Yes.** The advertised SRS list is `epsg:3006–3018, 3021, 3034, 3035, 3044–3047, `**`3857`**`, 4258, 4326, 4619, 25832–25835, 32632–32635`. So **no proj4leaflet, no custom CRS, no Swedish-only basemap** — the EPSG:3006 end-to-end fallback described in the brief is not needed. |
| Formats | `image/png`, `image/jpeg`, `image/png; mode=8bit`. |
| Bounding box | `EX_GeographicBoundingBox` = **6.31918 53.90617 → 29.28575 72.0992**. |
| **Scale limits?** | **None.** There is no `ScaleHint` and no `Min/MaxScaleDenominator` anywhere in either capabilities document. The zoom window in the code is therefore our own politeness policy, not a server constraint. |
| Max image size | `MaxWidth` = `MaxHeight` = **4096**. 256 px tiles are far inside it. |
| Does the example `GetMap` work? | **Yes.** The brief's EPSG:3006 request returns a real **256×256 RGBA PNG** (`format: png, channels: 4, hasAlpha: true`). |
| **Does EPSG:3857 render?** | **Yes.** `SRS=EPSG:3857` with a Web-Mercator bbox over Stockholm (`2011211.0882, 8251530.0774, 2011822.5845, 8252141.5737`, z16) returns an identical-shape 256×256 RGBA PNG. |
| What happens on an error? | A **`ServiceException` XML document**, not an image — so a plain `<img>` tile would show a broken-image icon. Handled (§4). |
| Referer / cookie check? | **No.** The requests above were made from a third-party image proxy with no `Referer` and no cookies, and still returned PNGs. |
| Credentials on the *licensed* endpoint | `maps.lantmateriet.se/hojdmodell/wms/v1.1` → **`401 Authorization Required`** from nginx. |

### Not verified ❌ — and how to close each gap

| Gap | Why | How you close it |
|---|---|---|
| **Visual alignment against a basemap.** | This build environment has no direct network egress and cannot render a map. The alignment is instead pinned *numerically*: the test asserts the generated bbox equals the canonical Web-Mercator XYZ tile extent to 0.01 m (`test-sweden-lantmateriet-hojdmodell.js`, section 5). | Manual checklist, §7 — look at the Stockholm archipelago shoreline. |
| **CORS response headers.** | Header inspection was not possible through the available proxies. | Irrelevant as built: tiles are plain `<img>` (`crossOrigin: false`), which never needs CORS. It only matters if you later read tiles into a canvas. |
| **Rate limits / fair-use policy.** | Not published anywhere we could find for this service. | Assume there is one. The caching proxy (§6) is the mitigation. |
| **Which auth scheme the licensed endpoint wants** (Basic vs OAuth2 Bearer). | Needs an actual agreement to test. | The proxy supports **both** — set either `LANTMATERIET_WMS_USER`/`_PASSWORD` or `LANTMATERIET_WMS_TOKEN`. |
| Whether the licensed WMS at `v1.1` publishes the identical four layers. | Behind 401. | Run `GetCapabilities` through your own proxy once you have credentials; the layer allowlist is one constant in two files. |

---

## 3. Licence and attribution — exactly what applies

**This dataset is NOT CC0.** The brief's assumption ("Lantmäteriet's open data
is, as far as I know, published under CC0") is correct *in general* — most of
Lantmäteriet's open data is CC0 — but it is **wrong for this specific product**.

| Product | Licence |
|---|---|
| Markhöjdmodell **Visning** (this WMS) | Fee-based **Avtalsvillkor** (contract terms) agreed through Geotorget. Not CC0, not CC BY. |
| Markhöjdmodell **Nedladdning** (1 m DTM, 0 kr) | *Användningsvillkor för värdefulla datamängder* (the Swedish HVD terms). Not CC0. |
| Laserdata Nedladdning, **skog** (0 kr) | *Användningsvillkor för Laserdata Nedladdning, skog*. Not CC0. |
| Screenshots of **Min karta** | `© Lantmäteriet`, CC BY 4.0, note if the data was processed. |

**Required attribution, as shipped:**

```
Terrängskuggning © Lantmäteriet
```

It is attached to the Leaflet layer (`CONFIG.ATTRIBUTION`), so Leaflet's
attribution control shows it automatically whenever the layer is on, and hides
it when it is off. Your Geotorget agreement is the authority on the exact
wording — if it asks for something else, change the one string in
`js/lantmateriet-hojdmodell-layer.js`.

---

## 4. What was built

### `js/lantmateriet-hojdmodell-layer.js` (new, no build step, Leaflet 1.x only)

Every tunable lives in one marked `CONFIG` block at the top: source selection,
proxy path, both service URLs, WMS version, CRS, format, transparency, tile
size, the four layers, opacity, the zoom window, bounds and attribution.
**No credential is in, or can be in, that block.**

| Export | Purpose |
|---|---|
| `LantmaterietHojdmodell.CONFIG` / `.MODES` | the configuration block |
| `.source()` | `'geotorget'` (default) or `'minkarta'` |
| `.endpoint()` | proxy path, or the Min karta URL in evaluation mode |
| `.isProxied()` | `true` when nothing secret can be in the browser |
| `.tileUrl(mode, bbox, size)` | pure URL builder (used by the tests) |
| `.createLayer(opts)` | `L.TileLayer` subclass — one `GetMap` per tile |
| `layer.setMode(key)` | switches layer and redraws **in place** |

**Request shape** (this is the part that decides whether the hillshade lines
up):

```
SERVICE=WMS  REQUEST=GetMap  VERSION=1.1.1
LAYERS=terrangskuggning  STYLES=
SRS=EPSG:3857            ← 1.1.1 spelling. 1.3.0 uses CRS= and swaps the axis
BBOX=minx,miny,maxx,maxy ← Web-Mercator metres, never lat/lon
WIDTH=256  HEIGHT=256
FORMAT=image/png  TRANSPARENT=true  TILED=true
```

WMS **1.1.1 on purpose**: it takes `SRS=` and always uses
`minx,miny,maxx,maxy`. WMS 1.3.0 takes `CRS=` and swaps the axis order for
geographic CRSs such as EPSG:4326 — the classic cause of an offset or mirrored
hillshade. EPSG:3857 is easting/northing so it would be safe either way, but
1.1.1 removes the question entirely.

The bbox is not computed by hand: it comes from Leaflet's own
`_tileCoordsToBounds(coords)` projected with the map's CRS, which is what makes
it land on the basemap tile exactly.

**Behaviour**

- **Opacity** default **0.7**, driven by the existing row slider.
- **Zoom window** `minZoom 8`, `maxNativeZoom 17`, `maxZoom 20`. The model is a
  1 m grid; at 60° N a pixel is ~1.2 m at z16 and ~0.6 m at z17, so 17 is
  already oversampled — above it Leaflet upscales the last real tiles instead
  of asking the server for more. Below z8 one tile spans ~156 km of shaded 1 m
  DEM for no visible detail.
- **Bounds** clipped to Sweden (`55.20 N 10.80 E → 69.20 N 24.30 E`, the real
  extremes rounded outwards) rather than the capabilities box, which spills
  into the North Sea, Norway and Finland. A rectangle cannot separate Malmö
  from Copenhagen, so that one corner is unavoidable; those tiles come back
  empty.
- **Tile errors**: `errorTileUrl` is a 1×1 transparent PNG, so a
  `ServiceException` document or a 401 becomes "no tile" — no broken-image
  icons, no retry storm. **One** console warning per layer, ever. The first
  failure fires a single 1×1 px probe that distinguishes a credentials problem
  (401/403, or an exception body mentioning authorisation) from an ordinary gap
  in the data, and shows one dismissible, auto-expiring notice.
- **Gesture safety** `updateWhenZooming: false`, `updateWhenIdle: true`,
  `keepBuffer: 1` (shared with `js/tile-perf.js` when present) — small buffer,
  no preloading far outside the viewport.

### `backend/src/routes/geoProxy.js` — route `/api/geo/se-hojdmodell`

Joins the existing Danish proxy in the same file. Adds the `Authorization`
header server-side, so the browser never sees a credential. Not an open relay:
one pinned upstream host, an allowlist of the four layers, of formats and of
request types, a 1024 px size cap, and a 7-day LRU cache.

### `netlify/functions/se-hojdmodell.mjs` (new) + `netlify.toml`

The same route for the static Netlify deployment, with
`Netlify-CDN-Cache-Control: public, s-maxage=604800` so a popular area is
fetched from Lantmäteriet once rather than once per visitor. Both proxies
expose the identical path and allowlists, so the browser does not care which
one is in front of it.

### `index.html` / `js/map-app.js` / `sw.js`

- `js/lantmateriet-hojdmodell-layer.js?v=20261007-se-hojdmodell` loaded before
  `map-app.js`, precached by the service worker
  (`detectlab-v162-se-hojdmodell`).
- New `seLidar` row: on/off toggle, four-item dropdown, opacity slider at 70 %,
  ⓘ info panel that states the service is not open data, and the attribution
  attached to the layer.
- `window.setSwedenLidarMode(key)` switches product without rebuilding.

---

## 5. How to run it

### Locally, right now, without an agreement (evaluation only)

```bash
cd /path/to/DetectLab_web_deploy
python3 -m http.server 8080
```

**Fastest check — the standalone page.** Open
<http://localhost:8080/tools/sweden-lidar-demo.html>. It is a self-contained
Leaflet map (OSM basemap + this module, no auth, no app shell) centred on the
Stockholm archipelago, with the layer toggle, the product dropdown, the
opacity slider and a live read-out of the exact query string on the wire. It
defaults to the Min karta backend because that is the only source that answers
without credentials — the whole point is to let you confirm the alignment with
your own eyes. The `Service` dropdown switches it to the proxied, licensed
route.

**In the real app.** Open <http://localhost:8080/>, then **before** the map
initialises (DevTools console works, or add it to a local scratch `<script>`):

```js
window.DETECTLAB_SE_WMS_SOURCE = 'minkarta';
```

Reload, open the LiDAR panel, enable **Sweden · Terrängskuggning**. The module
prints one loud warning telling you this source is not licensed for
third-party use. **Do not ship this.**

### In production (the sanctioned route)

1. **Get the product.** Create an account at
   <https://geotorget.lantmateriet.se/>, open
   *Markhöjdmodell Visning* → **Beställ behörighet**, accept the Avtalsvillkor
   and pay the licence fee (75 625 kr/yr incl. VAT at the time of writing;
   the fee scales with area — LMFS lists 0,34 kr/km²/yr with a cap). Contact
   `geodatasupport@lm.se` if the fee model needs discussing. Lantmäteriet then
   issues credentials for the service.

2. **Put them in the environment — never in the repo.**

   Express backend (`backend/.env`):
   ```bash
   LANTMATERIET_WMS_USER=your-consumer-account
   LANTMATERIET_WMS_PASSWORD=your-password
   # …or, if your agreement issues an OAuth2 token instead:
   # LANTMATERIET_WMS_TOKEN=...
   ```
   Netlify: the same names under *Site settings → Environment variables*.

3. **Leave `CONFIG.SOURCE` at `'geotorget'`** (the default) and deploy. The
   browser requests `/api/geo/se-hojdmodell?...`; the proxy attaches the
   `Authorization` header and caches the tile for 7 days.

If the credentials are missing or wrong, the proxy answers `401`, the tiles
come back transparent, and the map shows one dismissible notice — *"Missing or
invalid Lantmäteriet (Geotorget) credentials"*. Nothing crashes.

### Changing layer or region

- **Different layer**: pick it in the row's dropdown, or change
  `CONFIG.DEFAULT_MODE`. To add one, add an entry to `CONFIG.MODES` **and** to
  the `ALLOWED_LAYERS` set in both proxies (the allowlist is deliberate).
- **Different region**: `CONFIG.BOUNDS` (`[[south, west], [north, east]]`) and
  `INTERNATIONAL_LIDAR_BOUNDS.seLidar` in `js/map-app.js`.
- **Different zoom window**: `CONFIG.MIN_ZOOM` / `MAX_NATIVE_ZOOM` / `MAX_ZOOM`.

---

## 6. Caching proxies (do this before any real traffic)

A WMS `GetMap` is **rendered on demand**. It is far more expensive for the
server than a pre-cached WMTS tile, and this is a government server you are
paying per km² to use. Cache aggressively — the hillshade of a national height
model changes a few times a year at most.

The Express and Netlify proxies above already cache for 7 days. If you prefer
to terminate in front of the app:

### Nginx

```nginx
# /etc/nginx/conf.d/lantmateriet-cache.conf
proxy_cache_path /var/cache/nginx/lm levels=1:2 keys_zone=lm_cache:50m
                 max_size=10g inactive=30d use_temp_path=off;

server {
    listen 443 ssl http2;
    server_name tiles.example.com;

    location /api/geo/se-hojdmodell {
        # Credentials stay on the server. Generate once:
        #   printf 'user:password' | base64
        proxy_set_header Authorization "Basic BASE64_USER_COLON_PASSWORD";
        proxy_set_header Host maps.lantmateriet.se;

        proxy_pass https://maps.lantmateriet.se/hojdmodell/wms/v1.1$is_args$args;

        proxy_cache            lm_cache;
        proxy_cache_key        "$request_uri";
        proxy_cache_valid      200 7d;      # 7 days for real tiles
        proxy_cache_valid      any 1m;      # don't cache errors for long
        proxy_cache_use_stale  error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_lock       on;          # one upstream fetch per tile, not N
        add_header X-Cache-Status $upstream_cache_status;
        add_header Cache-Control "public, max-age=604800, immutable";
    }
}
```

### Cloudflare Worker

```js
// wrangler secret put LM_USER   /   wrangler secret put LM_PASSWORD
const UPSTREAM = 'https://maps.lantmateriet.se/hojdmodell/wms/v1.1';
const ALLOWED_LAYERS = new Set([
  'terrangskuggning', 'terranglutning', 'terranglutning_brunton', 'ursprung_kvalitet'
]);

export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url).searchParams;

    const get = (n) => {
      for (const [k, v] of incoming) if (k.toLowerCase() === n) return v;
      return '';
    };
    if (get('request').toLowerCase() !== 'getmap') return new Response('no', { status: 400 });
    if (!ALLOWED_LAYERS.has(get('layers'))) return new Response('no', { status: 400 });
    if (Number(get('width')) > 1024 || Number(get('height')) > 1024) {
      return new Response('no', { status: 400 });
    }

    const upstream = new URL(UPSTREAM);
    for (const [k, v] of incoming) {
      if (['token', 'user', 'pass', 'password'].includes(k.toLowerCase())) continue;
      upstream.searchParams.set(k, v);
    }

    // Cache on the stripped URL, so a client cannot poison the key.
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const auth = 'Basic ' + btoa(`${env.LM_USER}:${env.LM_PASSWORD}`);
    const res = await fetch(upstream.toString(), { headers: { Authorization: auth } });

    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('xml') || type.includes('html')) {
      // ServiceException or 401 → "no tile", never a cached error image.
      return new Response(null, { status: res.status === 401 ? 401 : 502 });
    }

    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  }
};
```

Then point the layer at it:

```js
window.LantmaterietHojdmodell.CONFIG.PROXY_PATH = 'https://tiles.example.com/api/geo/se-hojdmodell';
```

---

## 7. Manual test checklist

Run `node test-sweden-lantmateriet-hojdmodell.js` first (133 automated checks,
including the exact tile geometry). Then, in a browser:

1. **Alignment.** Open the map, enable **LiDAR → Sweden · Terrängskuggning**,
   and go to Stockholm at **z13–z16**. The shading must line up with the
   basemap: trace the **Stockholm archipelago shoreline** and a lake edge
   (Mälaren works well). *An offset, a mirror or an upside-down image means the
   CRS or axis order is wrong — check that the request still says
   `VERSION=1.1.1` and `SRS=EPSG:3857`, not `CRS=`.*
2. **Network tab.** DevTools → Network → filter `se-hojdmodell`. Each tile must
   be **`200`**, `content-type: image/png`, with `SRS=EPSG%3A3857` and a
   `BBOX` of four large metre values. In production the host must be **your own
   origin**, never `lantmateriet.se`.
3. **Caching.** Pan away and back. Repeated tiles should show
   `X-Proxy-Cache: HIT` (Express) or come from the CDN/disk cache.
4. **Opacity slider.** Drag it 0 → 100 %. The shading fades smoothly, the
   `%` readout tracks it, and the basemap stays readable at 70 %.
5. **Toggle.** Switch the row off → all Sweden tiles disappear **and
   `© Lantmäteriet` leaves the attribution control**. Switch on → both return.
6. **Dropdown.** Pick *Terränglutning · slope, greyscale*, then
   *…brown/purple*, then *Ursprung och kvalitet*. Each redraws in place (no
   flash of the whole panel) and the new `LAYERS=` value appears in the
   Network tab.
7. **Out of coverage.** Pan to Oslo or Helsinki. **No requests are issued at
   all** (the bounds stop them). Pan to Copenhagen — a few requests go out and
   come back empty; that is expected and documented.
8. **Zoom guards.** Zoom out to **z7**: the layer disappears and no requests are
   made. Zoom in past **z17**: tiles are upscaled, no new requests.
9. **Error hygiene.** With the backend credentials deliberately blank, enable
   the row: you get **one** notice — *"Missing or invalid Lantmäteriet
   (Geotorget) credentials"* — **no broken-image icons**, and **one** console
   warning rather than one per tile.
10. **No secrets.** DevTools → Sources, search the whole page for your
    Geotorget username. Zero hits.

---

## 8. Known limitations

- **It costs money.** There is no free live-tile route to this layer. See §1.
- **WMS, not WMTS.** Every tile is rendered on demand, so first paint over a
  cold area is slower than the Danish or Swiss WMTS layers. The caching proxy
  is not optional at scale.
- **The licensed endpoint was never exercised** from here (401 by design). The
  request shape is identical to the one proven against the Min karta instance,
  and the proxy was verified end-to-end against a stub upstream, but the first
  real credentialled request is yours to make.
- **Alignment is pinned numerically, not visually** — see §2 and checklist
  item 1.
- **Copenhagen's corner** falls inside the rectangular bounds. Harmless.
- `ursprung_kvalitet` is metadata (acquisition source and quality), not
  terrain imagery. It is in the dropdown because the service publishes it and
  it is genuinely useful for judging whether a feature is real, but it will not
  look like a hillshade.
- **No `GetFeatureInfo`.** The service advertises `application/json` for it, so
  a click-to-read-elevation feature like Norway's is possible, but it is not
  built here and would need the proxy's request allowlist widened.

---

## 9. Files changed

| File | Change |
|---|---|
| `js/lantmateriet-hojdmodell-layer.js` | **new** — the layer module |
| `backend/src/routes/geoProxy.js` | **+** route `/api/geo/se-hojdmodell` |
| `netlify/functions/se-hojdmodell.mjs` | **new** — Netlify twin of the proxy |
| `netlify.toml` | **+** redirect for the proxy path |
| `backend/.env.example` | **+** `LANTMATERIET_WMS_*` placeholders (empty) |
| `index.html` | **+** Sweden row, **+** script tag, cache-busted `map-app.js` |
| `js/map-app.js` | **+** `seLidar` sub-layer, factory, mode select, bounds, slider wiring |
| `sw.js` | cache `detectlab-v162-se-hojdmodell`, precache the new module |
| `test-sweden-lantmateriet-hojdmodell.js` | **new** — 133 checks |
| `tools/sweden-lidar-demo.html` | **new** — standalone alignment check (not part of the app) |
| `SWEDEN_LIDAR_LANTMATERIET.md` | **new** — this document |
