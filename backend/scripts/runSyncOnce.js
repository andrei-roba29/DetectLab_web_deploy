import { runSync } from '../src/jobs/syncArcgis.js';
import { pool } from '../src/config/db.js';
import { logger } from '../src/logger.js';

runSync()
  .then((result) => {
    logger.info({ result }, 'Manual sync run complete');
  })
  .catch((err) => {
    logger.error({ err }, 'Manual sync run crashed unexpectedly');
  })
  .finally(() => pool.end());
