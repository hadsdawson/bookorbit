import { resolve } from 'path';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { createBackup, listBackups, resolveBackupDir } from './backup-archive';
import { BACKUP_SETTINGS_KEY, parseBackupSettings, pruneBackups } from './backup-policy';
import { formatBackupProgress } from './backup-progress';
import { runPendingRestore } from './backup-restore';

/**
 * Fork only. Runs in the migration script before any migration: first a restore someone asked for
 * from Settings, then, when this start brings database changes, a safety backup of the database as
 * it was. A failed safety backup is logged loudly but does not stop BookOrbit from starting.
 */
export async function runBackupStartup(
  pool: Pool,
  migrations: readonly Pick<MigrationMeta, 'hash'>[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) return;
  const appDataPath = resolve(env.APP_DATA_PATH ?? '/data');
  const backupDir = resolveBackupDir(appDataPath, env);
  const appVersion = env.APP_VERSION ?? 'Local build';
  const knownMigrationHashes = new Set(migrations.map((migration) => migration.hash));
  const log = (message: string) => console.log(message);

  const restored = await runPendingRestore({
    pool,
    databaseUrl,
    appDataPath,
    backupDir,
    appVersion,
    knownMigrationHashes,
    ledgerHashes: await readLedgerHashes(pool),
    log,
  });
  if (restored?.ok) return;

  const ledgerHashes = await readLedgerHashes(pool);
  if (ledgerHashes.length === 0) return;
  const recorded = new Set(ledgerHashes);
  const pending = migrations.filter((migration) => !recorded.has(migration.hash)).length;
  if (pending === 0) return;

  const settings = parseBackupSettings(await readSetting(pool, BACKUP_SETTINGS_KEY));
  if (!settings.beforeUpdate) return;

  const startedAt = Date.now();
  log(
    `[backup.pre_update] [start] pendingMigrations=${pending} - backing up before the update changes the database; the app opens once this finishes, so do not restart it`,
  );
  try {
    const backup = await createBackup({
      databaseUrl,
      appDataPath,
      backupDir,
      kind: 'pre-update',
      appVersion,
      migrationHashes: ledgerHashes,
      onProgress: (progress) => log(formatBackupProgress('backup.pre_update', progress)),
    });
    await pruneBackups(backupDir, await listBackups(backupDir), settings.keep);
    log(`[backup.pre_update] [end] durationMs=${Date.now() - startedAt} backup=${backup.name} size=${backup.size} - backed up before the update`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const refuse = settings.requireBeforeUpdate && env.BACKUP_SKIP_PRE_UPDATE?.trim().toLowerCase() !== 'true';
    console.error(
      `[backup.pre_update] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(message)}" - no backup was taken before this update; ${refuse ? 'the update is refused' : 'continuing'}`,
    );
    if (refuse) {
      throw new Error(
        `BookOrbit is set not to update without a backup, and the backup failed: ${message}. Fix the backups folder and restart, or set BACKUP_SKIP_PRE_UPDATE=true to update once without a backup.`,
        { cause: error },
      );
    }
  }
}

async function readLedgerHashes(pool: Pick<Pool, 'query'>): Promise<string[]> {
  const table = await pool.query<{ name: string | null }>(`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name`);
  if (!table.rows[0]?.name) return [];
  const rows = await pool.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at');
  return rows.rows.map((row) => row.hash);
}

async function readSetting(pool: Pick<Pool, 'query'>, key: string): Promise<string | null> {
  try {
    const rows = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key]);
    return rows.rows[0]?.value ?? null;
  } catch {
    return null;
  }
}
