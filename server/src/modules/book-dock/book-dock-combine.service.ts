import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { extname } from 'path';
import { isAudioFormat } from '@bookorbit/types';
import type { BookDockCombineResult, BookDockFinalizeFileResult } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockRepository } from './book-dock.repository';
import type { CombineBookDockDto } from './dto';

/**
 * Files two or more docked files as one book: the primary file is filed as a new book, then every
 * other file is added to that book as another format, through the same join a person can pick by
 * hand for a single file. Nothing new about where files go or who may file them lives here.
 */
@Injectable()
export class BookDockCombineService {
  private readonly logger = new Logger(BookDockCombineService.name);

  constructor(
    private readonly finalizeService: BookDockFinalizeService,
    private readonly repo: BookDockRepository,
  ) {}

  async combine(dto: CombineBookDockDto, user: RequestUser, canManageAll: boolean): Promise<BookDockCombineResult> {
    const startedAt = Date.now();
    const fileIds = [...new Set(dto.fileIds)];
    if (fileIds.length < 2) throw new BadRequestException('Pick at least two files to combine');

    const rows = await this.repo.findByIds(fileIds, user.id, canManageAll);
    if (rows.length !== fileIds.length) throw new BadRequestException('Some of those files are no longer in Book Dock');

    const primaryFileId = this.pickPrimary(dto.primaryFileId, rows);
    const others = fileIds.filter((id) => id !== primaryFileId);
    this.logger.log(
      `[book_dock.combine] [start] userId=${user.id} primaryFileId=${primaryFileId} files=${fileIds.length} - combining docked files into one book`,
    );

    // Checked before anything moves: filing the primary file and then finding the rest cannot
    // join it would leave the book half combined.
    const preview = await this.finalizeService.previewFinalize(
      user.id,
      user.isSuperuser,
      canManageAll,
      [primaryFileId],
      false,
      undefined,
      dto.defaultLibraryId,
      dto.defaultFolderId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      user,
    );
    const primaryPreview = preview.items.find((item) => item.fileId === primaryFileId);
    if (!primaryPreview || primaryPreview.status !== 'ready') {
      throw new BadRequestException(primaryPreview?.message ?? 'The primary file cannot be filed as it is');
    }
    if (!primaryPreview.canJoinBook) {
      throw new BadRequestException('Combining files needs a library that keeps each book in its own folder');
    }

    const primary = await this.finalizeService.finalize(
      user.id,
      user.isSuperuser,
      canManageAll,
      [primaryFileId],
      false,
      undefined,
      dto.defaultLibraryId,
      dto.defaultFolderId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      user,
    );
    const primaryResult = primary.results.find((result) => result.fileId === primaryFileId);
    const bookId = primaryResult?.success ? primaryResult.bookId : undefined;
    if (bookId === undefined) {
      this.logger.warn(
        `[book_dock.combine] [fail] userId=${user.id} primaryFileId=${primaryFileId} durationMs=${Date.now() - startedAt} errorClass=FinalizeFailed error="${sanitizeLogValue(primaryResult?.message ?? 'not filed')}" - the primary file could not be filed, nothing was combined`,
      );
      return { ...primary, primaryFileId };
    }

    const rest = await this.finalizeService.finalize(
      user.id,
      user.isSuperuser,
      canManageAll,
      others,
      false,
      undefined,
      dto.defaultLibraryId,
      dto.defaultFolderId,
      others.map((fileId) => ({ fileId, joinBook: { bookId } })),
      undefined,
      undefined,
      undefined,
      undefined,
      user,
    );

    const results: BookDockFinalizeFileResult[] = [...primary.results, ...rest.results];
    const succeeded = results.filter((result) => result.success).length;
    this.logger.log(
      `[book_dock.combine] [end] userId=${user.id} primaryFileId=${primaryFileId} bookId=${bookId} durationMs=${Date.now() - startedAt} succeeded=${succeeded} failed=${results.length - succeeded} - docked files combined`,
    );
    return { total: results.length, succeeded, failed: results.length - succeeded, results, bookId, primaryFileId };
  }

  /** The book's details come from the primary file, so an ebook is preferred: it usually carries the fuller metadata. */
  private pickPrimary(requested: number | undefined, rows: Array<{ id: number; fileName: string }>): number {
    if (requested !== undefined) {
      if (!rows.some((row) => row.id === requested)) throw new BadRequestException('The primary file must be one of the files being combined');
      return requested;
    }
    const ebook = rows.find((row) => {
      const extension = extname(row.fileName).slice(1);
      return extension !== '' && !isAudioFormat(extension);
    });
    return (ebook ?? rows[0]!).id;
  }
}
