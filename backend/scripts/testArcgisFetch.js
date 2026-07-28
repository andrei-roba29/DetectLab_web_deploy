import { fetchAllObjectIds } from '../src/services/arcgis/fetchObjectIds.js';
import { fetchChunk } from '../src/services/arcgis/fetchChunk.js';
import { esriFeatureToGeoJson } from '../src/services/arcgis/esriToGeoJson.js';
import { logger } from '../src/logger.js';

async function main() {
  logger.info('Fetching full object ID list from ArcGIS...');
  const ids = await fetchAllObjectIds();
  logger.info({ count: ids.length }, 'Got object IDs');

  const sampleIds = ids.slice(0, 5);
  logger.info({ sampleIds }, 'Fetching a tiny sample of 5 features...');

  const { geometryType, features } = await fetchChunk(sampleIds);
  logger.info({ geometryType }, 'Server geometry type for this layer');

  console.log('\n--- Raw Esri JSON feature ---\n');
  console.log(JSON.stringify(features[0], null, 2));

  console.log('\n--- Converted to GeoJSON ---\n');
  console.log(JSON.stringify(esriFeatureToGeoJson(features[0], geometryType), null, 2));

  console.log(`\nFetched ${features.length} sample features out of ${ids.length} total.\n`);
}

main().catch((err) => {
  logger.error({ err }, 'Test fetch failed');
  process.exit(1);
});
