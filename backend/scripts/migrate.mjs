import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const connectionString = (process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required to run migrations.');
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'true') {
  throw new Error('DATABASE_SSL=true is required to run production migrations.');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 5_000,
  application_name: 'bulls-media-agent-migrations',
});
const client = await pool.connect();

try {
  await client.query('SELECT pg_advisory_lock($1)', [71420311]);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
  const appliedNames = new Set(applied.rows.map((row) => row.name));

  for (const name of files) {
    if (appliedNames.has(name)) continue;
    const sql = await readFile(join(migrationsDir, name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  try { await client.query('SELECT pg_advisory_unlock($1)', [71420311]); } finally {
    client.release();
    await pool.end();
  }
}
