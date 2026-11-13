import { spawn, type ChildProcess } from 'child_process';
import { createReadStream, createWriteStream, existsSync, statSync } from 'fs';
import { chmod, mkdir, opendir, readdir, rename, rm, stat } from 'fs/promises';
import { basename, join } from 'path';
import { pipeline } from 'stream/promises';
import { ZipArchive } from 'archiver';
import * as unzipper from 'unzipper';
import type { BackupInfo, BackupKind } from '@bookorbit/types';

import { BACKUP_PROGRESS_INTERVAL_MS, type BackupProgress } from './backup-progress';

export const BACKUP_FORMAT = 'bookorbit-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_PREFIX = 'bookorbit-backup-';
export const MANIFEST_ENTRY = 'manifest.json';
export const DATABASE_ENTRY = 'database.dump';
export const DATA_ENTRY_PREFIX = 'data/';
/**
 * The parts of the app data folder a restore needs: chosen covers, author photos, avatars, custom
 * icons and fonts, installed plugins. Book Dock files, downloads and read-aloud audio are left out:
 * they are large, and either replaceable or about to be filed away.
 */
export const BACKED_UP_DATA_DIRS = ['covers', 'authors', 'users', 'icons', 'fonts', 'plugins'] as const;
/** A backup holds password hashes and saved credentials, so only BookOrbit's own user may read it. */
export const PRIVATE_FILE_MODE = 0o600;
/** Largest manifest we will read, so a crafted upload cannot ask for gigabytes of memory. */
const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  kind: BackupKind;
  appVersion: string;
  /** Content hashes of every migration the database had run, to refuse a backup from a newer version. */
  migrationHashes: string[];
  dataDirs: string[];
}

export interface CreateBackupOptions {
  databaseUrl: string;
  appDataPath: string;
  backupDir: string;
  kind: BackupKind;
  appVersion: string;
  migrationHashes: string[];
  now?: Date;
  onProgress?: (progress: BackupProgress) => void;
  progressIntervalMs?: number;
}

/** Resolves the folder backups live in: BACKUP_PATH, else a mounted /backups, else inside the app data folder. */
export function resolveBackupDir(appDataPath: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BACKUP_PATH?.trim();
  if (configured) return configured;
  try {
    if (statSync('/backups').isDirectory()) return '/backups';
  } catch {
    // Not mounted; fall back to the data folder.
  }
  return join(appDataPath, 'backups');
}

export type PgTool = 'pg_dump' | 'pg_restore' | 'psql';
const PG_TOOL_OVERRIDES: Record<PgTool, string> = { pg_dump: 'PG_DUMP_PATH', pg_restore: 'PG_RESTORE_PATH', psql: 'PSQL_PATH' };

/** The image's PostgreSQL 18 client tools, or whatever is on PATH. */
export function resolvePgTool(name: PgTool, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PG_TOOL_OVERRIDES[name]]?.trim();
  if (override) return override;
  const bundled = `/usr/libexec/postgresql18/${name}`;
  return existsSync(bundled) ? bundled : name;
}

/**
 * Splits the password out of a database URL, so it is handed to the tools through their environment
 * and never appears in the process list. Anything that is not a URL is passed through untouched.
 */
export function pgConnection(databaseUrl: string): { dbname: string; env: NodeJS.ProcessEnv } {
  try {
    const url = new URL(databaseUrl);
    if (!url.password) return { dbname: databaseUrl, env: {} };
    const password = decodeURIComponent(url.password);
    url.password = '';
    return { dbname: url.toString(), env: { PGPASSWORD: password } };
  } catch {
    return { dbname: databaseUrl, env: {} };
  }
}

function describeExit(name: string, code: number | null, stderr: string): Error {
  return new Error(`${name} exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`);
}

function collectStderr(child: ChildProcess): () => string {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < 8_000) stderr += chunk.toString();
  });
  return () => stderr;
}

export function runPgTool(name: PgTool, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePgTool(name), args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...env } });
    const stderr = collectStderr(child);
    child.once('error', (error) => reject(new Error(`${name} could not start: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(describeExit(name, code, stderr()));
    });
  });
}

/**
 * Replaces the whole database with a dump inside one transaction: the old schemas are dropped and
 * the dump loaded together, so a dump that fails to load leaves the database exactly as it was.
 * pg_restore turns the dump into SQL and psql runs it, since only psql can put the drop and the
 * load in the same transaction.
 */
export function replaceDatabaseFromDump(databaseUrl: string, dumpPath: string): Promise<void> {
  const connection = pgConnection(databaseUrl);
  return new Promise((resolve, reject) => {
    const restore = spawn(resolvePgTool('pg_restore'), ['--no-owner', '--no-privileges', '--file=-', dumpPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const psql = spawn(
      resolvePgTool('psql'),
      [
        '--no-psqlrc',
        '--quiet',
        '--single-transaction',
        '--set=ON_ERROR_STOP=1',
        '--command=DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
        '--file=-',
        `--dbname=${connection.dbname}`,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, ...connection.env } },
    );
    const restoreStderr = collectStderr(restore);
    const psqlStderr = collectStderr(psql);
    const exits: Partial<Record<'pg_restore' | 'psql', number | null>> = {};
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      restore.kill();
      psql.kill();
      reject(error);
    };
    const finish = () => {
      if (settled || !('pg_restore' in exits) || !('psql' in exits)) return;
      if (exits.pg_restore !== 0) return fail(describeExit('pg_restore', exits.pg_restore ?? null, restoreStderr()));
      if (exits.psql !== 0) return fail(describeExit('psql', exits.psql ?? null, psqlStderr()));
      settled = true;
      resolve();
    };
    restore.once('error', (error) => fail(new Error(`pg_restore could not start: ${error.message}`)));
    psql.once('error', (error) => fail(new Error(`psql could not start: ${error.message}`)));
    // psql stopping early closes the pipe under pg_restore; its own exit code carries the reason.
    psql.stdin.on('error', () => undefined);
    // psql commits when its input ends, so the input is only ended once pg_restore has succeeded:
    // a dump that stops halfway kills psql instead, and the open transaction is rolled back.
    restore.stdout.pipe(psql.stdin, { end: false });
    restore.once('close', (code) => {
      exits.pg_restore = code;
      if (code !== 0) return fail(describeExit('pg_restore', code, restoreStderr()));
      psql.stdin.end();
      finish();
    });
    psql.once('close', (code) => {
      exits.psql = code;
      if (code !== 0) return fail(describeExit('psql', code, psqlStderr()));
      finish();
    });
  });
}

export function backupFileName(createdAt: Date, kind: BackupKind): string {
  const stamp = createdAt
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[-:]/g, '');
  return `${BACKUP_PREFIX}${stamp}-${kind}.zip`;
}

/** Writes a complete backup beside its final name, then renames it in, so a half-written file is never listed. */
export async function createBackup(options: CreateBackupOptions): Promise<BackupInfo> {
  const createdAt = options.now ?? new Date();
  await mkdir(options.backupDir, { recursive: true });
  const name = backupFileName(createdAt, options.kind);
  const finalPath = join(options.backupDir, name);
  const partialPath = `${finalPath}.partial`;
  const dumpPath = join(options.backupDir, `.${name}.dump`);

  const report = options.onProgress ?? (() => undefined);
  const intervalMs = options.progressIntervalMs ?? BACKUP_PROGRESS_INTERVAL_MS;

  try {
    const connection = pgConnection(options.databaseUrl);
    const databaseStartedAt = Date.now();
    report({ step: 'database', phase: 'start' });
    await runPgTool(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpPath}`, `--dbname=${connection.dbname}`],
      connection.env,
    );
    await chmod(dumpPath, PRIVATE_FILE_MODE);
    const dumpBytes = (await stat(dumpPath)).size;
    report({ step: 'database', phase: 'end', durationMs: Date.now() - databaseStartedAt, bytes: dumpBytes });

    const dataDirs = BACKED_UP_DATA_DIRS.filter((dir) => isDirectory(join(options.appDataPath, dir)));
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: createdAt.toISOString(),
      kind: options.kind,
      appVersion: options.appVersion,
      migrationHashes: options.migrationHashes,
      dataDirs,
    };

    const filesStartedAt = Date.now();
    report({ step: 'files', phase: 'start', dirs: dataDirs });
    const found = await countFiles(dataDirs.map((dir) => join(options.appDataPath, dir)));
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const copied = { files: 0, bytes: 0 };
    let lastReportAt = filesStartedAt;
    archive.on('entry', (entry) => {
      if (entry.type !== 'file' || !entry.name.startsWith(DATA_ENTRY_PREFIX)) return;
      copied.files++;
      copied.bytes += entry.stats?.size ?? 0;
      const now = Date.now();
      if (now - lastReportAt < intervalMs) return;
      lastReportAt = now;
      report({
        step: 'files',
        phase: 'progress',
        durationMs: now - filesStartedAt,
        filesDone: copied.files,
        filesFound: found.files,
        bytesDone: copied.bytes,
        bytesFound: found.bytes,
      });
    });
    const done = pipeline(archive, createWriteStream(partialPath, { mode: PRIVATE_FILE_MODE }));
    archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_ENTRY });
    // The dump is already compressed, and so are the images; storing them avoids a second, slow pass.
    // The zip plugin reads `store` per entry even though the shared entry type does not list it.
    const dumpEntry = { name: DATABASE_ENTRY, store: true };
    const storedEntry = { store: true } as unknown as Parameters<typeof archive.directory>[2];
    archive.file(dumpPath, dumpEntry);
    for (const dir of dataDirs) {
      archive.directory(join(options.appDataPath, dir), `${DATA_ENTRY_PREFIX}${dir}`, storedEntry);
    }
    await archive.finalize();
    await done;
    report({ step: 'files', phase: 'end', durationMs: Date.now() - filesStartedAt, files: copied.files, bytes: copied.bytes });
    await rename(partialPath, finalPath);
    const size = (await stat(finalPath)).size;
    return { name, kind: options.kind, createdAt: manifest.createdAt, size, appVersion: options.appVersion };
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  } finally {
    await rm(dumpPath, { force: true });
  }
}

export async function readManifest(path: string): Promise<BackupManifest> {
  const directory = await unzipper.Open.file(path);
  const entry = directory.files.find((file) => file.path === MANIFEST_ENTRY);
  if (!entry) throw new Error('Not a BookOrbit backup: manifest.json is missing');
  if (entry.uncompressedSize > MAX_MANIFEST_BYTES) throw new Error('Not a BookOrbit backup: manifest.json is too large');
  const manifest = JSON.parse((await entry.buffer()).toString('utf8')) as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT || typeof manifest.formatVersion !== 'number') throw new Error('Not a BookOrbit backup');
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) throw new Error('This backup was made by a newer version of BookOrbit');
  if (!directory.files.some((file) => file.path === DATABASE_ENTRY)) throw new Error('This backup has no database in it');
  return manifest as BackupManifest;
}

export async function listBackups(backupDir: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await readdir(backupDir);
  } catch {
    return [];
  }
  const backups: BackupInfo[] = [];
  for (const name of names) {
    if (!isBackupFileName(name)) continue;
    const path = join(backupDir, name);
    try {
      const manifest = await readManifest(path);
      backups.push({ name, kind: manifest.kind, createdAt: manifest.createdAt, size: (await stat(path)).size, appVersion: manifest.appVersion });
    } catch {
      // An unreadable file is not offered for restore; it stays on disk for someone to look at.
    }
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Only our own names, so a path from a request can never reach outside the backup folder. */
export function isBackupFileName(name: string): boolean {
  return name === basename(name) && name.startsWith(BACKUP_PREFIX) && name.endsWith('.zip') && /^[A-Za-z0-9._-]+$/.test(name);
}

/** Streams one entry of a backup to disk. */
export async function extractEntry(zipPath: string, entryPath: string, targetPath: string): Promise<void> {
  const directory = await unzipper.Open.file(zipPath);
  const entry = directory.files.find((file) => file.path === entryPath);
  if (!entry) throw new Error(`Backup is missing ${entryPath}`);
  await pipeline(entry.stream(), createWriteStream(targetPath, { mode: PRIVATE_FILE_MODE }));
}

/**
 * Unpacks the data folders of a backup into `targetDir`, refusing any entry that would land outside
 * it. Returns the top-level folders found.
 */
export async function extractDataDirs(zipPath: string, targetDir: string): Promise<string[]> {
  const directory = await unzipper.Open.file(zipPath);
  const found = new Set<string>();
  for (const file of directory.files) {
    if (!file.path.startsWith(DATA_ENTRY_PREFIX) || file.type !== 'File') continue;
    const relative = file.path.slice(DATA_ENTRY_PREFIX.length);
    const parts = relative.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..') || !(BACKED_UP_DATA_DIRS as readonly string[]).includes(parts[0]))
      continue;
    found.add(parts[0]);
    const target = join(targetDir, ...parts);
    await mkdir(join(target, '..'), { recursive: true });
    await pipeline(file.stream(), createWriteStream(target));
  }
  return [...found];
}

export function openBackupStream(path: string) {
  return createReadStream(path);
}

async function countFiles(dirs: string[]): Promise<{ files: number; bytes: number }> {
  const total = { files: 0, bytes: 0 };
  const pending = [...dirs];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    for await (const entry of await opendir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        total.files++;
        total.bytes += (await stat(path)).size;
      }
    }
  }
  return total;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
