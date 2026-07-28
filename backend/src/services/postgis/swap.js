import { getInactiveTable } from './syncState.js';

/**
 * Atomically flips the "archaeological_sites" view to point at the
 * table we just finished loading, and records which table is now live.
 * Everything here runs inside one transaction — the view repoint and
 * the sync_state update either both happen or neither does, so there's
 * never a moment where they disagree about which table is active.
 */
export async function swapActiveTable(client) {
  const newActiveTable = await getInactiveTable(client); // the one we just loaded

  await client.query('BEGIN');
  try {
    await client.query(
      `CREATE OR REPLACE VIEW archaeological_sites AS SELECT * FROM ${newActiveTable}`
    );
    await client.query(
      `UPDATE sync_state SET value = $1 WHERE key = 'active_table'`,
      [newActiveTable]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  return newActiveTable;
}
