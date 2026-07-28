import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';
import { logger } from '../src/logger.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

async function run() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ file }, 'Applying migration');
    await pool.query(sql);
  }

  logger.info('All migrations applied');
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
