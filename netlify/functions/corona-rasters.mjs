/*
 * netlify/functions/corona-rasters.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Same-origin proxy for the Corona Atlas catalogue.
 *
 * The map needs the list of CORONA products (pass mosaics + individual
 * frames) that cover the current area, exactly like the original atlas gets
 * it from `/corona/get_raster_names`. That CAST endpoint cannot be called
 * from the browser: it sends no `Access-Control-Allow-Origin` header, and it
 * answers with ~6 MB of worldwide coverage.
 *
 * This function fetches it server-side, clips it to a bbox (Europe by
 * default), strips everything the map does not use and caches the result:
 *   • in memory, for the lifetime of a warm Lambda container;
 *   • on the Netlify CDN, through Cache-Control / Netlify-CDN-Cache-Control
 *     (the archive is declassified 1960s imagery — it does not change).
 *
 * Route (see netlify.toml):  GET /api/corona/rasters?bbox=minLon,minLat,maxLon,maxLat
 */
import {
  EUROPE_BBOX,
  buildCatalogPayload,
  fetchCoronaCatalog,
  parseBbox
} from '../lib/corona-catalog.mjs';

const MEMORY_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
let cached = null; // { at: number, catalog: Object }

async function getCatalog() {
  const now = Date.now();
  if (cached && now - cached.at < MEMORY_TTL_MS) return cached.catalog;
  try {
    const catalog = await fetchCoronaCatalog();
    cached = { at: now, catalog };
    return catalog;
  } catch (err) {
    // Serve stale rather than nothing: the upstream is a university server.
    if (cached) return cached.catalog;
    throw err;
  }
}

export default async (request) => {
  const url = new URL(request.url);
  const bbox = parseBbox(url.searchParams.get('bbox'), EUROPE_BBOX);

  try {
    const catalog = await getCatalog();
    const payload = buildCatalogPayload(catalog, bbox);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  }
};

export const config = {
  path: '/api/corona/rasters'
};
