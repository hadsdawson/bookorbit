import { existsSync } from 'fs';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Pool } from 'pg';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';

import {
  createBackup,
  DATABASE_ENTRY,
  extractDataDirs,
  extractEntry,
  isBackupFileName,
  readManifest,
  replaceDatabaseFromDump,
  runPgTool,
  type BackupManifest,
} from './backup-archive';

export const RESTORE_MARKER = '.restore-pending.json';
export const RESTORE_RESULT = '.restore-result.json';

export interface RestoreResult {
  name: string;
  ok: boolean;
  finishedAt: string;
  error?: string;
  /** The safety backup taken just before, for going back. */
  safetyBackup?: string;
  /** The database was left without BookOrbit's tables, so starting up would create a new, empty one. */
  databaseEmpty?: boolean;
}

/** Thrown to stop startup when carrying on would build a new, empty BookOrbit over a lost database. */
export class DatabaseLostError extends Error {
  constructor(safetyBackup: string | undefined, backupDir: string) {
    super(
      `A restore left the database empty. BookOrbit will not start, so it cannot create a new empty library in its place. ` +
        (safetyBackup ? `Your data from before the restore is in ${safetyBackup} in ${backupDir}. ` : '') +
        `To restore a backup, write {"name":"<backup file name>"} to ${RESTORE_MARKER} in ${backupDir} and restart. ` +
        `To start fresh on purpose, delete ${RESTORE_RESULT} in ${backupDir} and restart.`,
    );
    this.name = 'DatabaseLostError';
  }
}

export interface RestoreContext {
  pool: Pick<Pool, 'query'>;
  databaseUrl: string;
  appDataPath: string;
  backupDir: string;
  appVersion: string;
  /** Hashes of every migration this version of BookOrbit ships. */
  knownMigrationHashes: ReadonlySet<string>;
  /** Hashes the database has run, for the safety backup's manifest. */
  ledgerHashes: string[];
  log: (message: string) => void;
}

/** Throws with a plain reason when this version of BookOrbit cannot take the backup. */
export function assertRestorable(manifest: BackupManifest, knownMigrationHashes: ReadonlySet<string>): void {
  const unknown = manifest.migrationHashes.filter((hash) => !knownMigrationHashes.has(hash));
  if (unknown.length > 0) {
    throw new Error(`This backup came from a newer version of BookOrbit (${manifest.appVersion}). Update BookOrbit first, then restore it.`);
  }
}

export async function requestRestore(backupDir: string, name: string): Promise<void> {
  if (!isBackupFileName(name)) throw new Error('Unknown backup');
  await writeFile(join(backupDir, RESTORE_MARKER), JSON.stringify({ name, requestedAt: new Date().toISOString() }));
}

export async function readPendingRestore(backupDir: string): Promise<string | null> {
  try {
    const marker = JSON.parse(await readFile(join(backupDir, RESTORE_MARKER), 'utf8')) as { name?: unknown };
    return typeof marker.name === 'string' && isBackupFileName(marker.name) ? marker.name : null;
  } catch {
    return null;
  }
}

export async function cancelPendingRestore(backupDir: string): Promise<void> {
  await rm(join(backupDir, RESTORE_MARKER), { force: true });
}

export async function readRestoreResult(backupDir: string): Promise<RestoreResult | null> {
  try {
    return JSON.parse(await readFile(join(backupDir, RESTORE_RESULT), 'utf8')) as RestoreResult;
  } catch {
    return null;
  }
}

/**
 * Runs before migrations at startup, while nothing else is using the database. Takes a safety backup
 * of what is there now, then replaces the database and data folders with the backup's. Each step can
 * be undone: the database is swapped in one transaction, and the data folders are unpacked beside
 * the live ones first and put back if the swap fails. Migrations then bring an older backup up to date.
 */
export async function runPendingRestore(context: RestoreContext): Promise<RestoreResult | null> {
  const name = await readPendingRestore(context.backupDir);
  if (!name) {
    await assertDatabaseNotLost(context);
    return null;
  }
  // Cleared first: a restore that crashes the process must not run again on every restart.
  await cancelPendingRestore(context.backupDir);
  const backupPath = join(context.backupDir, name);
  context.log(`[backup.restore] [start] backup=${name} - restoring`);
  const startedAt = Date.now();
  const hadDatabase = context.ledgerHashes.length > 0;

  let safetyBackup: string | undefined;
  let result: RestoreResult;
  try {
    if (!existsSync(backupPath)) throw new Error('The backup file is no longer there');
    const manifest = await readManifest(backupPath);
    assertRestorable(manifest, context.knownMigrationHashes);

    const safety = await createBackup({
      databaseUrl: context.databaseUrl,
      appDataPath: context.appDataPath,
      backupDir: context.backupDir,
      kind: 'pre-restore',
      appVersion: context.appVersion,
      migrationHashes: context.ledgerHashes,
    });
    safetyBackup = safety.name;

    const staged = await stageDataDirs(context.appDataPath, backupPath);
    try {
      await restoreDatabase(context, backupPath);
      try {
        await swapDataDirs(context.appDataPath, staged, manifest.dataDirs);
      } catch (error) {
        context.log(`[backup.restore] [fail] stage=data - swapping the data folders failed, putting the previous database back`);
        await restoreDatabase(context, join(context.backupDir, safety.name));
        throw error;
      }
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
    result = { name, ok: true, finishedAt: new Date().toISOString(), safetyBackup };
    context.log(`[backup.restore] [end] backup=${name} durationMs=${Date.now() - startedAt} safetyBackup=${safetyBackup} - restored`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const databaseEmpty = hadDatabase && !(await hasMigrationLedger(context.pool));
    result = { name, ok: false, finishedAt: new Date().toISOString(), error: message, safetyBackup, ...(databaseEmpty ? { databaseEmpty } : {}) };
    context.log(
      `[backup.restore] [fail] backup=${name} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(message)}" - restore failed`,
    );
  }
  await writeFile(join(context.backupDir, RESTORE_RESULT), JSON.stringify(result));
  if (result.databaseEmpty) throw new DatabaseLostError(safetyBackup, context.backupDir);
  return result;
}

/**
 * A restore that lost the database stops every later start too, until a backup is restored or the
 * result file is deleted on purpose. Without this the next start would quietly build an empty app.
 */
async function assertDatabaseNotLost(context: RestoreContext): Promise<void> {
  const last = await readRestoreResult(context.backupDir);
  if (!last?.databaseEmpty) return;
  if (await hasMigrationLedger(context.pool)) return;
  throw new DatabaseLostError(last.safetyBackup, context.backupDir);
}

async function hasMigrationLedger(pool: Pick<Pool, 'query'>): Promise<boolean> {
  const table = await pool.query<{ name: string | null }>(`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name`);
  return Boolean(table.rows[0]?.name);
}

async function restoreDatabase(context: RestoreContext, backupPath: string): Promise<void> {
  const dumpPath = join(context.backupDir, `.restore-${Date.now()}.dump`);
  try {
    await extractEntry(backupPath, DATABASE_ENTRY, dumpPath);
    // Reads the dump's table of contents: a damaged file fails here, before anything is run.
    await runPgTool('pg_restore', ['--list', dumpPath]);
    await replaceDatabaseFromDump(context.databaseUrl, dumpPath);
  } finally {
    await rm(dumpPath, { force: true });
  }
}

/** Unpacks the backup's data folders beside the live ones, so a failed unpack changes nothing. */
async function stageDataDirs(appDataPath: string, backupPath: string): Promise<string> {
  const incoming = join(appDataPath, '.restore-incoming');
  await rm(incoming, { recursive: true, force: true });
  await mkdir(incoming, { recursive: true });
  try {
    await extractDataDirs(backupPath, incoming);
  } catch (error) {
    await rm(incoming, { recursive: true, force: true });
    throw error;
  }
  return incoming;
}

/**
 * Swaps each data folder for the staged copy. The live folders are set aside, not deleted, until
 * every swap has worked; if one fails they are all put back. Folders the backup does not have are
 * left as they are.
 */
export async function swapDataDirs(appDataPath: string, incoming: string, dataDirs: readonly string[]): Promise<void> {
  const previous = join(appDataPath, '.restore-previous');
  await rm(previous, { recursive: true, force: true });
  await mkdir(previous, { recursive: true });
  const swapped: { dir: string; hadLive: boolean }[] = [];
  try {
    for (const dir of dataDirs) {
      const live = join(appDataPath, dir);
      const replacement = join(incoming, dir);
      const hadLive = existsSync(live);
      if (hadLive) await rename(live, join(previous, dir));
      swapped.push({ dir, hadLive });
      if (existsSync(replacement)) await rename(replacement, live);
      else await mkdir(live, { recursive: true });
    }
  } catch (error) {
    for (const { dir, hadLive } of swapped.reverse()) {
      const live = join(appDataPath, dir);
      await rm(live, { recursive: true, force: true });
      if (hadLive) await rename(join(previous, dir), live);
    }
    await rm(previous, { recursive: true, force: true });
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}
