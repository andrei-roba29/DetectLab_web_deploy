import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from '../src/config/db.js';
import { logger } from '../src/logger.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Migrations that shipped BEFORE the versioned tracker existed (this feature).
 * On a pre-existing deployment these are assumed already-applied and are
 * baselined instead of re-run (several of them — e.g. 002 ADD PRIMARY KEY —
 * are not idempotent). Migrations added after this point (009 onwards) are
 * tracked and applied to both fresh and existing databases.
 */
const BASELINE_MIGRATIONS = new Set([
  '001_init.sql',
  '002_multi_layer.sql',
  '003_nullable_geom.sql',
  '004_stripe_payment_fields.sql',
  '005_one_time_premium.sql',
  '006_promo_codes.sql',
  '007_archaeological_knowledge.sql',
  '008_archaeological_locality_mentions.sql',
]);

/**
 * Apply pending `.sql` migration files in order.
 *
 * Migrations are tracked in `public.schema_migrations` (name, applied_at), so
 * each file runs exactly once. When the tracker is first introduced against an
 * already-migrated database (evidence schema present), the legacy baseline
 * migrations are marked applied without re-running them — only migrations
 * added from now on (009+) are executed. On a fresh database the whole set
 * runs from scratch.
 */
export async function runMigrations(db) {
  const trackerExisted = Boolean(
    (await db.query(`SELECT to_regclass('public.schema_migrations') AS t`)).rows[0]?.t
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS public.schema_migrations(
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const { rows } = await db.query(`SELECT name FROM public.schema_migrations`);
  const applied = new Set(rows.map((r) => r.name));

  // First encounter of the tracker against an already-migrated database (or a
  // tracker that somehow holds zero rows while the evidence schema exists):
  // baseline the legacy migrations so we never re-run risky DDL. Newer
  // (non-baseline) files still apply below.
  if ((!trackerExisted || applied.size === 0)) {
    const evidenceExists = Boolean(
      (await db.query(`SELECT to_regclass('knowledge.localities') AS s`)).rows[0]?.s
    );
    if (evidenceExists) {
      for (const name of BASELINE_MIGRATIONS) {
        if (applied.has(name)) continue;
        await db.query(
          `INSERT INTO public.schema_migrations(name) VALUES($1) ON CONFLICT DO NOTHING`,
          [name]
        );
        applied.add(name);
      }
    }
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ file }, 'Applying migration');
    await db.query(sql);
    await db.query(
      `INSERT INTO public.schema_migrations(name) VALUES($1) ON CONFLICT DO NOTHING`,
      [file]
    );
  }
}

// Keep the standalone CLI working: `npm run migrate`.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runMigrations(pool)
    .then(async () => {
      logger.info('All migrations applied');
      await pool.end();
    })
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}
