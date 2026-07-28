import pg from 'pg';
import { env } from './env.js';
import { logger } from '../logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.pgSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Errors on idle clients — must be handled or the process crashes.
  logger.error({ err }, 'Unexpected error on idle PG client');
});

/**
 * Run a function inside a single client/transaction.
 * Ensures COMMIT/ROLLBACK and client release always happen.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
