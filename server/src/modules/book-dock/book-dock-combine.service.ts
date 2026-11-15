import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { extname } from 'path';
import { DEFAULT_FORMAT_PRIORITY, pickByFormatPriority } from '@bookorbit/types';
import type { BookDockCombineResult, BookDockFinalizeFileResult } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockRepository } from './book-dock.repository';
import type { CombineBookDockDto } from './dto';

/**
 * What stops a file being filed whether it joins a book or stands alone. A name clash or a duplicate
 * found for a file on its own says nothing about joining, so those are left to the filing itself.
 */
const BLOCKING_PREVIEW_STATUSES: ReadonlySet<string> = new Set([
  'missing_destination',
  'unsupported_layout',
  'invalid_target',
  'invalid_format',
  'access_denied',
  'error',
]);

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
    private readonly libraries: LibraryService,
  ) {}

  async combine(dto: CombineBookDockDto, user: RequestUser, canManageAll: boolean): Promise<BookDockCombineResult> {
    const startedAt = Date.now();
    const fileIds = [...new Set(dto.fileIds)];
    if (fileIds.length < 2) throw new BadRequestException('Pick at least two files to combine');

    const rows = await this.repo.findByIds(fileIds, user.id, canManageAll);
    if (rows.length !== fileIds.length) throw new BadRequestException('Some of those files are no longer in Book Dock');

    const primaryFileId = await this.pickPrimary(dto.primaryFileId, rows, dto.defaultLibraryId);
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
      [primaryFileId, ...others],
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
    for (const fileId of others) {
      const item = preview.items.find((candidate) => candidate.fileId === fileId);
      const name = rows.find((row) => row.id === fileId)?.fileName ?? `file ${fileId}`;
      if (!item || BLOCKING_PREVIEW_STATUSES.has(item.status)) {
        throw new BadRequestException(`${name} cannot be filed as it is, so nothing was combined${item?.message ? `: ${item.message}` : ''}`);
      }
      if (!item.canJoinBook) {
        throw new BadRequestException(`${name} goes to a library that cannot hold it in the same book, so nothing was combined`);
      }
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

  /**
   * Fork: holds docked files together as one item without filing them. The list then shows only
   * the main file; its details are the book's, and filing it files the rest into the same book.
   * Merging an item that is already merged takes in all its files.
   */
  async merge(dto: CombineBookDockDto, user: RequestUser, canManageAll: boolean): Promise<{ primaryFileId: number; fileIds: number[] }> {
    const startedAt = Date.now();
    const fileIds = [...new Set(dto.fileIds)];
    if (fileIds.length < 2) throw new BadRequestException('Pick at least two files to merge');
    const rows = await this.repo.findByIds(fileIds, user.id, canManageAll);
    if (rows.length !== fileIds.length) throw new BadRequestException('Some of those files are no longer in Book Dock');

    const primaryFileId = await this.pickPrimary(dto.primaryFileId, rows, dto.defaultLibraryId);
    if (dto.defaultLibraryId !== undefined && dto.defaultFolderId !== undefined) {
      const primary = rows.find((row) => row.id === primaryFileId);
      if (primary && primary.targetFolderId === null) {
        await this.repo.update(primaryFileId, { targetLibraryId: dto.defaultLibraryId, targetFolderId: dto.defaultFolderId });
      }
    }
    await this.repo.setMergeGroup(primaryFileId, fileIds);
    const members = (await this.repo.findMergedMembers([primaryFileId])).get(primaryFileId) ?? [];
    this.finalizeService.announceChange();
    this.logger.log(
      `[book_dock.merge] [end] userId=${user.id} primaryFileId=${primaryFileId} durationMs=${Date.now() - startedAt} files=${members.length + 1} - docked files merged, held in Book Dock`,
    );
    return { primaryFileId, fileIds: [primaryFileId, ...members.map((member) => member.id)] };
  }

  /** Fork: splits a merged item back into its separate files, all still in Book Dock. */
  async unmerge(fileId: number, user: RequestUser, canManageAll: boolean): Promise<{ fileIds: number[] }> {
    const [row] = await this.repo.findByIds([fileId], user.id, canManageAll);
    if (!row) throw new NotFoundException('Book Dock file not found');
    const primaryId = row.mergedIntoId ?? row.id;
    const members = (await this.repo.findMergedMembers([primaryId])).get(primaryId) ?? [];
    await this.repo.clearMergeGroup(primaryId);
    this.finalizeService.announceChange();
    this.logger.log(`[book_dock.unmerge] [end] userId=${user.id} primaryFileId=${primaryId} files=${members.length + 1} - merged item split`);
    return { fileIds: [primaryId, ...members.map((member) => member.id)] };
  }

  /**
   * The file the book is filed from: the one picked, else the one whose format ranks highest in
   * the destination library's format priority, which is the same order the library uses to choose
   * a book's main file.
   */
  private async pickPrimary(
    requested: number | undefined,
    rows: Array<{ id: number; fileName: string; targetLibraryId: number | null }>,
    defaultLibraryId: number | undefined,
  ): Promise<number> {
    if (requested !== undefined) {
      if (!rows.some((row) => row.id === requested)) throw new BadRequestException('The primary file must be one of the files being combined');
      return requested;
    }
    const libraryId = rows.find((row) => row.targetLibraryId !== null)?.targetLibraryId ?? defaultLibraryId;
    const priority = libraryId !== undefined ? await this.formatPriorityOf(libraryId) : DEFAULT_FORMAT_PRIORITY;
    return (pickByFormatPriority(rows, (row) => extname(row.fileName).slice(1), priority) ?? rows[0]!).id;
  }

  private async formatPriorityOf(libraryId: number): Promise<readonly string[]> {
    try {
      return (await this.libraries.findOne(libraryId)).formatPriority;
    } catch {
      return DEFAULT_FORMAT_PRIORITY;
    }
  }
}
