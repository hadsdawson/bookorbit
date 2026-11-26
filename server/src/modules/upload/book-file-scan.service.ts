import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BookFileScanResult } from '@bookorbit/types';
import { stat } from 'fs/promises';
import { basename } from 'path';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { ScannerService } from '../scanner/scanner.service';
import { BookFileScanRepository } from './book-file-scan.repository';

/** Fork. Rescans the folder of one book on request, so a file the book lost can be picked up again. */
@Injectable()
export class BookFileScanService {
  private readonly logger = new Logger(BookFileScanService.name);

  constructor(
    private readonly repo: BookFileScanRepository,
    private readonly libraryService: LibraryService,
    private readonly scanner: ScannerService,
  ) {}

  async scanBookFiles(bookId: number, user: RequestUser): Promise<BookFileScanResult> {
    const event = 'book.scan_files';
    const startedAt = Date.now();

    const book = await this.repo.findBook(bookId);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);

    await this.libraryService.verifyAccessLevel(user, book.libraryId, 'editor');

    this.logger.log(`[${event}] [start] bookId=${bookId} userId=${user.id} libraryId=${book.libraryId} - book file scan started`);

    try {
      const before = await this.repo.findFilePaths(bookId);
      const target = await this.scanTarget(book.folderPath, book.organizationMode, before);
      const status = await this.scanner.scanPathAndWait(target.type, target.path, book.libraryId);
      const after = await this.repo.findFilePaths(bookId);

      const addedFiles = [...after].filter((path) => !before.has(path)).map((path) => basename(path));
      const removedFiles = [...before].filter((path) => !after.has(path)).map((path) => basename(path));

      this.logger.log(
        `[${event}] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} status=${status} scanType=${target.type} added=${addedFiles.length} removed=${removedFiles.length} fileCount=${after.size} - book file scan completed`,
      );
      return { status, addedFiles, removedFiles, fileCount: after.size };
    } catch (err) {
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - book file scan failed`,
      );
      throw err;
    }
  }

  /**
   * A book with a folder of its own is scanned as that folder, which also reaches files in its
   * sub-folders. A book that is a single file (a loose file, or a one-file-per-book library) is
   * scanned through that file instead.
   */
  private async scanTarget(
    folderPath: string,
    organizationMode: string,
    knownPaths: Set<string>,
  ): Promise<{ type: 'book' | 'directory'; path: string }> {
    if (organizationMode !== 'book_per_file' && (await this.isDirectory(folderPath))) return { type: 'directory', path: folderPath };
    const filePath = knownPaths.has(folderPath) ? folderPath : ([...knownPaths][0] ?? folderPath);
    return { type: 'book', path: filePath };
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }
}
