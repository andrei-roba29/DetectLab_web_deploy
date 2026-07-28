import cron from 'node-cron';
import { env } from '../config/env.js';
import { runSync } from './syncArcgis.js';
import { logger } from '../logger.js';

/**
 * Registers the nightly sync as a cron job. Call this once when the
 * server starts. The schedule (default: midnight every day) is
 * configurable via SYNC_CRON in .env.
 */
export function startScheduler() {
  logger.info({ cron: env.sync.cron }, 'Scheduling nightly ArcGIS sync');

  cron.schedule(env.sync.cron, async () => {
    logger.info('Cron triggered — starting scheduled sync');
    const result = await runSync();
    logger.info({ result }, 'Scheduled sync finished');
  });

  if (env.sync.onBoot) {
    logger.info('SYNC_ON_BOOT=true — running a sync immediately on startup');
    runSync().then((result) => logger.info({ result }, 'Startup sync finished'));
  }
}
