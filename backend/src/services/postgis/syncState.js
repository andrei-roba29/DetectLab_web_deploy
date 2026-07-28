const TABLE_A = 'archaeological_sites_a';
const TABLE_B = 'archaeological_sites_b';

/** Which table the public "archaeological_sites" view currently points to. */
export async function getActiveTable(client) {
  const { rows } = await client.query(
    `SELECT value FROM sync_state WHERE key = 'active_table'`
  );
  return rows[0]?.value ?? TABLE_A;
}

/** The other table — safe to overwrite, since nothing reads from it live. */
export async function getInactiveTable(client) {
  const active = await getActiveTable(client);
  return active === TABLE_A ? TABLE_B : TABLE_A;
}
