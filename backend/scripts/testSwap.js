import { pool } from '../src/config/db.js';
import { finalizeTable } from '../src/services/postgis/finalizeTable.js';
import { swapActiveTable } from '../src/services/postgis/swap.js';
import { getInactiveTable } from '../src/services/postgis/syncState.js';
import { logger } from '../src/logger.js';

async function main() {
  const client = await pool.connect();

  try {
    const loadedTable = await getInactiveTable(client); // the table testPostgisImport.js filled
    logger.info({ loadedTable }, 'Building spatial index on the loaded table...');
    await finalizeTable(client, loadedTable);

    logger.info('Swapping the live view to point at it...');
    const newActive = await swapActiveTable(client);
    logger.info({ newActive }, 'Swap complete — this table is now LIVE');

    const { rows } = await client.query(
      `SELECT object_id, attributes->>'NUMESIT' AS site_name FROM archaeological_sites LIMIT 5`
    );
    console.log('\n--- First 5 rows now visible through the public view ---\n');
    console.table(rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'Swap test failed');
  process.exit(1);
});
