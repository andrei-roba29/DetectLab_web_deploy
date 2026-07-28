import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { SYNC_LAYERS } from '../config/layers.js';
import { fetchAllFeatures } from '../services/arcgis/fetchAllFeatures.js';
import { bulkInsertEsriFeatures } from '../services/postgis/bulkImport.js';
import { finalizeTable } from '../services/postgis/finalizeTable.js';
import { swapActiveTable } from '../services/postgis/swap.js';
import { getInactiveTable } from '../services/postgis/syncState.js';
import { clearGeojsonCache } from '../routes/layers.js';
import { clearSitesCache } from '../routes/sites.js';
import { logger } from '../logger.js';

// Arbitrary constant — just needs to be the same number every time so
// pg_advisory_lock knows which "lock" we mean. Prevents two syncs
// (e.g. the nightly cron job and a manual trigger) from running at once.
const SYNC_LOCK_KEY = 5927341;

/**
 * Runs one full sync cycle across every layer in SYNC_LAYERS. All layers
 * load into the same offline buffer table and get published together in
 * a single atomic swap — so the live snapshot is always internally
 * consistent (never showing sites from a new sync alongside boundaries
 * from an old one). If anything goes wrong before that final swap, the
 * previously-live data is left completely untouched.
 */
export async function runSync() {
  const client = await pool.connect();
  let runId;
  const startedAt = Date.now();

  try {
    const { rows: lockRows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
      SYNC_LOCK_KEY,
    ]);
    if (!lockRows[0].locked) {
      logger.warn('A sync is already running — skipping this run');
      return { success: false, skipped: true };
    }

    const targetTable = await getInactiveTable(client);

    const insertRun = await client.query(
      `INSERT INTO sync_runs (status, target_table) VALUES ('running', $1) RETURNING id`,
      [targetTable]
    );
    runId = insertRun.rows[0].id;
    logger.info({ runId, targetTable, layers: SYNC_LAYERS.map((l) => l.key) }, 'Sync started');

    await client.query(`TRUNCATE ${targetTable}`);

    let totalExpected = 0;
    let totalFetched = 0;
    let totalFailedChunks = 0;
    const perLayer = [];

    // --- Phase 1+2: fetch and load each layer in turn ---
    for (const layer of SYNC_LAYERS) {
      const layerUrl = `${env.arcgis.baseUrl}/${layer.id}`;
      logger.info({ runId, layer: layer.key }, 'Syncing layer');

      const result = await fetchAllFeatures(layerUrl, {
        onProgress: ({ completedChunks, totalChunks }) => {
          logger.info({ runId, layer: layer.key, completedChunks, totalChunks }, 'Sync progress');
        },
      });

      totalExpected += result.expectedCount;
      totalFetched += result.fetchedCount;
      totalFailedChunks += result.failedChunks;
      perLayer.push({ layer: layer.key, expected: result.expectedCount, fetched: result.fetchedCount });

      if (result.features.length > 0) {
        await bulkInsertEsriFeatures(
          client,
          targetTable,
          result.features,
          result.geometryType,
          layer.id,
          layer.label,
          result.objectIdFieldName
        );
      }
    }

    const successRatio = totalExpected === 0 ? 0 : totalFetched / totalExpected;

    // --- Safety check: don't publish an incomplete snapshot ---
    if (successRatio < env.sync.minSuccessRatio) {
      const message =
        `Only fetched ${totalFetched}/${totalExpected} features across all layers ` +
        `(${(successRatio * 100).toFixed(1)}%), below the ${(env.sync.minSuccessRatio * 100).toFixed(1)}% ` +
        `threshold. Aborting — previously published data stays live. Per-layer: ${JSON.stringify(perLayer)}`;

      logger.error({ runId }, message);

      await client.query(
        `UPDATE sync_runs SET status='failed', finished_at=now(), features_expected=$1,
         features_fetched=$2, duration_ms=$3, error_message=$4 WHERE id=$5`,
        [totalExpected, totalFetched, Date.now() - startedAt, message, runId]
      );

      return { success: false, reason: message };
    }

    // --- Phase 3: index everything, then atomically publish it ---
    await finalizeTable(client, targetTable);
    await swapActiveTable(client);
    clearGeojsonCache(); // don't keep serving the old snapshot from cache for up to an hour
    clearSitesCache();

    const durationMs = Date.now() - startedAt;
    const status = totalFailedChunks > 0 ? 'partial' : 'success';

    await client.query(
      `UPDATE sync_runs SET status=$1, finished_at=now(), features_expected=$2,
       features_fetched=$3, duration_ms=$4 WHERE id=$5`,
      [status, totalExpected, totalFetched, durationMs, runId]
    );

    logger.info({ runId, status, fetched: totalFetched, durationMs, perLayer }, 'Sync finished and published');

    return { success: true, status, fetched: totalFetched, perLayer };
  } catch (err) {
    logger.error({ runId, err }, 'Sync crashed — previously published data stays live');

    if (runId) {
      await client
        .query(`UPDATE sync_runs SET status='failed', finished_at=now(), error_message=$1 WHERE id=$2`, [
          err.message,
          runId,
        ])
        .catch(() => {});
    }

    return { success: false, reason: err.message };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
