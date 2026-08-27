import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from '../src/config/db.js';
import { logger } from '../src/logger.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Apply every `.sql` migration file in order. Every migration is written
 * idempotently (IF NOT EXISTS / ON CONFLICT / ALTER ... IF NOT EXISTS), so
 * running the full set is safe to repeat.
 *
 * Exported so the app can guarantee the evidence schema exists at startup
 * (see src/app.js `ensureDatabaseSchema`), which fixes a bare HTTP 500 on
 * every `/api/evidence/search` request when a fresh deploy starts without
 * a separate `npm run migrate` step.
 */
export async function runMigrations(db) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ file }, 'Applying migration');
    await db.query(sql);
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
