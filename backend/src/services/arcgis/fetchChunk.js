import { fetchWithRetry } from './client.js';

/**
 * Phase 2 of the sync: fetch full attributes + geometry for one batch of
 * OBJECTIDs. Batches are independent, so a failure here only affects
 * this one chunk, not the whole sync.
 *
 * Two things this server needs that a "textbook" ArcGIS call wouldn't:
 *  1. f=json, not f=geojson — this server only speaks Esri JSON (see
 *     esriToGeoJson.js for the conversion we do ourselves).
 *  2. POST instead of GET — with 1000 IDs per batch, the URL would be
 *     tens of thousands of characters long and IIS (the government
 *     server's web server) rejects overly long URLs with a plain 404.
 *     Sending the IDs in the POST body avoids any URL length limit.
 */
export async function fetchChunk(layerUrl, objectIds) {
  const url = `${layerUrl}/query`;

  const body = new URLSearchParams({
    objectIds: objectIds.join(','),
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326', // reproject to WGS84 lon/lat — source data is in Stereo70 (meters)
    f: 'json',
  });

  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!Array.isArray(data.features)) {
    throw new Error('Unexpected response shape from objectIds query');
  }

  // geometryType (e.g. "esriGeometryPoint") tells us how to interpret
  // each feature's geometry — same for every feature in this layer.
  return { geometryType: data.geometryType, features: data.features };
}
