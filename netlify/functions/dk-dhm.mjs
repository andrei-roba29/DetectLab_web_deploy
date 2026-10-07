/*
 * netlify/functions/dk-dhm.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Denmark · Dataforsyningen "DHM skyggekort" WMTS — token-adding, CDN-cached
 * tile proxy for the Netlify deployment.
 *
 * Why this exists
 *   api.dataforsyningen.dk answers every imagery request with the OGC
 *   exception "User not authorized" unless a token is attached, and that
 *   token must never be shipped to a browser (it is account-wide: there is
 *   no documented way to restrict one to a domain or an IP). The map
 *   therefore asks this same-origin function for tiles and the token is
 *   added here, server-side, as the "token" HTTP header — the form
 *   Dataforsyningen's own documentation calls the most secure, because it
 *   keeps the secret out of access logs, Referer headers and history.
 *
 *   browser →  GET /api/geo/dk-dhm?service=WMTS&request=GetTile&…   (no token)
 *   Netlify →  GET https://api.dataforsyningen.dk/dhm_terraen_skyggekort_DAF?…
 *              token: <DATAFORSYNINGEN_TOKEN>
 *
 * This is the Netlify twin of the /geo/dk-dhm route in
 * backend/src/routes/geoProxy.js. Deployments that serve the site from the
 * Express backend use that one instead; the two expose exactly the same path
 * and the same allowlists, so the browser code does not care which is in
 * front of it.
 *
 * Environment variable (Netlify → Site settings → Environment variables):
 *   DATAFORSYNINGEN_TOKEN   your 32-character token from dataforsyningen.dk
 *                           → "Administrer token til webservices og API'er"
 *
 * Caching: WMTS tiles are pre-rendered and immutable in practice (Danmarks
 * Højdemodel is re-flown over several years), so successful tiles are pinned
 * on the Netlify CDN for 7 days. A popular area is then fetched from the
 * agency once rather than once per visitor — which is the whole point of
 * preferring the WMTS over an on-demand WMS. See
 * DENMARK_LIDAR_DATAFORSYNINGEN.md for the Nginx, PHP and Cloudflare Worker
 * equivalents.
 */

// WMTS layer → the api.dataforsyningen.dk service that publishes it. This
// table is the ONLY way an upstream URL can be chosen, which is what stops
// the function from becoming an open proxy.
const LAYER_UPSTREAM = new Map([
  ['dhm_terraen_skyggekort', 'https://api.dataforsyningen.dk/dhm_terraen_skyggekort_DAF'],
  ['dhm_overflade_skyggekort', 'https://api.dataforsyningen.dk/dhm_overflade_skyggekort_DAF']
]);

const DEFAULT_UPSTREAM = LAYER_UPSTREAM.get('dhm_terraen_skyggekort');

// image/jpeg is the only format the DHM skyggekort WMTS publishes.
const ALLOWED_FORMATS = new Set(['image/jpeg']);
const ALLOWED_REQUESTS = new Set(['gettile', 'getcapabilities']);
const ALLOWED_TILEMATRIXSETS = new Set(['view1']);

// View1 has levels 0…13; its largest matrix is 17188 × 11719 tiles.
const MAX_TILEMATRIX = 13;
const MAX_TILE_INDEX = 17187;

// A token must never be reflected back to the client or forwarded verbatim.
const STRIPPED_PARAMS = new Set(['token', 'apikey', 'username', 'password']);

/** Case-insensitive read of an OGC KVP parameter. */
function param(searchParams, name) {
  for (const [key, value] of searchParams) {
    if (key.toLowerCase() === name) return value;
  }
  return '';
}

function problem(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export default async (request) => {
  const token = process.env.DATAFORSYNINGEN_TOKEN;
  if (!token) {
    // The client turns this into the non-blocking
    // "Invalid or missing Dataforsyningen token" notice.
    return problem(401, 'dataforsyningen_token_missing');
  }

  const incoming = new URL(request.url).searchParams;

  const wmtsRequest = param(incoming, 'request').toLowerCase();
  if (!ALLOWED_REQUESTS.has(wmtsRequest)) return problem(400, 'unsupported_request');

  let target = DEFAULT_UPSTREAM;

  if (wmtsRequest === 'gettile') {
    const layer = param(incoming, 'layer');
    if (!LAYER_UPSTREAM.has(layer)) return problem(400, 'layer_not_allowed');
    target = LAYER_UPSTREAM.get(layer);

    if (!ALLOWED_FORMATS.has(param(incoming, 'format'))) {
      return problem(400, 'format_not_allowed');
    }
    if (!ALLOWED_TILEMATRIXSETS.has(param(incoming, 'tilematrixset').toLowerCase())) {
      return problem(400, 'tilematrixset_not_allowed');
    }

    // "7" is what this server wants; tolerate the "View1:7" spelling used by
    // the Layer's TileMatrixSetLimits so either client works.
    const matrix = Number(param(incoming, 'tilematrix').replace(/^View1:/i, ''));
    const col = Number(param(incoming, 'tilecol'));
    const row = Number(param(incoming, 'tilerow'));
    const whole = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
    if (!whole(matrix, MAX_TILEMATRIX) ||
        !whole(col, MAX_TILE_INDEX) ||
        !whole(row, MAX_TILE_INDEX)) {
      return problem(400, 'bad_tile_index');
    }
  } else {
    const layer = param(incoming, 'layer');
    if (layer && LAYER_UPSTREAM.has(layer)) target = LAYER_UPSTREAM.get(layer);
  }

  const upstream = new URL(target);
  for (const [key, value] of incoming) {
    if (STRIPPED_PARAMS.has(key.toLowerCase())) continue;
    upstream.searchParams.set(key, value);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream.toString(), { headers: { token } });
  } catch {
    return problem(502, 'upstream_unreachable');
  }

  const type = upstreamRes.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await upstreamRes.arrayBuffer());

  // Verified live: a tokenless GetTile answers with an OGC ExceptionReport
  // body ("User not authorized") rather than a bare 401, so sniff the body
  // as well as the status code.
  if (!upstreamRes.ok || type.includes('xml') || type.includes('html')) {
    const head = buffer.toString('utf8', 0, 2000);
    const unauthorized = upstreamRes.status === 401 || upstreamRes.status === 403 ||
      /not authori[sz]ed|unauthorized|invalid token/i.test(head);
    return problem(unauthorized ? 401 : 502,
      unauthorized ? 'dataforsyningen_token_invalid' : 'upstream_error');
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': type,
      // Browser cache + Netlify CDN cache.
      'Cache-Control': 'public, max-age=604800, immutable',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400'
    }
  });
};

export const config = {
  path: '/api/geo/dk-dhm'
};
