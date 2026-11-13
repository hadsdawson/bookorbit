import { createHash } from 'crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';

/** Added to the name of a file BookOrbit did not write, kept beside it the first time it is replaced. */
export const ORIGINAL_SUFFIX = '.bak';

export type FolderFileWrite = 'unchanged' | 'written' | 'written-original-kept';

/** What BookOrbit last wrote for one book: file name to the content's hash. */
type Ledger = Record<string, string>;

/**
 * Writes the files BookOrbit keeps in a book's folder without losing anything it did not put there.
 * It remembers a hash of what it last wrote for each book. A file already in the folder whose content
 * is not what BookOrbit wrote, whether Audiobookshelf made it or a person edited it, is copied to
 * `<name>.bak` before it is replaced, once: an existing .bak is the oldest original and is kept.
 * Every write goes to a temporary file first and is renamed into place, so a crash never leaves a
 * half-written cover or metadata.json.
 */
export class FolderFileWriter {
  constructor(private readonly ledgerDir: string | null) {}

  /** The temporary and .bak paths a write may touch, so the library watcher can be told to ignore them. */
  static sidePaths(path: string): string[] {
    return [tempPath(path), `${path}${ORIGINAL_SUFFIX}`];
  }

  async write(bookId: number, files: readonly { path: string; bytes: Buffer }[]): Promise<Map<string, FolderFileWrite>> {
    const ledger = await this.readLedger(bookId);
    const outcomes = new Map<string, FolderFileWrite>();
    let ledgerChanged = false;
    for (const file of files) {
      const name = basename(file.path);
      const wanted = hash(file.bytes);
      const existing = await readFile(file.path).catch(() => null);
      const existingHash = existing ? hash(existing) : null;
      if (existingHash === wanted) {
        outcomes.set(file.path, 'unchanged');
      } else {
        const foreign = existingHash !== null && ledger[name] !== existingHash;
        const keptOriginal = foreign && (await keepOriginal(file.path));
        await writeAtomically(file.path, file.bytes);
        outcomes.set(file.path, keptOriginal ? 'written-original-kept' : 'written');
      }
      if (ledger[name] !== wanted) {
        ledger[name] = wanted;
        ledgerChanged = true;
      }
    }
    if (ledgerChanged) await this.writeLedger(bookId, ledger);
    return outcomes;
  }

  private ledgerPath(bookId: number): string | null {
    // Spread over subfolders so a library of tens of thousands of books never fills one directory.
    return this.ledgerDir ? join(this.ledgerDir, String(bookId % 1000), `${bookId}.json`) : null;
  }

  private async readLedger(bookId: number): Promise<Ledger> {
    const path = this.ledgerPath(bookId);
    if (!path) return {};
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    } catch {
      return {};
    }
  }

  private async writeLedger(bookId: number, ledger: Ledger): Promise<void> {
    const path = this.ledgerPath(bookId);
    if (!path) return;
    await mkdir(dirname(path), { recursive: true });
    await writeAtomically(path, Buffer.from(JSON.stringify(ledger)));
  }
}

/** Copies the file to its .bak name unless one is already there. Returns whether a copy was made. */
async function keepOriginal(path: string): Promise<boolean> {
  const original = `${path}${ORIGINAL_SUFFIX}`;
  if (await exists(original)) return false;
  await copyFile(path, original);
  return true;
}

async function writeAtomically(path: string, bytes: Buffer): Promise<void> {
  const temp = tempPath(path);
  try {
    await writeFile(temp, bytes);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function tempPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.bookorbit-tmp`);
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
