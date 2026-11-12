import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client, Pool } from 'pg';

import { createBackup, listBackups } from '../src/modules/backup/lib/backup-archive';
import { DatabaseLostError, RESTORE_RESULT, requestRestore, runPendingRestore, swapDataDirs } from '../src/modules/backup/lib/backup-restore';
import { runBackupStartup } from '../src/modules/backup/lib/backup-startup';

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Backs up and restores a real database with the real PostgreSQL tools. The schema is a small
 * stand-in for BookOrbit's: a migration ledger, a table, and an extension living in `public`.
 */
describe('Backup restore (e2e)', { timeout: 120_000 }, () => {
  let admin: Client;
  let pool: Pool;
  let databaseUrl: string;
  let databaseName: string;
  let workDir: string;
  let appDataPath: string;
  let backupDir: string;

  const context = (overrides: Partial<Parameters<typeof runPendingRestore>[0]> = {}) => ({
    pool,
    databaseUrl,
    appDataPath,
    backupDir,
    appVersion: 'test',
    knownMigrationHashes: new Set(['m1', 'm2']),
    ledgerHashes: ['m1'],
    log: () => undefined,
    ...overrides,
  });

  const titles = async () => (await pool.query<{ title: string }>('SELECT title FROM books ORDER BY id')).rows.map((row) => row.title);

  beforeEach(async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    databaseName = `backup_restore_${randomUUID().replace(/-/g, '').slice(0, 12)}_e2e`;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = `/${databaseName}`;
    databaseUrl = targetUrl.toString();
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';
    admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    // Dropping the database at the end can cut a connection the pool is still closing.
    pool.on('error', () => undefined);
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('m1', 1);
      CREATE TABLE books (id serial PRIMARY KEY, title text NOT NULL);
      CREATE INDEX books_title_trgm ON books USING gin (title gin_trgm_ops);
      INSERT INTO books (title) VALUES ('Before');
    `);

    workDir = await mkdtemp(join(tmpdir(), 'backup-restore-e2e-'));
    appDataPath = join(workDir, 'data');
    backupDir = join(workDir, 'backups');
    await mkdir(join(appDataPath, 'covers'), { recursive: true });
    await writeFile(join(appDataPath, 'covers', 'cover.txt'), 'before');
  });

  afterEach(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE)`);
    await admin.end();
    await rm(workDir, { recursive: true, force: true });
  });

  async function backUp(): Promise<string> {
    const backup = await createBackup({ databaseUrl, appDataPath, backupDir, kind: 'manual', appVersion: 'test', migrationHashes: ['m1'] });
    return backup.name;
  }

  it('brings the database and data folders back, and drops tables added since the backup', async () => {
    const name = await backUp();
    await pool.query(`INSERT INTO books (title) VALUES ('After'); CREATE TABLE added_later (id int);`);
    await writeFile(join(appDataPath, 'covers', 'cover.txt'), 'after');
    await requestRestore(backupDir, name);

    const result = await runPendingRestore(context());

    expect(result).toMatchObject({ name, ok: true });
    expect(await titles()).toEqual(['Before']);
    expect((await pool.query(`SELECT to_regclass('public.added_later')::text AS name`)).rows[0].name).toBeNull();
    expect(await readFile(join(appDataPath, 'covers', 'cover.txt'), 'utf8')).toBe('before');
    expect((await listBackups(backupDir)).some((backup) => backup.kind === 'pre-restore')).toBe(true);
    expect(existsSync(join(appDataPath, '.restore-previous'))).toBe(false);
    expect(existsSync(join(appDataPath, '.restore-incoming'))).toBe(false);
  });

  it('leaves the database exactly as it was when the backup cannot be loaded', async () => {
    const name = await backUp();
    await pool.query(`INSERT INTO books (title) VALUES ('After')`);
    await requestRestore(backupDir, name);
    // psql that always fails stands in for a dump that will not load: the drop must be rolled back with it.
    process.env.PSQL_PATH = '/bin/false';
    try {
      const result = await runPendingRestore(context());
      expect(result).toMatchObject({ ok: false });
      expect(result?.databaseEmpty).toBeUndefined();
    } finally {
      delete process.env.PSQL_PATH;
    }
    expect(await titles()).toEqual(['Before', 'After']);
  });

  it('rolls the whole load back when the dump fails partway through', async () => {
    const name = await backUp();
    await pool.query(`INSERT INTO books (title) VALUES ('After')`);
    await requestRestore(backupDir, name);
    // A pg_restore that prints valid SQL and then fails: nothing it printed may be committed.
    const brokenRestore = join(workDir, 'broken-pg-restore.sh');
    await writeFile(brokenRestore, '#!/bin/sh\ncase "$*" in *--list*) exit 0;; esac\necho "CREATE TABLE half_loaded (id int);"\nexit 1\n', {
      mode: 0o755,
    });
    process.env.PG_RESTORE_PATH = brokenRestore;
    try {
      expect(await runPendingRestore(context())).toMatchObject({ ok: false });
    } finally {
      delete process.env.PG_RESTORE_PATH;
    }
    expect(await titles()).toEqual(['Before', 'After']);
    expect((await pool.query(`SELECT to_regclass('public.half_loaded')::text AS name`)).rows[0].name).toBeNull();
  });

  it('puts the data folders back when swapping them fails', async () => {
    const incoming = join(appDataPath, '.restore-incoming');
    await mkdir(join(incoming, 'covers'), { recursive: true });
    await writeFile(join(incoming, 'covers', 'cover.txt'), 'from backup');
    await mkdir(join(incoming, 'authors'), { recursive: true });
    // A dangling link where the second folder goes makes its swap fail after the first has worked.
    await symlink(join(workDir, 'nowhere'), join(appDataPath, 'authors'));

    await expect(swapDataDirs(appDataPath, incoming, ['covers', 'authors'])).rejects.toThrow();

    expect(await readFile(join(appDataPath, 'covers', 'cover.txt'), 'utf8')).toBe('before');
    expect(existsSync(join(appDataPath, '.restore-previous'))).toBe(false);
  });

  it('refuses to start, now and on later starts, when a restore leaves the database empty', async () => {
    const name = await backUp();
    await requestRestore(backupDir, name);
    const emptied = {
      query: async (sql: string) => {
        if (sql.includes('to_regclass')) return { rows: [{ name: null }] };
        return pool.query(sql);
      },
    } as unknown as Pool;
    process.env.PSQL_PATH = '/bin/false';
    try {
      await expect(runPendingRestore(context({ pool: emptied }))).rejects.toBeInstanceOf(DatabaseLostError);
    } finally {
      delete process.env.PSQL_PATH;
    }
    expect(JSON.parse(await readFile(join(backupDir, RESTORE_RESULT), 'utf8'))).toMatchObject({ ok: false, databaseEmpty: true });
    await expect(runPendingRestore(context({ pool: emptied }))).rejects.toBeInstanceOf(DatabaseLostError);
    expect(await runPendingRestore(context())).toBeNull();
  });

  it('refuses an update without a backup only when asked to', async () => {
    await pool.query(`CREATE TABLE app_settings (key text PRIMARY KEY, value text NOT NULL)`);
    const env = { DATABASE_URL: databaseUrl, APP_DATA_PATH: appDataPath, BACKUP_PATH: backupDir };
    process.env.PG_DUMP_PATH = '/bin/false';
    const pending = [{ hash: 'm1' }, { hash: 'm2' }];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(runBackupStartup(pool, pending, env)).resolves.toBeUndefined();
      await pool.query(`INSERT INTO app_settings VALUES ('backup_settings', '{"requireBeforeUpdate":true}')`);
      await expect(runBackupStartup(pool, pending, env)).rejects.toThrow(/not to update without a backup/);
      await expect(runBackupStartup(pool, pending, { ...env, BACKUP_SKIP_PRE_UPDATE: 'true' })).resolves.toBeUndefined();
    } finally {
      delete process.env.PG_DUMP_PATH;
      errors.mockRestore();
      logs.mockRestore();
    }
  });
});
