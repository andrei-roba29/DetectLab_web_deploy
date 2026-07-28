import { fetchWithRetry } from './client.js';

/**
 * Phase 1 of the sync: get the complete, fixed list of OBJECTIDs for the
 * layer. This is a cheap call and gives us a manifest to work against,
 * immune to any reordering that could happen with plain pagination.
 */
export async function fetchAllObjectIds(layerUrl) {
  const url = `${layerUrl}/query?where=1=1&returnIdsOnly=true&f=json`;
  const data = await fetchWithRetry(url);

  if (!Array.isArray(data.objectIds)) {
    throw new Error('Unexpected response shape from returnIdsOnly query');
  }

  // Most layers use "OBJECTID" as their unique ID field, but not all —
  // ArcGIS tells us the real field name here, so we ask instead of assuming.
  return { objectIds: data.objectIds, objectIdFieldName: data.objectIdFieldName || 'OBJECTID' };
}
