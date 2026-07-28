import { env } from '../../config/env.js';
import { fetchAllObjectIds } from './fetchObjectIds.js';
import { fetchChunk } from './fetchChunk.js';
import { logger } from '../../logger.js';

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs `worker` over `items` with at most `limit` running at once —
 * a simple hand-rolled concurrency pool so we don't hammer the
 * government server with all requests simultaneously.
 */
async function runWithConcurrencyLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.min(limit, items.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}

/**
 * Fetches every feature in the layer. Chunks are fetched with bounded
 * concurrency; each chunk already retries internally (see client.js).
 * If a chunk still fails after those retries, we log it and move on —
 * one bad batch doesn't abort the whole run. The caller decides
 * afterwards whether fetchedCount/expectedCount is good enough to
 * proceed with (see SYNC_MIN_SUCCESS_RATIO in env).
 */
export async function fetchAllFeatures(layerUrl, { onProgress } = {}) {
  const { objectIds: allIds, objectIdFieldName } = await fetchAllObjectIds(layerUrl);
  const chunks = chunkArray(allIds, env.arcgis.pageSize);

  logger.info(
    { layerUrl, totalIds: allIds.length, chunkCount: chunks.length, concurrency: env.arcgis.concurrency, objectIdFieldName },
    'Starting chunked fetch of all features'
  );

  let geometryType = null;
  const allFeatures = [];
  let completedChunks = 0;
  let failedChunks = 0;

  await runWithConcurrencyLimit(chunks, env.arcgis.concurrency, async (chunkIds, i) => {
    try {
      const result = await fetchChunk(layerUrl, chunkIds);
      geometryType = geometryType ?? result.geometryType;
      allFeatures.push(...result.features);
    } catch (err) {
      failedChunks++;
      logger.error(
        { chunkIndex: i, chunkSize: chunkIds.length, err: err.message },
        'Chunk failed after all retries — skipping this batch'
      );
    } finally {
      completedChunks++;
      onProgress?.({ completedChunks, totalChunks: chunks.length });
    }
  });

  return {
    geometryType,
    features: allFeatures,
    objectIdFieldName,
    expectedCount: allIds.length,
    fetchedCount: allFeatures.length,
    failedChunks,
  };
}
