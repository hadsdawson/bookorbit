import { createHash, type Hash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, open, readdir, rename as fsRename, rm, rmdir, stat, unlink } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'path';
import { Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { Logger } from '@nestjs/common';

import { sanitizeLogValue } from './log-sanitize.utils';

export const MAX_PATH_LENGTH = 4096;

export interface MovedFileStat {
  ino: bigint;
  sizeBytes: number;
  mtime: Date;
}

export interface MoveFileOutcome {
  crossDevice: boolean;
  stat: MovedFileStat;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

export function isCrossDeviceError(error: unknown): boolean {
  return errorCode(error) === 'EXDEV';
}

export function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

/**
 * True when `candidate` resolves inside `root`. Mirrors the containment idiom used
 * by the path policy and rename services: purely lexical, so callers that accept
 * user-supplied roots must also canonicalize symlinks separately.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(normalize(root), normalize(candidate));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Full-content hash. Deliberately not the scanner's sampled hash: this verifies copies. */
export async function computeContentHash(absolutePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(absolutePath), hashSink(hash));
  return hash.digest('hex');
}

function hashSink(hash: Hash): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  });
}

/** Called with the bytes copied so far while a file crosses filesystems. */
export type CopyProgress = (copiedBytes: number) => void;

async function copyWithSourceHash(from: string, to: string, onProgress?: CopyProgress): Promise<{ hash: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(
    createReadStream(from),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        hash.update(chunk);
        bytes += chunk.length;
        onProgress?.(bytes);
        yield chunk;
      }
    },
    createWriteStream(to),
  );
  return { hash: hash.digest('hex'), bytes };
}

/** Flush the destination to disk so the source can be unlinked without risking the only copy. */
async function fsyncPath(absolutePath: string): Promise<void> {
  const handle = await open(absolutePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function statMoved(absolutePath: string): Promise<MovedFileStat> {
  const info = await stat(absolutePath, { bigint: true });
  return {
    ino: info.ino,
    sizeBytes: Number(info.size),
    mtime: new Date(Number(info.mtimeMs)),
  };
}

/**
 * Copies across filesystems and proves the copy before anyone may unlink the source: the source
 * must keep its size and mtime for the whole copy, the destination must hash to the bytes read, and
 * the destination is flushed to disk. Any failure removes the partial destination and leaves the
 * source untouched.
 */
async function copyVerified(from: string, to: string, onProgress?: CopyProgress): Promise<void> {
  const before = await stat(from, { bigint: true });
  try {
    const copied = await copyWithSourceHash(from, to, onProgress);
    const after = await stat(from, { bigint: true });
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || BigInt(copied.bytes) !== before.size) {
      throw new Error(`Copy verification failed: source changed during the copy of ${from}`);
    }
    const destinationHash = await computeContentHash(to);
    if (destinationHash !== copied.hash) {
      throw new Error(`Copy verification failed: destination hash does not match source for ${from}`);
    }
    await fsyncPath(to);
  } catch (error) {
    await unlink(to).catch(() => {});
    throw error;
  }
}

/**
 * Moves one file, preferring `rename` so the inode (and therefore the scanner's move
 * detection) is preserved. Falls back to a verified copy + unlink when the destination
 * lives on another filesystem, which mergerfs and multi-volume setups hit routinely.
 */
export async function moveFile(from: string, to: string, onProgress?: CopyProgress): Promise<MoveFileOutcome> {
  await mkdir(dirname(to), { recursive: true });

  try {
    await fsRename(from, to);
    return { crossDevice: false, stat: await statMoved(to) };
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
  }

  await copyVerified(from, to, onProgress);
  const movedStat = await statMoved(to);
  await unlink(from);
  return { crossDevice: true, stat: movedStat };
}

/** Restores a file to its original location during rollback, with the same verified copy as `moveFile`. */
export async function moveFileBack(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await fsRename(from, to);
    return;
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
  }
  await copyVerified(from, to);
  await unlink(from);
}

const cleanupLogger = new Logger('FileCleanup');

/** Files the operating system or NAS leaves in folders on its own. They never make a folder worth keeping. */
const SYSTEM_JUNK_FILES = new Set(['.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', '.directory']);
/** Synology's and QNAP's thumbnail caches, which they recreate whenever they need them. */
const SYSTEM_JUNK_DIRECTORIES = new Set(['@eadir', '.@__thumb']);

/** macOS writes `._name` alongside a file on network shares to hold its extra attributes. */
function isSystemJunk(name: string, isDirectory: boolean): boolean {
  const lower = name.toLowerCase();
  if (isDirectory) return SYSTEM_JUNK_DIRECTORIES.has(lower);
  return SYSTEM_JUNK_FILES.has(lower) || lower.startsWith('._');
}

/**
 * Removes a folder a move left empty, then each parent it leaves empty, up to but never including
 * `stopAtRoot`. A folder holding only system leftovers (.DS_Store, Thumbs.db, Synology's @eaDir and
 * the like) counts as empty and they are cleared with it. Anything else, even one stray file, keeps
 * the folder and stops the climb, so nothing a person put there is ever deleted.
 */
export async function removeEmptyDirs(directory: string, stopAtRoot: string): Promise<string[]> {
  const removed: string[] = [];
  let current = normalize(directory);
  while (isInsideRoot(stopAtRoot, current)) {
    try {
      const entries = await readdir(current, { withFileTypes: true });
      if (!entries.every((entry) => (entry.isFile() || entry.isDirectory()) && isSystemJunk(entry.name, entry.isDirectory()))) break;
      for (const entry of entries) {
        await rm(join(current, entry.name), { recursive: entry.isDirectory(), force: true });
      }
      await rmdir(current);
      removed.push(current);
      cleanupLogger.log(
        `[files.remove_empty_dir] [end] path="${sanitizeLogValue(current)}" systemFilesCleared=${entries.length} - empty folder removed`,
      );
    } catch {
      break;
    }
    current = dirname(current);
  }
  return removed;
}

/**
 * Every path a move touches, for `SelfWriteRegistry`. Unlike the rename service's builder this
 * spans several library roots, since a cross-library move or a cross-root merge writes under each.
 * Ancestor directories are included because directory events are watched too.
 */
export function buildSuppressionPaths(input: {
  sourcePaths: string[];
  targetPaths: string[];
  sourceFolderPath: string;
  targetFolderPath: string;
  roots: string[];
}): string[] {
  const paths = new Set<string>();
  const roots = input.roots.map((root) => normalize(root));

  const addWithAncestors = (rawPath: string): void => {
    const owningRoot = roots.find((root) => isInsideRoot(root, rawPath));
    if (!owningRoot) return;

    let current = normalize(rawPath);
    while (isInsideRoot(owningRoot, current)) {
      paths.add(current);
      current = dirname(current);
    }
  };

  for (const path of [...input.sourcePaths, ...input.targetPaths, input.sourceFolderPath, input.targetFolderPath]) {
    addWithAncestors(path);
  }

  return [...paths];
}

/**
 * Appends a numeric suffix to the last path segment, before the extension when one
 * is given. Used to resolve destination collisions under the "keep both" policy.
 */
export function withCollisionSuffix(absolutePath: string, attempt: number, extension: string): string {
  const directory = dirname(absolutePath);
  const base = absolutePath.slice(directory.length + 1);
  const hasExtension = extension.length > 0 && base.toLowerCase().endsWith(extension.toLowerCase());
  const splitAt = hasExtension ? base.length - extension.length : base.length;
  // Keep the original casing of the extension: on a case-sensitive filesystem
  // rewriting it would change which file the path refers to.
  return join(directory, `${base.slice(0, splitAt)} (${attempt})${base.slice(splitAt)}`);
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}
