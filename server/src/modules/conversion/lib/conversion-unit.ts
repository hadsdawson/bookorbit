import type { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

import { isConvertible } from './conversion-media';

const MAX_DEPTH = 6;
const MAX_ENTRIES = 5_000;

/** One thing dropped at the top of the Convert folder: a single file, or a folder for one book. */
export interface ConversionUnit {
  /** The file or folder in the Convert folder. */
  path: string;
  isDirectory: boolean;
  /** Audio files found, in name order. */
  audioFiles: string[];
  /** Everything else in a folder (cover art, metadata.json), carried along with the M4B. */
  extraFiles: string[];
  /** Every file in the unit, which is what goes to the recycle bin afterwards. */
  allFiles: string[];
  /** Changes when anything in the unit changes, so an edited unit is looked at again. */
  signature: string;
}

/** Hidden files and folders are never part of a unit: the recycle bin and work folder live there. */
export function isHidden(name: string): boolean {
  return name.startsWith('.') || name.toLowerCase() === '@eadir';
}

export async function readUnit(path: string): Promise<ConversionUnit | null> {
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  if (info.isFile()) {
    return {
      path,
      isDirectory: false,
      audioFiles: isConvertible(path) ? [path] : [],
      extraFiles: [],
      allFiles: [path],
      signature: `${info.size}:${info.mtimeMs}`,
    };
  }
  if (!info.isDirectory()) return null;

  const files: { path: string; size: number; mtimeMs: number }[] = [];
  await walk(path, 0, files);
  files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const audioFiles = files.filter((file) => isConvertible(file.path)).map((file) => file.path);
  return {
    path,
    isDirectory: true,
    audioFiles,
    extraFiles: files.filter((file) => !isConvertible(file.path)).map((file) => file.path),
    allFiles: files.map((file) => file.path),
    signature: files.map((file) => `${file.path}:${file.size}:${file.mtimeMs}`).join('|'),
  };
}

async function walk(directory: string, depth: number, files: { path: string; size: number; mtimeMs: number }[]): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_ENTRIES) return;
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (isHidden(entry.name) || files.length >= MAX_ENTRIES) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(full, depth + 1, files);
    } else if (entry.isFile()) {
      const info = await stat(full).catch(() => null);
      if (info) files.push({ path: full, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
}
