import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, like, or, sql, type AnyColumn } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, libraryDirScanState, libraryFolders } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface RelocationFileRow {
  id: number;
  absolutePath: string;
  sizeBytes: number | null;
  mtime: Date | null;
}

export interface RelocationCounts {
  bookCount: number;
  fileCount: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function underPrefix(column: AnyColumn, prefix: string) {
  return or(eq(column, prefix), like(column, `${escapeLike(prefix)}/%`));
}

@Injectable()
export class LibraryFolderRelocationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findFolder(libraryId: number, folderId: number) {
    const [folder] = await this.db
      .select()
      .from(libraryFolders)
      .where(and(eq(libraryFolders.id, folderId), eq(libraryFolders.libraryId, libraryId)));
    return folder;
  }

  async countFolder(folderId: number): Promise<RelocationCounts> {
    const [bookRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(books)
      .where(eq(books.libraryFolderId, folderId));
    const [fileRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookFiles)
      .where(eq(bookFiles.libraryFolderId, folderId));
    return { bookCount: bookRow?.count ?? 0, fileCount: fileRow?.count ?? 0 };
  }

  findFilesPage(folderId: number, afterId: number, limit: number): Promise<RelocationFileRow[]> {
    return this.db
      .select({ id: bookFiles.id, absolutePath: bookFiles.absolutePath, sizeBytes: bookFiles.sizeBytes, mtime: bookFiles.mtime })
      .from(bookFiles)
      .where(and(eq(bookFiles.libraryFolderId, folderId), gt(bookFiles.id, afterId)))
      .orderBy(asc(bookFiles.id))
      .limit(limit);
  }

  async countFilesUnderPath(path: string, excludeFolderId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookFiles)
      .where(and(underPrefix(bookFiles.absolutePath, path), sql`${bookFiles.libraryFolderId} <> ${excludeFolderId}`));
    return row?.count ?? 0;
  }

  relocate(folderId: number, oldPath: string, newPath: string): Promise<RelocationCounts> {
    return this.db.transaction(async (tx) => {
      const rewrite = (column: AnyColumn) => sql`${newPath} || substr(${column}, ${oldPath.length + 1})`;

      const movedBooks = await tx
        .update(books)
        .set({ folderPath: rewrite(books.folderPath), updatedAt: sql`${books.updatedAt}` })
        .where(and(eq(books.libraryFolderId, folderId), underPrefix(books.folderPath, oldPath)))
        .returning({ id: books.id });
      const movedFiles = await tx
        .update(bookFiles)
        .set({ absolutePath: rewrite(bookFiles.absolutePath), updatedAt: sql`${bookFiles.updatedAt}` })
        .where(and(eq(bookFiles.libraryFolderId, folderId), underPrefix(bookFiles.absolutePath, oldPath)))
        .returning({ id: bookFiles.id });
      await tx
        .update(libraryDirScanState)
        .set({ dirPath: rewrite(libraryDirScanState.dirPath) })
        .where(and(eq(libraryDirScanState.libraryFolderId, folderId), underPrefix(libraryDirScanState.dirPath, oldPath)));
      await tx.update(libraryFolders).set({ path: newPath }).where(eq(libraryFolders.id, folderId));

      return { bookCount: movedBooks.length, fileCount: movedFiles.length };
    });
  }
}
