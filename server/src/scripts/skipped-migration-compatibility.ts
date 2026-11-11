import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';

/**
 * Fork only. Drizzle applies just the migrations newer than the newest one recorded, so a migration
 * that upstream slots in before one this database already ran is skipped for good. That happened when
 * upstream added 0141_add_api_keys ahead of 0142_torbox_download_client, which this fork had already
 * deployed along with its own 0143_request_tracking_and_not_interested. Such migrations are applied
 * here, in order, with upstream's own SQL, then recorded so Drizzle sees them as done.
 *
 * Only migrations newer than the last one both histories shared are considered, so a database whose
 * older ledger differs for any other reason is never touched.
 */
export const FORK_DIVERGENCE_MILLIS = 1794068460741; // 0140_add_merge_job_library_ids

type LedgerRow = { hash: string; createdAt: string };

export async function applySkippedMigrations(
  pool: Pick<Pool, 'connect'>,
  migrations: readonly Pick<MigrationMeta, 'folderMillis' | 'hash' | 'sql'>[],
): Promise<{ appliedMigrations: number }> {
  const client = await pool.connect();
  const startedAt = Date.now();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bookorbit'), hashtext('migration-ledger-compatibility'))`);
    const table = await client.query<{ tableName: string | null }>(`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS "tableName"`);
    if (table.rows.length === 0 || table.rows[0]?.tableName === null) {
      await client.query('COMMIT');
      return { appliedMigrations: 0 };
    }

    const ledger = await client.query<LedgerRow>(`SELECT hash, created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations`);
    const recorded = new Set(ledger.rows.map((row) => row.hash));
    const newest = ledger.rows.reduce((max, row) => Math.max(max, Number(row.createdAt)), 0);
    const skipped = [...migrations]
      .filter((migration) => migration.folderMillis > FORK_DIVERGENCE_MILLIS && migration.folderMillis < newest && !recorded.has(migration.hash))
      .sort((a, b) => a.folderMillis - b.folderMillis);

    for (const migration of skipped) {
      for (const statement of migration.sql) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [migration.hash, migration.folderMillis]);
    }

    await client.query('COMMIT');
    if (skipped.length > 0) {
      console.warn(
        `[db.skipped-migration-compatibility] [end] durationMs=${Date.now() - startedAt} applied=${skipped.length} - migrations hidden behind newer ones applied`,
      );
    }
    return { appliedMigrations: skipped.length };
  } catch (error) {
    await client.query('ROLLBACK');
    const errorClass = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[db.skipped-migration-compatibility] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - skipped migrations could not be applied`,
    );
    throw error;
  } finally {
    client.release();
  }
}
