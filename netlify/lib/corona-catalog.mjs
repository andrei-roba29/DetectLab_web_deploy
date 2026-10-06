/*
 * netlify/lib/corona-catalog.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * The Corona Atlas catalogue, slimmed and clipped to a bbox.
 *
 * The original atlas (https://corona.cast.uark.edu/atlas) starts by calling
 *
 *     GET https://corona.cast.uark.edu/corona/get_raster_names
 *
 * and feeds the answer to its raster manager: one GeoServer product per pass
 * ("1104-2155Fore") plus one per individual frame ("1104-2155df004"), each
 * with its WGS84 footprint. That endpoint sends no CORS header and the full
 * payload is ~6 MB of worldwide coverage, so DetectLab cannot call it from
 * the browser.
 *
 * This module does the two things needed to make it usable:
 *   • fetchCoronaCatalog()  — downloads the live catalogue (server side);
 *   • slimCatalog()         — keeps only the products intersecting a bbox and
 *                             drops every field the map does not need, with
 *                             coordinates rounded to 5 decimals (~1 m).
 *
 * Used by:
 *   netlify/functions/corona-rasters.mjs   (runtime proxy, same origin)
 *   tools/build-corona-europe-catalog.mjs  (static snapshot generator)
 */

export const CAST_CATALOG_URL = 'https://corona.cast.uark.edu/corona/get_raster_names';

/** Whole of Europe: [minLon, minLat, maxLon, maxLat]. */
export const EUROPE_BBOX = [-25, 34, 60, 72];

export function parseBbox(value, fallback = EUROPE_BBOX) {
  if (!value) return fallback;
  const parts = String(value).split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return [
    Math.min(parts[0], parts[2]),
    Math.min(parts[1], parts[3]),
    Math.max(parts[0], parts[2]),
    Math.max(parts[1], parts[3])
  ];
}

export function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function round(value, decimals = 5) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function extentToArray(extent) {
  if (!extent) return null;
  if (Array.isArray(extent)) return extent.length === 4 ? extent.map(Number) : null;
  const { minx, miny, maxx, maxy } = extent;
  if ([minx, miny, maxx, maxy].some((n) => n === undefined || n === null)) return null;
  return [Number(minx), Number(miny), Number(maxx), Number(maxy)];
}

/** CAST ships `polygon` as a GeoJSON *string*; return a flat list of rings. */
export function toRings(polygon) {
  if (!polygon) return null;
  let parsed = polygon;
  if (typeof polygon === 'string') {
    try {
      parsed = JSON.parse(polygon);
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed)) return parsed.length ? parsed : null;
  if (!parsed || !parsed.coordinates) return null;
  if (parsed.type === 'Polygon') return parsed.coordinates;
  if (parsed.type === 'MultiPolygon') return parsed.coordinates.flat();
  return null;
}

function roundRings(rings) {
  return rings.map((ring) => ring.map(([lon, lat]) => [round(lon), round(lat)]));
}

function bboxOfRings(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function slimProduct(entry, fallbackId) {
  const location = entry.location || entry.name || fallbackId;
  if (!location) return null;
  const rings = toRings(entry.rings || entry.polygon);
  const extent = extentToArray(entry.extent) || (rings ? bboxOfRings(rings) : null);
  if (!extent) return null;
  const product = {
    label: entry.label || location,
    location: String(location).replace(/^corona:/, ''),
    extent: extent.map((n) => round(n))
  };
  if (rings) product.rings = roundRings(rings);
  if (entry.ftp) product.ftp = entry.ftp;
  return product;
}

/**
 * @param {Object} catalog  raw CAST payload (object keyed by pass)
 * @param {number[]} bbox   [minLon, minLat, maxLon, maxLat]
 * @returns {{blocks: Array, passes: number, frames: number}}
 */
export function slimCatalog(catalog, bbox = EUROPE_BBOX) {
  const blocks = [];
  let frames = 0;

  for (const [key, entry] of Object.entries(catalog || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const block = slimProduct(entry, key);
    if (!block) continue;
    if (!bboxIntersects(block.extent, bbox)) continue;

    block.id = key;
    block.images = [];
    for (const image of entry.images || []) {
      const slim = slimProduct(image, image?.location);
      if (!slim) continue;
      if (!bboxIntersects(slim.extent, bbox)) continue;
      block.images.push(slim);
      frames += 1;
    }
    blocks.push(block);
  }

  blocks.sort((a, b) => a.id.localeCompare(b.id));
  return { blocks, passes: blocks.length, frames };
}

export async function fetchCoronaCatalog({ url = CAST_CATALOG_URL, timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // The CAST app is a CodeIgniter site behind Cloudflare; a plain
        // scripted request without a UA occasionally gets a challenge.
        'User-Agent': 'DetectLab/1.0 (+https://detectlab.eu) corona-catalog'
      }
    });
    if (!response.ok) throw new Error(`CAST catalogue returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function buildCatalogPayload(catalog, bbox = EUROPE_BBOX) {
  const { blocks, passes, frames } = slimCatalog(catalog, bbox);
  return {
    source: CAST_CATALOG_URL,
    generated: new Date().toISOString(),
    bbox,
    passes,
    frames,
    blocks
  };
}
