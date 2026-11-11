import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AudiobookChapter, FolderCoverMedia } from '@bookorbit/types';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { bookFiles, bookMetadata, books, libraries } from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface FolderFilesTarget {
  bookId: number;
  libraryId: number;
  folderPath: string;
  primaryPath: string | null;
  folderCovers: FolderCoverMedia;
  metadataJson: boolean;
}

/**
 * A book owns its folder when its files sit inside its folder path. A book sharing a folder with
 * other books is keyed by its file path (or folder plus file stem) instead, so its files sit beside
 * that key rather than under it.
 */
const ownsFolder = sql`exists (
  select 1 from ${bookFiles}
  where ${bookFiles.bookId} = ${books.id}
    and left(${bookFiles.absolutePath}, length(${books.folderPath}) + 1) = ${books.folderPath} || '/'
)`;

@Injectable()
export class BookFolderFilesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findTarget(bookId: number): Promise<(FolderFilesTarget & { ownsFolder: boolean }) | null> {
    const [row] = await this.db
      .select({
        bookId: books.id,
        libraryId: books.libraryId,
        folderPath: books.folderPath,
        primaryPath: bookFiles.absolutePath,
        folderCovers: libraries.fileWriteFolderCovers,
        metadataJson: libraries.fileWriteMetadataJson,
        ownsFolder: sql<boolean>`${ownsFolder}`,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(and(eq(books.id, bookId), ne(books.status, 'missing')))
      .limit(1);
    return row ?? null;
  }

  async findChapterSource(bookId: number): Promise<{ chapters: AudiobookChapter[]; durationSeconds: number | null; abridged: boolean }> {
    const [meta] = await this.db
      .select({ chapters: bookMetadata.chapters, durationSeconds: bookMetadata.durationSeconds, abridged: bookMetadata.abridged })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    const chapters = parseChapters(meta?.chapters);
    let durationSeconds = meta?.durationSeconds ?? null;
    if (durationSeconds === null && chapters.length > 0) {
      const [total] = await this.db
        .select({ seconds: sql<number | null>`sum(${bookFiles.durationSeconds})::int` })
        .from(bookFiles)
        .where(and(eq(bookFiles.bookId, bookId), inArray(bookFiles.role, ['content', 'primary'])));
      durationSeconds = total?.seconds ?? null;
    }
    return { chapters, durationSeconds, abridged: meta?.abridged ?? false };
  }

  async countLibraryBooks(libraryId: number): Promise<{ total: number; ownFolder: number }> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        ownFolder: sql<number>`count(*) filter (where ${ownsFolder})::int`,
      })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), ne(books.status, 'missing')));
    return { total: row?.total ?? 0, ownFolder: row?.ownFolder ?? 0 };
  }

  /**
   * Which of these paths are a book's own content file, in any library. Compared without case so a
   * case-insensitive share cannot slip one past.
   */
  async findContentFilesAt(paths: readonly string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set();
    const lowered = paths.map((path) => path.toLowerCase());
    const rows = await this.db
      .select({ path: bookFiles.absolutePath })
      .from(bookFiles)
      .where(and(eq(bookFiles.role, 'content'), inArray(sql`lower(${bookFiles.absolutePath})`, lowered)));
    const hits = new Set(rows.map((row) => row.path.toLowerCase()));
    return new Set(paths.filter((path) => hits.has(path.toLowerCase())));
  }

  /** One page of a library's books that own their folder, in id order, for the write-all run. */
  async listOwnFolderBookIds(libraryId: number, afterId: number, limit: number): Promise<number[]> {
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), ne(books.status, 'missing'), gt(books.id, afterId), ownsFolder))
      .orderBy(asc(books.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}

function parseChapters(value: unknown): AudiobookChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const { title, startMs } = entry as { title?: unknown; startMs?: unknown };
    if (typeof title !== 'string' || typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) return [];
    return [{ title, startMs }];
  });
}
