import { pool } from '../src/config/db.js';
import { fetchAllObjectIds } from '../src/services/arcgis/fetchObjectIds.js';
import { fetchChunk } from '../src/services/arcgis/fetchChunk.js';
import { bulkInsertEsriFeatures } from '../src/services/postgis/bulkImport.js';
import { getInactiveTable } from '../src/services/postgis/syncState.js';
import { logger } from '../src/logger.js';

async function main() {
  const client = await pool.connect();

  try {
    const targetTable = await getInactiveTable(client);
    logger.info({ targetTable }, 'Will import into the INACTIVE table (your live data, if any, is untouched)');

    await client.query(`TRUNCATE ${targetTable}`); // clean slate in case of a previous test run

    const ids = await fetchAllObjectIds();
    const sampleIds = ids.slice(0, 50);
    logger.info({ count: sampleIds.length }, 'Fetching 50 sample features from ArcGIS...');

    const { geometryType, features } = await fetchChunk(sampleIds);

    logger.info('Bulk inserting into PostGIS via COPY...');
    const inserted = await bulkInsertEsriFeatures(client, targetTable, features, geometryType);

    const { rows } = await client.query(`SELECT count(*) FROM ${targetTable}`);
    logger.info({ targetTable, inserted, rowCountInTable: rows[0].count }, 'Import complete!');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'PostGIS import test failed');
  process.exit(1);
});
