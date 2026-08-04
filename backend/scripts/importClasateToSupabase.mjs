#!/usr/bin/env node
/**
 * Import CIMEC Clasate Artifacts into Supabase/PostGIS
 * ====================================================
 *
 * Takes the scraped JSON file and bulk-imports it into the
 * clasate_artifacts table using PostgreSQL COPY protocol.
 *
 * USAGE:
 *   node scripts/importClasateToSupabase.mjs [path-to-json]
 *
 * Requires DATABASE_URL in .env
 */

import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const INPUT_PATH = process.argv[2] || resolve(__dirname, '..', 'data/clasate_artifacts.json');
const BATCH_SIZE = 500;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not set in .env');
    process.exit(1);
  }

  console.log(`📂 Loading artifacts from: ${INPUT_PATH}`);
  const artifacts = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
  console.log(`📊 Loaded ${artifacts.length} artifacts`);

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();

  try {
    // Ensure table exists (run migration first if needed)
    console.log('🔧 Checking table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS clasate_artifacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        holder TEXT,
        domain TEXT DEFAULT 'Arheologie',
        dating TEXT,
        period TEXT,
        culture TEXT,
        finding_place TEXT,
        material TEXT,
        inventory_nr TEXT,
        classification TEXT,
        county_holder TEXT,
        category_type TEXT,
        specific_type TEXT,
        ordinal INT,
        detail_url TEXT,
        image_url TEXT,
        geom geometry(Point, 4326),
        geocode_method TEXT,
        geocode_confidence TEXT,
        scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Create indexes if not exist
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clasate_geom ON clasate_artifacts USING GIST (geom);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clasate_period ON clasate_artifacts (period);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clasate_culture ON clasate_artifacts (culture);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clasate_county ON clasate_artifacts (county_holder);`);

    // Bulk upsert in batches
    console.log('📥 Importing artifacts...');

    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < artifacts.length; i += BATCH_SIZE) {
      const batch = artifacts.slice(i, i + BATCH_SIZE);

      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const art of batch) {
        const geomValue = (art.lat && art.lng)
          ? `SRID=4326;POINT(${art.lng} ${art.lat})`
          : null;

        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, ${geomValue ? `ST_GeomFromEWKT($${paramIdx++})` : 'NULL'}, $${paramIdx++}, $${paramIdx++})`);

        params.push(
          art.id || `unknown_${i}`,
          art.name || 'Unknown',
          art.description || null,
          art.holder || null,
          art.domain || 'Arheologie',
          art.dating || null,
          art.period || null,
          art.culture || null,
          art.finding_place || null,
          art.material || null,
          art.inventory_nr || null,
          art.classification || null,
          art.county_holder || null,
          art.category_type || null,
          art.specific_type || null,
          art.ordinal || null,
          art.detail_url || null,
          art.image_url || null,
        );
        if (geomValue) params.push(geomValue);
        params.push(
          art.geocode_method || null,
          art.geocode_confidence || null,
        );
      }

      const query = `
        INSERT INTO clasate_artifacts (
          id, name, description, holder, domain, dating, period, culture,
          finding_place, material, inventory_nr, classification,
          county_holder, category_type, specific_type, ordinal,
          detail_url, image_url, geom, geocode_method, geocode_confidence
        ) VALUES ${values.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          holder = EXCLUDED.holder,
          dating = EXCLUDED.dating,
          period = EXCLUDED.period,
          culture = EXCLUDED.culture,
          finding_place = EXCLUDED.finding_place,
          material = EXCLUDED.material,
          inventory_nr = EXCLUDED.inventory_nr,
          classification = EXCLUDED.classification,
          detail_url = EXCLUDED.detail_url,
          image_url = EXCLUDED.image_url,
          geom = EXCLUDED.geom,
          geocode_method = EXCLUDED.geocode_method,
          geocode_confidence = EXCLUDED.geocode_confidence,
          updated_at = now()
      `;

      try {
        const result = await client.query(query, params);
        imported += result.rowCount;
      } catch (err) {
        console.error(`  ❌ Batch at index ${i} failed:`, err.message);
        skipped += batch.length;
      }

      if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= artifacts.length) {
        console.log(`  📊 Progress: ${Math.min(i + BATCH_SIZE, artifacts.length)}/${artifacts.length} (${imported} imported, ${skipped} skipped)`);
      }
    }

    // Final stats
    const { rows: [{ count }] } = await client.query('SELECT count(*) FROM clasate_artifacts');
    const { rows: [{ count: withGeom }] } = await client.query('SELECT count(*) FROM clasate_artifacts WHERE geom IS NOT NULL');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  ✅ Import complete!`);
    console.log(`  Total rows: ${count}`);
    console.log(`  With coordinates: ${withGeom}`);
    console.log(`  Without coordinates: ${Number(count) - Number(withGeom)}`);
    console.log('═══════════════════════════════════════════════════════════');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
