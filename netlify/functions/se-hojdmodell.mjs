/*
 * netlify/functions/se-hojdmodell.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Sweden · Lantmäteriet "Markhöjdmodell Visning" — credential-adding,
 * CDN-cached tile proxy for the Netlify deployment.
 *
 * Why this exists
 *   The terrängskuggning WMS is a LICENSED, fee-based product. Its access
 *   point https://maps.lantmateriet.se/hojdmodell/wms/v1.1 answers
 *   "401 Authorization Required" without credentials, and those credentials
 *   must never be shipped to a browser. The map therefore asks this
 *   same-origin function for tiles and the Authorization header is attached
 *   here, server-side.
 *
 *   browser →  GET /api/geo/se-hojdmodell?SERVICE=WMS&REQUEST=GetMap&…
 *   Netlify →  GET https://maps.lantmateriet.se/hojdmodell/wms/v1.1?…
 *              Authorization: Basic <base64(user:password)>
 *
 * This is the Netlify twin of backend/src/routes/geoProxy.js. Deployments
 * that serve the site from the Express backend use that one instead; the two
 * expose exactly the same path and the same allowlists, so the browser code
 * does not care which is in front of it.
 *
 * Environment variables (Netlify → Site settings → Environment variables):
 *   LANTMATERIET_WMS_USER      Geotorget consumer account
 *   LANTMATERIET_WMS_PASSWORD
 *     …or, for an OAuth2 agreement:
 *   LANTMATERIET_WMS_TOKEN     sent as "Authorization: Bearer …"
 *     …optional:
 *   LANTMATERIET_WMS_URL       override the upstream access point
 *
 * Caching: a WMS GetMap is rendered on demand and is far more expensive for
 * the server than a pre-cached WMTS tile. Successful tiles are pinned on the
 * Netlify CDN for 7 days, so a popular area is fetched from Lantmäteriet once
 * rather than once per visitor. See SWEDEN_LIDAR_LANTMATERIET.md for the
 * Nginx and Cloudflare Worker equivalents.
 */

const UPSTREAM_DEFAULT = 'https://maps.lantmateriet.se/hojdmodell/wms/v1.1';

// Layer names exactly as published by the service's GetCapabilities.
const ALLOWED_LAYERS = new Set([
  'terrangskuggning',
  'terranglutning',
  'terranglutning_brunton',
  'ursprung_kvalitet'
]);

const ALLOWED_FORMATS = new Set(['image/png', 'image/jpeg', 'image/png; mode=8bit']);
const ALLOWED_REQUESTS = new Set(['getmap', 'getcapabilities']);
const MAX_PIXELS = 1024; // the service allows 4096; tiles are 256

// Credentials must never be reflected back to the client.
const STRIPPED_PARAMS = new Set(['token', 'user', 'pass', 'password', 'authorization']);

/** Case-insensitive read of a WMS parameter. */
function param(searchParams, name) {
  for (const [key, value] of searchParams) {
    if (key.toLowerCase() === name) return value;
  }
  return '';
}

/** Build the Authorization header from whichever credential style is set. */
function authHeader(env) {
  if (env.LANTMATERIET_WMS_TOKEN) return `Bearer ${env.LANTMATERIET_WMS_TOKEN}`;
  const user = env.LANTMATERIET_WMS_USER;
  const password = env.LANTMATERIET_WMS_PASSWORD;
  if (user && password) {
    return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
  }
  return null;
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
  const env = process.env;
  const authorization = authHeader(env);
  if (!authorization) {
    // The client turns this into the non-blocking
    // "Missing or invalid Lantmäteriet (Geotorget) credentials" notice.
    return problem(401, 'lantmateriet_credentials_missing');
  }

  const incoming = new URL(request.url).searchParams;

  const wmsRequest = param(incoming, 'request').toLowerCase();
  if (!ALLOWED_REQUESTS.has(wmsRequest)) return problem(400, 'unsupported_request');

  if (wmsRequest === 'getmap') {
    const layers = param(incoming, 'layers');
    if (!layers || !layers.split(',').every((l) => ALLOWED_LAYERS.has(l.trim()))) {
      return problem(400, 'layer_not_allowed');
    }
    if (!ALLOWED_FORMATS.has(param(incoming, 'format'))) {
      return problem(400, 'format_not_allowed');
    }
    const width = Number(param(incoming, 'width'));
    const height = Number(param(incoming, 'height'));
    if (!(width > 0 && height > 0 && width <= MAX_PIXELS && height <= MAX_PIXELS)) {
      return problem(400, 'bad_image_size');
    }
  }

  const upstream = new URL(env.LANTMATERIET_WMS_URL || UPSTREAM_DEFAULT);
  for (const [key, value] of incoming) {
    if (STRIPPED_PARAMS.has(key.toLowerCase())) continue;
    upstream.searchParams.set(key, value);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream.toString(), { headers: { authorization } });
  } catch {
    return problem(502, 'upstream_unreachable');
  }

  const type = upstreamRes.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await upstreamRes.arrayBuffer());

  // MapServer answers 200 + an OGC ServiceException for a bad request, and
  // nginx answers 401 + HTML for bad credentials, so sniff the body too.
  if (!upstreamRes.ok || type.includes('xml') || type.includes('html')) {
    const head = buffer.toString('utf8', 0, 2000);
    const unauthorized = upstreamRes.status === 401 || upstreamRes.status === 403 ||
      /authorization required|not authori[sz]ed|unauthorized/i.test(head);
    return problem(unauthorized ? 401 : 502,
      unauthorized ? 'lantmateriet_credentials_invalid' : 'upstream_error');
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': type,
      // Browser cache + Netlify CDN cache. Hillshade of a national height
      // model changes a few times a year at most.
      'Cache-Control': 'public, max-age=604800, immutable',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400'
    }
  });
};

export const config = {
  path: '/api/geo/se-hojdmodell'
};
