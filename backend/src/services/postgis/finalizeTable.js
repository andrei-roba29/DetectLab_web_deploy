/**
 * After a bulk COPY load, add the spatial index and refresh planner
 * stats. Doing this AFTER the load (not before) is much faster — an
 * index that has to update on every inserted row is far slower than
 * building it once against a fully-populated table.
 */
export async function finalizeTable(client, tableName) {
  await client.query(
    `CREATE INDEX IF NOT EXISTS ${tableName}_geom_idx ON ${tableName} USING GIST (geom)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS ${tableName}_layer_idx ON ${tableName} (layer_id)`
  );
  await client.query(`ANALYZE ${tableName}`);
}
