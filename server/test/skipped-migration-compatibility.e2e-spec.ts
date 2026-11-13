import { randomUUID } from 'crypto';
import { Client, Pool } from 'pg';

import { applySkippedMigrations, FORK_DIVERGENCE_MILLIS } from '../src/scripts/skipped-migration-compatibility';

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const base = FORK_DIVERGENCE_MILLIS;
const shared = { hash: 'shared', folderMillis: base, sql: ['CREATE TABLE shared_table (id int)'] };
const upstreamLate = {
  hash: 'upstream-late',
  folderMillis: base + 10,
  sql: ['CREATE TABLE upstream_late (id int)', 'CREATE INDEX upstream_late_id ON upstream_late (id)'],
};
const forkOnly = { hash: 'fork-only', folderMillis: base + 20, sql: ['CREATE TABLE fork_only (id int)'] };

/**
 * The upstream-merge case against a real database: this fork's database has already run a fork
 * migration when an upstream one with an earlier time arrives in a merge.
 */
describe('Skipped migration compatibility (e2e)', { timeout: 60_000 }, () => {
  let admin: Client;
  let pool: Pool;
  let databaseName: string;

  beforeEach(async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    databaseName = `skipped_migration_${randomUUID().replace(/-/g, '').slice(0, 12)}_e2e`;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';
    admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
    pool = new Pool({ connectionString: targetUrl.toString(), max: 2 });
    pool.on('error', () => undefined);
    await pool.query(`
      CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
      CREATE TABLE shared_table (id int);
      CREATE TABLE fork_only (id int);
    `);
    await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2), ($3, $4)', [
      shared.hash,
      shared.folderMillis,
      forkOnly.hash,
      forkOnly.folderMillis,
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE)`);
    await admin.end();
  });

  const tableExists = async (name: string) => (await pool.query(`SELECT to_regclass($1)::text AS name`, [`public.${name}`])).rows[0].name !== null;
  const ledger = async () =>
    (await pool.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows.map((row) => row.hash);

  it('applies an upstream migration that arrived behind a fork one, once', async () => {
    const migrations = [shared, upstreamLate, forkOnly];

    await expect(applySkippedMigrations(pool, migrations)).resolves.toEqual({ appliedMigrations: 1 });
    expect(await tableExists('upstream_late')).toBe(true);
    expect(await ledger()).toEqual(['shared', 'upstream-late', 'fork-only']);

    await expect(applySkippedMigrations(pool, migrations)).resolves.toEqual({ appliedMigrations: 0 });
  });

  it('applies nothing and records nothing when a skipped migration fails partway', async () => {
    const broken = { ...upstreamLate, sql: ['CREATE TABLE upstream_late (id int)', 'ALTER TABLE no_such_table ADD COLUMN x int'] };

    await expect(applySkippedMigrations(pool, [shared, broken, forkOnly])).rejects.toThrow();
    expect(await tableExists('upstream_late')).toBe(false);
    expect(await ledger()).toEqual(['shared', 'fork-only']);
  });
});
