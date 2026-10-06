/*
 * geoProxy.js — token-adding, caching proxy for Dataforsyningen (Denmark).
 * ───────────────────────────────────────────────────────────────────────────
 * The Danish Agency's WMS/WMTS require a token on every request. A token in
 * client-side JavaScript is visible to every visitor, so the browser instead
 * asks THIS server for tiles and the token is added here, server-side, as the
 * "token" HTTP header (the method Dataforsyningen's own documentation
 * recommends over the query parameter).
 *
 *   browser  →  GET /api/geo/dk-dhm?service=WMS&request=GetMap&…   (no token)
 *   server   →  GET https://api.dataforsyningen.dk/dhm_DAF?…       (token: …)
 *
 * Configuration (never committed):
 *   DATAFORSYNINGEN_TOKEN=<your 32-character token>    # backend/.env
 *
 * The token is never logged and never echoed back in a response or an error.
 *
 * Safety: this is NOT an open proxy. Only GetMap/GetCapabilities on a fixed
 * host, a fixed service and a whitelist of layers and formats are forwarded,
 * and the image size is capped.
 *
 * Caching: successful tiles are kept in a small in-process LRU for 7 days and
 * are returned with "Cache-Control: public, max-age=604800, immutable" so any
 * CDN or browser in front of this server caches them too. For serious traffic
 * put a real CDN (or the Nginx / Cloudflare Worker variants described in
 * DENMARK_LIDAR_DATAFORSYNINGEN.md) in front of this route.
 */
import express from 'express';
import { logger } from '../logger.js';

const router = express.Router();

/* ── configuration ──────────────────────────────────────────────────────── */

const UPSTREAM = 'https://api.dataforsyningen.dk/dhm_DAF';

// Only these layers may be requested through the proxy.
const ALLOWED_LAYERS = new Set([
  'dhm_terraen_skyggekort',
  'dhm_overflade_skyggekort',
  'dhm_kurve_traditionel',
  'dhm_kurve_0_5_m',
  'dhm_kurve_0_25_m',
]);

const ALLOWED_FORMATS = new Set(['image/png', 'image/jpeg']);
const ALLOWED_REQUESTS = new Set(['getmap', 'getcapabilities']);
const MAX_PIXELS = 1024; // width/height cap — tiles are 256

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_MAX_ENTRIES = 2000;               // ≈ a few hundred MB at most
const cache = new Map();                      // key → { body, type, expires }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Refresh recency (Map keeps insertion order ⇒ cheap LRU).
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, value);
}

/* ── the route ──────────────────────────────────────────────────────────── */

router.get('/geo/dk-dhm', async (req, res) => {
  const token = process.env.DATAFORSYNINGEN_TOKEN;
  if (!token) {
    // Deliberately explicit: the client turns this into the non-blocking
    // "Invalid or missing Dataforsyningen token" notice.
    return res.status(401).json({ error: 'dataforsyningen_token_missing' });
  }

  const params = req.query || {};
  const request = String(params.request || params.REQUEST || '').toLowerCase();
  if (!ALLOWED_REQUESTS.has(request)) {
    return res.status(400).json({ error: 'unsupported_request' });
  }

  if (request === 'getmap') {
    const layers = String(params.layers || params.LAYERS || '');
    if (!layers.split(',').every((l) => ALLOWED_LAYERS.has(l.trim()))) {
      return res.status(400).json({ error: 'layer_not_allowed' });
    }
    const format = String(params.format || params.FORMAT || '');
    if (!ALLOWED_FORMATS.has(format)) {
      return res.status(400).json({ error: 'format_not_allowed' });
    }
    const width = Number(params.width || params.WIDTH || 0);
    const height = Number(params.height || params.HEIGHT || 0);
    if (!(width > 0 && height > 0 && width <= MAX_PIXELS && height <= MAX_PIXELS)) {
      return res.status(400).json({ error: 'bad_image_size' });
    }
  }

  // Rebuild the upstream query from the client's parameters. A token supplied
  // by the client is ignored on purpose — ours is the only one used.
  const upstream = new URL(UPSTREAM);
  for (const [key, value] of Object.entries(params)) {
    if (key.toLowerCase() === 'token') continue;
    upstream.searchParams.set(key, Array.isArray(value) ? value[0] : String(value));
  }

  const cacheKey = upstream.search;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.set('Content-Type', cached.type);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.set('X-Proxy-Cache', 'HIT');
    return res.send(cached.body);
  }

  try {
    const upstreamRes = await fetch(upstream.toString(), {
      // Header form keeps the token out of upstream access logs as well.
      headers: { token },
    });
    const type = upstreamRes.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await upstreamRes.arrayBuffer());

    if (!upstreamRes.ok || type.includes('xml')) {
      // The service answers 200 + an OGC ServiceException for an invalid
      // token, so sniff the body as well as the status.
      const body = buffer.toString('utf8', 0, 2000);
      const unauthorized = upstreamRes.status === 401 || upstreamRes.status === 403 ||
        /not authorized|unauthorized|token/i.test(body);
      logger.warn(
        { status: upstreamRes.status, type, unauthorized },
        'Dataforsyningen upstream refused a request',
      );
      return res
        .status(unauthorized ? 401 : 502)
        .json({ error: unauthorized ? 'dataforsyningen_token_invalid' : 'upstream_error' });
    }

    cacheSet(cacheKey, { body: buffer, type, expires: Date.now() + CACHE_TTL_MS });
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.set('X-Proxy-Cache', 'MISS');
    return res.send(buffer);
  } catch (err) {
    logger.error({ err: err?.message }, 'Dataforsyningen proxy request failed');
    return res.status(502).json({ error: 'upstream_unreachable' });
  }
});

export default router;
