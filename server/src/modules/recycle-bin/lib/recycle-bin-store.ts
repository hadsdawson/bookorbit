import { randomBytes } from 'crypto';
import { link, lstat, mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'path';
import { RECYCLE_BIN_ENTRY_KINDS, type RecycleBinEntryKind, type RecycleBinFile } from '@bookorbit/types';

/** Hidden, so the scanner and the folder watcher never see what is inside it. */
export const RECYCLE_BIN_DIR = '.bookorbit-recycle-bin';
const MANIFEST_FILE = 'manifest.json';
const FILES_DIR = 'files';
const ENTRY_ID_RE = /^(\d{15})-[0-9a-f]{8}$/;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export interface RecycleBinManifest {
  version: 1;
  id: string;
  kind: RecycleBinEntryKind;
  title: string | null;
  deletedAt: string;
  deletedBy: string | null;
  files: RecycleBinFile[];
}

export interface RecycleInput {
  kind: RecycleBinEntryKind;
  title: string | null;
  deletedBy: string | null;
  absolutePaths: string[];
}

export interface RestoreOutcome {
  restored: number;
  conflicts: string[];
  missing: string[];
}

/** Sorts by deletion time, so the newest entries are found without opening any manifest. */
export function newEntryId(now: Date): string {
  return `${String(now.getTime()).padStart(15, '0')}-${randomBytes(4).toString('hex')}`;
}

export function isEntryId(value: string): boolean {
  return ENTRY_ID_RE.test(value);
}

export function entryDeletedAtMs(id: string): number | null {
  const match = ENTRY_ID_RE.exec(id);
  return match ? Number(match[1]) : null;
}

/** A path that stays inside the folder it is joined to, or null. Manifests are files on disk and are not trusted. */
export function safeRelPath(relPath: unknown): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0') || isAbsolute(relPath)) return null;
  const normalized = normalize(relPath);
  if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${sep}`)) return null;
  return normalized;
}

function entryDir(libraryFolderPath: string, id: string): string {
  return join(libraryFolderPath, RECYCLE_BIN_DIR, id);
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return false;
    throw err;
  }
}

async function writeManifest(dir: string, manifest: RecycleBinManifest): Promise<void> {
  const tmp = join(dir, `.${MANIFEST_FILE}.tmp`);
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  await rename(tmp, join(dir, MANIFEST_FILE));
}

/**
 * Moves files into the library folder's recycle bin, keeping their place in the folder tree. The
 * manifest is written before anything moves, so an entry cut short can still be restored. A file
 * that is already gone is skipped, which lets a retried deletion finish.
 */
export async function moveToBin(libraryFolderPath: string, input: RecycleInput, now: Date = new Date()): Promise<{ id: string; moved: number }> {
  const sources = [...new Set(input.absolutePaths)].map((absolutePath) => {
    const relPath = safeRelPath(relative(libraryFolderPath, absolutePath));
    if (!relPath || relPath.split(sep)[0] === RECYCLE_BIN_DIR) throw new Error('File is outside its library folder');
    return { absolutePath, relPath };
  });

  const files: RecycleBinFile[] = [];
  const present: typeof sources = [];
  for (const source of sources) {
    try {
      const stats = await lstat(source.absolutePath);
      files.push({ relPath: source.relPath, sizeBytes: stats.size });
      present.push(source);
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') throw err;
    }
  }

  const id = newEntryId(now);
  if (present.length === 0) return { id, moved: 0 };

  const dir = entryDir(libraryFolderPath, id);
  await mkdir(join(dir, FILES_DIR), { recursive: true });
  await writeManifest(dir, {
    version: 1,
    id,
    kind: input.kind,
    title: input.title,
    deletedAt: now.toISOString(),
    deletedBy: input.deletedBy,
    files,
  });

  let moved = 0;
  for (const source of present) {
    const target = join(dir, FILES_DIR, source.relPath);
    await mkdir(dirname(target), { recursive: true });
    try {
      await rename(source.absolutePath, target);
      moved += 1;
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') throw err;
    }
  }
  return { id, moved };
}

export async function listEntryIds(libraryFolderPath: string): Promise<string[]> {
  try {
    const entries = await readdir(join(libraryFolderPath, RECYCLE_BIN_DIR), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && isEntryId(entry.name)).map((entry) => entry.name);
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || errorCode(err) === 'ENOTDIR') return [];
    throw err;
  }
}

export async function entryExists(libraryFolderPath: string, id: string): Promise<boolean> {
  return isEntryId(id) && exists(entryDir(libraryFolderPath, id));
}

/** The entry's manifest. One that cannot be read comes back with no files, so it can still be listed and deleted. */
export async function readManifest(libraryFolderPath: string, id: string): Promise<RecycleBinManifest> {
  const fallback: RecycleBinManifest = {
    version: 1,
    id,
    kind: 'book',
    title: null,
    deletedAt: new Date(entryDeletedAtMs(id) ?? 0).toISOString(),
    deletedBy: null,
    files: [],
  };
  try {
    const path = join(entryDir(libraryFolderPath, id), MANIFEST_FILE);
    if ((await lstat(path)).size > MAX_MANIFEST_BYTES) return fallback;
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<RecycleBinManifest> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    const files = Array.isArray(raw.files)
      ? raw.files.flatMap((file): RecycleBinFile[] => {
          const relPath = safeRelPath((file as RecycleBinFile | null)?.relPath);
          const size = (file as RecycleBinFile | null)?.sizeBytes;
          return relPath ? [{ relPath, sizeBytes: typeof size === 'number' && Number.isFinite(size) ? size : null }] : [];
        })
      : [];
    return {
      ...fallback,
      kind: (RECYCLE_BIN_ENTRY_KINDS as readonly string[]).includes(raw.kind as string) ? raw.kind! : 'book',
      title: typeof raw.title === 'string' ? raw.title : null,
      deletedBy: typeof raw.deletedBy === 'string' ? raw.deletedBy : null,
      files,
    };
  } catch {
    return fallback;
  }
}

/** Moves a file without ever replacing one that is already at the target. */
async function moveWithoutReplacing(source: string, target: string): Promise<'moved' | 'conflict'> {
  try {
    await link(source, target);
  } catch (err) {
    const code = errorCode(err);
    if (code === 'EEXIST') return 'conflict';
    if (code === 'ENOENT') throw err;
    // No hard links on this filesystem: check, then rename.
    if (await exists(target)) return 'conflict';
    await rename(source, target);
    return 'moved';
  }
  await unlink(source);
  return 'moved';
}

/**
 * Puts an entry's files back where they were. A file whose old path is taken stays in the bin and
 * is reported, and the entry is only removed once nothing is left in it.
 */
export async function restoreEntry(libraryFolderPath: string, id: string): Promise<RestoreOutcome> {
  const dir = entryDir(libraryFolderPath, id);
  const manifest = await readManifest(libraryFolderPath, id);
  const outcome: RestoreOutcome = { restored: 0, conflicts: [], missing: [] };
  const remaining: RecycleBinFile[] = [];

  for (const file of manifest.files) {
    const source = join(dir, FILES_DIR, file.relPath);
    const target = join(libraryFolderPath, file.relPath);
    if (!(await exists(source))) {
      outcome.missing.push(file.relPath);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    if ((await moveWithoutReplacing(source, target)) === 'moved') {
      outcome.restored += 1;
    } else {
      outcome.conflicts.push(file.relPath);
      remaining.push(file);
    }
  }

  if (remaining.length === 0) await deleteEntry(libraryFolderPath, id);
  else await writeManifest(dir, { ...manifest, files: remaining });
  return outcome;
}

export async function deleteEntry(libraryFolderPath: string, id: string): Promise<void> {
  if (!isEntryId(id)) return;
  await rm(entryDir(libraryFolderPath, id), { recursive: true, force: true });
  await rmdir(join(libraryFolderPath, RECYCLE_BIN_DIR)).catch(() => undefined);
}
