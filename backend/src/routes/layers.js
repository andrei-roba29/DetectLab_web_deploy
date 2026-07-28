import { Router } from 'express';
import { pool } from '../config/db.js';
import { logger } from '../logger.js';

const router = Router();

// Data only changes once a day (the nightly sync), but without caching,
// every single page load/refresh re-reads the ENTIRE table from Postgres.
// That's the actual cause of runaway database egress on hosted providers
// like Supabase, which bill per GB transferred. Caching each layer's
// response for an hour means Postgres gets hit at most once/hour/layer,
// regardless of how many people load the map.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const geojsonCache = new Map(); // layerId -> { data, cachedAt }

/** Lists every layer currently in the live snapshot, with feature counts. */
router.get('/layers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT layer_id, layer_name, count(*) AS feature_count
       FROM archaeological_sites
       GROUP BY layer_id, layer_name
       ORDER BY layer_id`
    );
    res.json({ layers: rows });
  } catch (err) {
    logger.error({ err }, 'Failed to load layer list');
    res.status(500).json({ error: 'Failed to load layers' });
  }
});

/** Serves one layer's features as a GeoJSON FeatureCollection, cached. */
router.get('/layers/:layerId/geojson', async (req, res) => {
  const layerId = Number(req.params.layerId);
  if (!Number.isInteger(layerId)) {
    return res.status(400).json({ error: 'Invalid layer id' });
  }

  const cached = geojsonCache.get(layerId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const { rows } = await pool.query(
      `SELECT object_id, attributes, ST_AsGeoJSON(geom)::json AS geometry
       FROM archaeological_sites WHERE layer_id = $1`,
      [layerId]
    );

    const featureCollection = {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        id: row.object_id,
        properties: row.attributes,
        geometry: row.geometry,
      })),
    };

    geojsonCache.set(layerId, { data: featureCollection, cachedAt: Date.now() });
    res.json(featureCollection);
  } catch (err) {
    logger.error({ err, layerId }, 'Failed to load layer geojson');
    res.status(500).json({ error: 'Failed to load layer' });
  }
});

/** Called after a successful sync so the cache doesn't serve stale data for up to an hour. */
export function clearGeojsonCache() {
  geojsonCache.clear();
}

export default router;
