import { existsSync } from 'fs';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Pool } from 'pg';

import {
  createBackup,
  DATABASE_ENTRY,
  extractDataDirs,
  extractEntry,
  isBackupFileName,
  readManifest,
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
 * of what is there now, replaces the database and data folders with the backup's, and puts the
 * safety backup back if loading the database fails. Migrations then bring an older backup up to date.
 */
export async function runPendingRestore(context: RestoreContext): Promise<RestoreResult | null> {
  const name = await readPendingRestore(context.backupDir);
  if (!name) return null;
  // Cleared first: a restore that crashes the process must not run again on every restart.
  await cancelPendingRestore(context.backupDir);
  const backupPath = join(context.backupDir, name);
  context.log(`[backup.restore] [start] backup=${name} - restoring`);
  const startedAt = Date.now();

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

    await restoreDatabase(context, backupPath, safety.name);
    await restoreDataDirs(context.appDataPath, backupPath, manifest.dataDirs);
    result = { name, ok: true, finishedAt: new Date().toISOString(), safetyBackup };
    context.log(`[backup.restore] [end] backup=${name} durationMs=${Date.now() - startedAt} safetyBackup=${safetyBackup} - restored`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = { name, ok: false, finishedAt: new Date().toISOString(), error: message, safetyBackup };
    context.log(`[backup.restore] [fail] backup=${name} durationMs=${Date.now() - startedAt} error="${message.replace(/"/g, "'")}" - restore failed`);
  }
  await writeFile(join(context.backupDir, RESTORE_RESULT), JSON.stringify(result));
  return result;
}

async function restoreDatabase(context: RestoreContext, backupPath: string, safetyName: string): Promise<void> {
  const dumpPath = join(context.backupDir, `.restore-${Date.now()}.dump`);
  try {
    await extractEntry(backupPath, DATABASE_ENTRY, dumpPath);
    // Reads the dump's table of contents: a damaged file fails here, before the live database is touched.
    await runPgTool('pg_restore', ['--list', dumpPath]);
    try {
      await loadDump(context, dumpPath);
    } catch (error) {
      context.log(`[backup.restore] [fail] stage=database - loading the backup failed, putting the previous database back`);
      await extractEntry(join(context.backupDir, safetyName), DATABASE_ENTRY, dumpPath);
      await loadDump(context, dumpPath);
      throw error;
    }
  } finally {
    await rm(dumpPath, { force: true });
  }
}

/** Empties BookOrbit's schemas and loads a dump into them, so no table from a newer version is left behind. */
async function loadDump(context: RestoreContext, dumpPath: string): Promise<void> {
  await context.pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await context.pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await context.pool.query('CREATE SCHEMA public');
  await runPgTool('pg_restore', [
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    '--single-transaction',
    `--dbname=${context.databaseUrl}`,
    dumpPath,
  ]);
}

/**
 * Swaps each data folder for the backup's copy: unpacked beside the live one first, so a failed unpack
 * leaves the current folders untouched. Folders the backup does not have are left as they are.
 */
async function restoreDataDirs(appDataPath: string, backupPath: string, dataDirs: readonly string[]): Promise<void> {
  const incoming = join(appDataPath, '.restore-incoming');
  const previous = join(appDataPath, '.restore-previous');
  await rm(incoming, { recursive: true, force: true });
  await rm(previous, { recursive: true, force: true });
  await mkdir(incoming, { recursive: true });
  await mkdir(previous, { recursive: true });
  try {
    await extractDataDirs(backupPath, incoming);
    for (const dir of dataDirs) {
      const live = join(appDataPath, dir);
      const replacement = join(incoming, dir);
      if (existsSync(live)) await rename(live, join(previous, dir));
      if (existsSync(replacement)) await rename(replacement, live);
      else await mkdir(live, { recursive: true });
    }
  } finally {
    await rm(incoming, { recursive: true, force: true });
    await rm(previous, { recursive: true, force: true });
  }
}
