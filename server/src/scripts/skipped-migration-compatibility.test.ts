import type { Pool } from 'pg';

import { applySkippedMigrations, FORK_DIVERGENCE_MILLIS } from './skipped-migration-compatibility';

const base = FORK_DIVERGENCE_MILLIS;
const migrations = [
  { hash: 'shared', folderMillis: base, sql: ['CREATE TABLE shared ()'] },
  { hash: 'api-keys', folderMillis: base + 10, sql: ['CREATE TABLE api_keys ()', ' '] },
  { hash: 'torbox', folderMillis: base + 20, sql: ['ALTER TABLE torbox'] },
  { hash: 'tracking', folderMillis: base + 30, sql: ['ALTER TABLE tracking'] },
];

function createPool(tableName: string | null, ledger: Array<{ hash: string; createdAt: string }>) {
  const query = vi.fn((statement: string) => {
    if (statement.includes('to_regclass')) return Promise.resolve({ rows: [{ tableName }] });
    if (statement.startsWith('SELECT hash')) return Promise.resolve({ rows: ledger });
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;
  return { pool, query, release };
}

describe('applySkippedMigrations', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('does nothing on a fresh database', async () => {
    const { pool, query } = createPool(null, []);
    await expect(applySkippedMigrations(pool, migrations)).resolves.toEqual({ appliedMigrations: 0 });
    expect(query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('applies a migration slotted in behind ones already run, and records it', async () => {
    const { pool, query } = createPool('drizzle.__drizzle_migrations', [
      { hash: 'shared', createdAt: String(base) },
      { hash: 'torbox', createdAt: String(base + 20) },
      { hash: 'tracking', createdAt: String(base + 30) },
    ]);
    await expect(applySkippedMigrations(pool, migrations)).resolves.toEqual({ appliedMigrations: 1 });
    const statements = query.mock.calls.map(([statement]) => statement);
    expect(statements).toContain('CREATE TABLE api_keys ()');
    expect(statements).not.toContain(' ');
    expect(statements).not.toContain('ALTER TABLE torbox');
    expect(query).toHaveBeenCalledWith('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', ['api-keys', base + 10]);
  });

  it('leaves migrations newer than everything recorded to Drizzle', async () => {
    const { pool, query } = createPool('drizzle.__drizzle_migrations', [{ hash: 'shared', createdAt: String(base) }]);
    await expect(applySkippedMigrations(pool, migrations)).resolves.toEqual({ appliedMigrations: 0 });
    expect(query.mock.calls.some(([statement]) => statement.startsWith('INSERT'))).toBe(false);
  });

  it('never touches migrations from before the fork split off', async () => {
    const older = [{ hash: 'old', folderMillis: base - 5, sql: ['CREATE TABLE old ()'] }, ...migrations];
    const { pool, query } = createPool('drizzle.__drizzle_migrations', [
      { hash: 'shared', createdAt: String(base) },
      { hash: 'api-keys', createdAt: String(base + 10) },
      { hash: 'tracking', createdAt: String(base + 30) },
      { hash: 'torbox', createdAt: String(base + 20) },
    ]);
    await expect(applySkippedMigrations(pool, older)).resolves.toEqual({ appliedMigrations: 0 });
    expect(query.mock.calls.map(([statement]) => statement)).not.toContain('CREATE TABLE old ()');
  });

  it('rolls back everything when a statement fails', async () => {
    const { pool, query, release } = createPool('drizzle.__drizzle_migrations', [{ hash: 'tracking', createdAt: String(base + 30) }]);
    query.mockImplementation((statement: string) => {
      if (statement.includes('to_regclass')) return Promise.resolve({ rows: [{ tableName: 'x' }] });
      if (statement.startsWith('SELECT hash')) return Promise.resolve({ rows: [{ hash: 'tracking', createdAt: String(base + 30) }] });
      if (statement.startsWith('ALTER TABLE torbox')) return Promise.reject(new Error('boom'));
      return Promise.resolve({ rows: [] });
    });
    await expect(applySkippedMigrations(pool, migrations)).rejects.toThrow('boom');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
