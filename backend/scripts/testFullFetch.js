import { fetchAllFeatures } from '../src/services/arcgis/fetchAllFeatures.js';
import { logger } from '../src/logger.js';

async function main() {
  const startedAt = Date.now();

  const result = await fetchAllFeatures({
    onProgress: ({ completedChunks, totalChunks }) => {
      logger.info({ completedChunks, totalChunks }, 'Progress');
    },
  });

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const successRatio = (result.fetchedCount / result.expectedCount).toFixed(4);

  console.log('\n--- Full fetch summary ---\n');
  console.log(`Expected features:  ${result.expectedCount}`);
  console.log(`Fetched features:   ${result.fetchedCount}`);
  console.log(`Failed batches:     ${result.failedChunks}`);
  console.log(`Success ratio:      ${successRatio}`);
  console.log(`Duration:           ${durationSec}s`);
  console.log(`Geometry type:      ${result.geometryType}`);
}

main().catch((err) => {
  logger.error({ err }, 'Full fetch test failed');
  process.exit(1);
});
