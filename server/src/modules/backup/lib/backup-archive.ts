import { spawn } from 'child_process';
import { createReadStream, createWriteStream, existsSync, statSync } from 'fs';
import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { basename, join } from 'path';
import { pipeline } from 'stream/promises';
import { ZipArchive } from 'archiver';
import * as unzipper from 'unzipper';
import type { BackupInfo, BackupKind } from '@bookorbit/types';

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

/** pg_dump and pg_restore from the image's PostgreSQL 18 client, or whatever is on PATH. */
export function resolvePgTool(name: 'pg_dump' | 'pg_restore', env: NodeJS.ProcessEnv = process.env): string {
  const override = env[name === 'pg_dump' ? 'PG_DUMP_PATH' : 'PG_RESTORE_PATH']?.trim();
  if (override) return override;
  const bundled = `/usr/libexec/postgresql18/${name}`;
  return existsSync(bundled) ? bundled : name;
}

export function runPgTool(name: 'pg_dump' | 'pg_restore', args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePgTool(name), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString();
    });
    child.once('error', (error) => reject(new Error(`${name} could not start: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
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

  try {
    await runPgTool('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpPath}`, `--dbname=${options.databaseUrl}`]);

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

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const done = pipeline(archive, createWriteStream(partialPath));
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
  await pipeline(entry.stream(), createWriteStream(targetPath));
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

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
