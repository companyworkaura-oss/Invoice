import pg from 'pg';
import { config } from '../config.js';

// NUMERIC (OID 1700) stays a string so money is never parsed into a float.
pg.types.setTypeParser(1700, (v) => v);
// DATE (OID 1082) stays "YYYY-MM-DD" instead of being shifted into a
// local-timezone JS Date, which is never what an invoice date means.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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
