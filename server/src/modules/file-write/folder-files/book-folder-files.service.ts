import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { COVER_MEDIA, type CoverMedium, type FolderFilesEstimate, type FolderFilesStatus } from '@bookorbit/types';

import { SelfWriteRegistry } from '../../../common/services/self-write-registry.service';
import { mapWithConcurrency } from '../../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { BookCoverStore } from '../../book-cover-store/book-cover-store.service';
import { FileLockService, bookOperationLockKey } from '../file-lock.service';
import { FileWriteRepository } from '../file-write.repository';
import { buildAbsMetadata, folderCoverFiles, METADATA_JSON_NAME, readExplicitFlag } from './abs-metadata';
import { BookFolderFilesRepository } from './book-folder-files.repository';
import { FolderFileWriter } from './folder-file-writer';

export type FolderFilesOutcome = { status: 'written' | 'unchanged'; files: string[] } | { status: 'skipped'; reason: string };

const EVENT = 'book.folder_files';
const WRITE_ALL_EVENT = 'library.folder_files_write_all';
/** Edits often come in bursts (a form save, then a cover pick), so one write follows the last of them. */
const DEBOUNCE_MS = 3_000;
const MAX_CONCURRENT_WRITES = 2;
const WRITE_ALL_PAGE_SIZE = 200;
/** Rough per-book cost for the estimate: a cover or two read and re-encoded, a JSON file, a few queries. */
const ESTIMATE_SECONDS_PER_BOOK = { low: 0.05, high: 0.25 };

/**
 * Keeps each book's folder holding its cover images and an Audiobookshelf-style metadata.json, as
 * the library's settings ask. Runs after every change that already schedules a file write-back, and
 * once for a whole library when someone asks. Only books that own their folder are written: a book
 * sharing a folder with others has no file names it could claim without clashing.
 */
@Injectable()
export class BookFolderFilesService implements OnModuleDestroy {
  private readonly logger = new Logger(BookFolderFilesService.name);
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;
  private readonly runs = new Map<number, FolderFilesStatus>();
  private readonly writer: FolderFileWriter;

  constructor(
    private readonly repo: BookFolderFilesRepository,
    private readonly fileWriteRepo: FileWriteRepository,
    private readonly coverStore: BookCoverStore,
    private readonly lockService: FileLockService,
    private readonly selfWrites: SelfWriteRegistry,
    @Optional() config?: ConfigService,
  ) {
    const appDataPath = config?.get<string>('storage.appDataPath');
    this.writer = new FolderFileWriter(appDataPath ? join(appDataPath, 'folder-files') : null);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  schedule(bookId: number): void {
    const existing = this.timers.get(bookId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(bookId);
      void this.writeForBook(bookId).catch((error: unknown) => this.logFailure(bookId, Date.now(), error));
    }, DEBOUNCE_MS);
    this.timers.set(bookId, timer);
  }

  async writeForBook(bookId: number): Promise<FolderFilesOutcome> {
    await this.acquire();
    try {
      return await this.lockService.withLock(bookOperationLockKey(bookId), () => this.writeLocked(bookId));
    } finally {
      this.release();
    }
  }

  async estimate(libraryId: number): Promise<FolderFilesEstimate> {
    const { total, ownFolder } = await this.repo.countLibraryBooks(libraryId);
    return {
      books: ownFolder,
      sharedFolderBooks: total - ownFolder,
      estimatedSeconds: {
        low: Math.ceil((ownFolder * ESTIMATE_SECONDS_PER_BOOK.low) / MAX_CONCURRENT_WRITES),
        high: Math.ceil((ownFolder * ESTIMATE_SECONDS_PER_BOOK.high) / MAX_CONCURRENT_WRITES),
      },
    };
  }

  status(libraryId: number): FolderFilesStatus | null {
    return this.runs.get(libraryId) ?? null;
  }

  /** Starts writing every book in the library in the background; a run already going is left alone. */
  async startWriteAll(libraryId: number, userId: number): Promise<FolderFilesStatus> {
    const current = this.runs.get(libraryId);
    if (current?.running) return current;
    const { ownFolder } = await this.repo.countLibraryBooks(libraryId);
    const run: FolderFilesStatus = { running: true, total: ownFolder, processed: 0, written: 0, unchanged: 0, skipped: 0, failed: 0 };
    this.runs.set(libraryId, run);
    void this.writeAll(libraryId, userId, run);
    return run;
  }

  private async writeAll(libraryId: number, userId: number, run: FolderFilesStatus): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`[${WRITE_ALL_EVENT}] [start] libraryId=${libraryId} userId=${userId} books=${run.total} - writing folder files for the library`);
    try {
      let afterId = 0;
      for (;;) {
        const ids = await this.repo.listOwnFolderBookIds(libraryId, afterId, WRITE_ALL_PAGE_SIZE);
        if (ids.length === 0) break;
        afterId = ids[ids.length - 1];
        await mapWithConcurrency(ids, MAX_CONCURRENT_WRITES, async (bookId) => {
          try {
            const outcome = await this.writeForBook(bookId);
            if (outcome.status === 'written') run.written++;
            else if (outcome.status === 'unchanged') run.unchanged++;
            else run.skipped++;
          } catch (error: unknown) {
            run.failed++;
            this.logFailure(bookId, Date.now(), error);
          } finally {
            run.processed++;
          }
        });
      }
      this.logger.log(
        `[${WRITE_ALL_EVENT}] [end] libraryId=${libraryId} userId=${userId} durationMs=${Date.now() - startedAt} processed=${run.processed} written=${run.written} unchanged=${run.unchanged} skipped=${run.skipped} failed=${run.failed} - folder files written for the library`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `[${WRITE_ALL_EVENT}] [fail] libraryId=${libraryId} userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeLogValue(errorMessage(error))}" - folder files run stopped`,
      );
    } finally {
      run.running = false;
    }
  }

  private async writeLocked(bookId: number): Promise<FolderFilesOutcome> {
    const target = await this.repo.findTarget(bookId);
    if (!target) return { status: 'skipped', reason: 'book not found' };
    if (target.folderCovers === 'off' && !target.metadataJson) return { status: 'skipped', reason: 'disabled' };
    if (!target.ownsFolder) return { status: 'skipped', reason: 'shared folder' };
    if (!(await isDirectory(target.folderPath))) return { status: 'skipped', reason: 'folder missing' };

    const startedAt = Date.now();
    const files: { path: string; bytes: Buffer }[] = [];

    if (target.folderCovers !== 'off') {
      const paths = new Map<CoverMedium, string>();
      for (const medium of COVER_MEDIA) {
        const path = await this.coverStore.resolve(bookId, { medium, variant: 'cover', strict: true });
        if (path) paths.set(medium, path);
      }
      for (const { medium, name } of folderCoverFiles(target.folderCovers, new Set(paths.keys()))) {
        const bytes = await asJpeg(await readFile(paths.get(medium)!));
        if (bytes) files.push({ path: join(target.folderPath, name), bytes });
      }
    }

    if (target.metadataJson) {
      const payload = await this.fileWriteRepo.loadPayload(bookId);
      if (payload) {
        const chapterSource = await this.repo.findChapterSource(bookId);
        const metadataPath = join(target.folderPath, METADATA_JSON_NAME);
        const explicit = readExplicitFlag(await readFile(metadataPath, 'utf8').catch(() => null));
        const json = buildAbsMetadata({ ...payload, ...chapterSource, explicit });
        files.push({ path: metadataPath, bytes: Buffer.from(`${JSON.stringify(json, null, 2)}\n`) });
      }
    }

    // Belt and braces: the names above can never be a book format, but nothing is written over a
    // path BookOrbit knows as a book's own file, whatever changes later.
    const protectedPaths = await this.repo.findContentFilesAt(files.map((file) => file.path));
    for (const path of protectedPaths) {
      this.logger.warn(`[${EVENT}] [fail] bookId=${bookId} path="${sanitizeLogValue(path)}" - refused to overwrite a book file`);
    }
    const safeFiles = files.filter((file) => !protectedPaths.has(file.path));
    if (files.length > 0 && safeFiles.length === 0) return { status: 'skipped', reason: 'book file at target' };

    const written: string[] = [];
    await this.selfWrites.track(
      safeFiles.flatMap((file) => [file.path, ...FolderFileWriter.sidePaths(file.path)]),
      async () => {
        for (const [path, outcome] of await this.writer.write(bookId, safeFiles)) {
          if (outcome === 'unchanged') continue;
          written.push(path);
          if (outcome === 'written-original-kept') {
            this.logger.log(
              `[${EVENT}] [end] bookId=${bookId} path="${sanitizeLogValue(path)}" - a file BookOrbit did not write was kept as .bak before being replaced`,
            );
          }
        }
      },
    );

    if (written.length === 0) return { status: 'unchanged', files: safeFiles.map((file) => file.path) };
    this.logger.debug(`[${EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} written=${written.length} - folder files written`);
    return { status: 'written', files: written };
  }

  private logFailure(bookId: number, startedAt: number, error: unknown): void {
    this.logger.warn(
      `[${EVENT}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeLogValue(errorMessage(error))}" - folder files could not be written`,
    );
  }

  private async acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT_WRITES) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The folder file is named .jpg, so a stored PNG or WebP cover is re-encoded rather than mislabelled. */
async function asJpeg(bytes: Buffer): Promise<Buffer | null> {
  if (bytes.length === 0) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return bytes;
  return sharp(bytes, { failOn: 'error' }).jpeg({ quality: 90 }).toBuffer();
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
