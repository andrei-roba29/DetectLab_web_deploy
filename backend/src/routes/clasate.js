import { Router } from 'express';
import { pool } from '../config/db.js';
import { logger } from '../logger.js';

const router = Router();

// ── In-memory cache (same pattern as sites.js / layers.js) ──────────
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let geojsonCache = null;    // Full FeatureCollection
let statsCache = null;      // Aggregated stats
const GEOJSON_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (data changes rarely)
let geojsonCachedAt = 0;
let statsCachedAt = 0;

/**
 * GET /api/clasate/stats
 *
 * Returns aggregate statistics about the clasate artifacts collection:
 *   - total count, with/without coordinates
 *   - counts by period, culture, classification
 *   - county distribution
 */
router.get('/clasate/stats', async (req, res) => {
  if (statsCache && Date.now() - statsCachedAt < CACHE_TTL_MS) {
    return res.json(statsCache);
  }

  try {
    const [
      { rows: [totals] },
      { rows: byPeriod },
      { rows: byCulture },
      { rows: byClassification },
      { rows: byCounty },
    ] = await Promise.all([
      pool.query(`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE geom IS NOT NULL) AS with_coords,
          count(*) FILTER (WHERE geom IS NULL) AS without_coords
        FROM clasate_artifacts
      `),
      pool.query(`
        SELECT period, count(*) AS count
        FROM clasate_artifacts
        WHERE period IS NOT NULL AND period != ''
        GROUP BY period
        ORDER BY count(*) DESC
        LIMIT 30
      `),
      pool.query(`
        SELECT culture, count(*) AS count
        FROM clasate_artifacts
        WHERE culture IS NOT NULL AND culture != ''
        GROUP BY culture
        ORDER BY count(*) DESC
        LIMIT 30
      `),
      pool.query(`
        SELECT classification, count(*) AS count
        FROM clasate_artifacts
        GROUP BY classification
        ORDER BY count(*) DESC
      `),
      pool.query(`
        SELECT county_holder, count(*) AS count
        FROM clasate_artifacts
        WHERE county_holder IS NOT NULL AND county_holder != ''
        GROUP BY county_holder
        ORDER BY count(*) DESC
      `),
    ]);

    statsCache = {
      totals,
      byPeriod: byPeriod.map(r => ({ period: r.period, count: Number(r.count) })),
      byCulture: byCulture.map(r => ({ culture: r.culture, count: Number(r.count) })),
      byClassification: byClassification.map(r => ({ classification: r.classification, count: Number(r.count) })),
      byCounty: byCounty.map(r => ({ county: r.county_holder, count: Number(r.count) })),
    };
    statsCachedAt = Date.now();
    res.json(statsCache);
  } catch (err) {
    logger.error({ err }, 'Failed to load clasate stats');
    res.status(500).json({ error: 'Failed to load statistics' });
  }
});

/**
 * GET /api/clasate/geojson
 *
 * Returns ALL clasate artifacts with coordinates as a GeoJSON FeatureCollection.
 * Features are cached in memory for performance (21k+ features).
 *
 * Query params:
 *   ?period=Neolithic    — filter by period
 *   ?culture=Cucuteni    — filter by culture
 *   ?county=CLUJ         — filter by holder county
 *   ?classification=Fond — filter by classification (Fond/Tezaur)
 *   ?search=vas          — full-text search on name + description
 */
router.get('/clasate/geojson', async (req, res) => {
  const { period, culture, county, classification, search } = req.query;

  // If no filters, serve from cache
  const hasFilters = period || culture || county || classification || search;
  if (!hasFilters && geojsonCache && Date.now() - geojsonCachedAt < GEOJSON_CACHE_TTL) {
    return res.json(geojsonCache);
  }

  try {
    let query = `
      SELECT id, name, description, holder, dating, period, culture,
             finding_place, material, inventory_nr, classification,
             county_holder, specific_type, detail_url, image_url,
             geocode_confidence, ordinal,
             ST_X(geom) AS lng, ST_Y(geom) AS lat
      FROM clasate_artifacts
      WHERE geom IS NOT NULL
    `;
    const params = [];
    let paramIdx = 1;

    if (period) {
      query += ` AND LOWER(period) = LOWER($${paramIdx++})`;
      params.push(period);
    }
    if (culture) {
      query += ` AND LOWER(culture) = LOWER($${paramIdx++})`;
      params.push(culture);
    }
    if (county) {
      query += ` AND UPPER(county_holder) = UPPER($${paramIdx++})`;
      params.push(county);
    }
    if (classification) {
      query += ` AND LOWER(classification) = LOWER($${paramIdx++})`;
      params.push(classification);
    }
    if (search) {
      query += ` AND (LOWER(name) LIKE LOWER($${paramIdx}) OR LOWER(description) LIKE LOWER($${paramIdx++}))`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY ordinal ASC NULLS LAST';

    const { rows } = await pool.query(query, params);

    const featureCollection = {
      type: 'FeatureCollection',
      metadata: {
        total: rows.length,
        filters: { period, culture, county, classification, search },
        generated_at: new Date().toISOString(),
      },
      features: rows.map(row => ({
        type: 'Feature',
        id: row.id,
        geometry: {
          type: 'Point',
          coordinates: [row.lng, row.lat],
        },
        properties: {
          id: row.id,
          name: row.name,
          description: row.description ? row.description.substring(0, 500) : null,
          holder: row.holder,
          dating: row.dating,
          period: row.period,
          culture: row.culture,
          finding_place: row.finding_place,
          material: row.material,
          inventory_nr: row.inventory_nr,
          classification: row.classification,
          county: row.county_holder,
          specific_type: row.specific_type,
          detail_url: row.detail_url,
          image_url: row.image_url,
          geocode_confidence: row.geocode_confidence,
        },
      })),
    };

    if (!hasFilters) {
      geojsonCache = featureCollection;
      geojsonCachedAt = Date.now();
    }

    res.json(featureCollection);
  } catch (err) {
    logger.error({ err }, 'Failed to load clasate GeoJSON');
    res.status(500).json({ error: 'Failed to load clasate data' });
  }
});

/**
 * GET /api/clasate/:id
 *
 * Returns full details for a single artifact.
 */
router.get('/clasate/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *,
              ST_X(geom) AS lng, ST_Y(geom) AS lat
       FROM clasate_artifacts WHERE id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Artifact not found' });
    }

    const row = rows[0];
    res.json({
      ...row,
      geom: undefined, // Remove raw geometry
      coordinates: row.lat && row.lng ? { lat: row.lat, lng: row.lng } : null,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load clasate artifact');
    res.status(500).json({ error: 'Failed to load artifact' });
  }
});

/**
 * GET /api/clasate/periods/list
 * GET /api/clasate/cultures/list
 * GET /api/clasate/counties/list
 *
 * Returns distinct values for filter dropdowns.
 */
router.get('/clasate/periods/list', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT period, count(*) AS count
      FROM clasate_artifacts
      WHERE period IS NOT NULL AND period != '' AND geom IS NOT NULL
      GROUP BY period ORDER BY period
    `);
    res.json(rows.map(r => ({ value: r.period, count: Number(r.count) })));
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/clasate/cultures/list', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT culture, count(*) AS count
      FROM clasate_artifacts
      WHERE culture IS NOT NULL AND culture != '' AND geom IS NOT NULL
      GROUP BY culture ORDER BY culture
    `);
    res.json(rows.map(r => ({ value: r.culture, count: Number(r.count) })));
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/clasate/counties/list', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT county_holder, count(*) AS count
      FROM clasate_artifacts
      WHERE county_holder IS NOT NULL AND county_holder != '' AND geom IS NOT NULL
      GROUP BY county_holder ORDER BY county_holder
    `);
    res.json(rows.map(r => ({ value: r.county_holder, count: Number(r.count) })));
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

/** Called after import to clear stale cache. */
export function clearClasateCache() {
  geojsonCache = null;
  statsCache = null;
}

export default router;
