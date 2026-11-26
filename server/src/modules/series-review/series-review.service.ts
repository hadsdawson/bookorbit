import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { SeriesReviewPage, SeriesReviewView, SeriesWaitingPage } from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import type { BookDetailDto } from '../book/dto/book-detail.dto';
import { LibraryService } from '../library/library.service';
import { ResolveWaitingSeriesDto } from './dto/resolve-waiting-series.dto';
import { SeriesReviewRepository } from './series-review.repository';

const SLOW_LIST_MS = 2000;

/** Fork. The Series check tool: series that look mixed, and books waiting for a series pick. */
@Injectable()
export class SeriesReviewService {
  private readonly logger = new Logger(SeriesReviewService.name);

  constructor(
    private readonly repo: SeriesReviewRepository,
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
  ) {}

  private assertWindow(page: number, size: number) {
    if (!isOffsetWithinLimit(page * size)) {
      throw new BadRequestException(`pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  private async scope(user: RequestUser) {
    const libraryIds = await this.libraryService.findEditableLibraryIds(user);
    return { libraryIds, contentFilters: user.isSuperuser ? undefined : user.contentFilters };
  }

  async findMixed(user: RequestUser, params: { view?: SeriesReviewView; page?: number; size?: number }): Promise<SeriesReviewPage> {
    const view = params.view ?? 'open';
    const page = params.page ?? 0;
    const size = params.size ?? 25;
    this.assertWindow(page, size);
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0) return { items: [], total: 0, page, size, counts: { open: 0, fine: 0 } };

    const startedAt = Date.now();
    const { items, counts } = await this.repo.findMixed(scope, { view, page, size });
    const ids = items.map((item) => item.id);
    const [authorsBySeries, coversBySeries] = await Promise.all([this.repo.findAuthors(ids, scope), this.repo.findCoverBookIds(ids, scope)]);
    const durationMs = Date.now() - startedAt;
    if (durationMs > SLOW_LIST_MS) {
      this.logger.warn(
        `[series_review.find_mixed] [end] userId=${user.id} view=${view} page=${page} durationMs=${durationMs} open=${counts.open} fine=${counts.fine} - slow mixed series list`,
      );
    }

    return {
      items: items.map((item) => {
        const names = authorsBySeries.get(item.id) ?? [];
        return {
          ...item,
          authors: names.slice(0, 3),
          moreAuthorCount: Math.max(0, names.length - 3),
          coverBookIds: coversBySeries.get(item.id) ?? [],
        };
      }),
      total: view === 'fine' ? counts.fine : counts.open,
      page,
      size,
      counts,
    };
  }

  async markFine(user: RequestUser, seriesId: number): Promise<void> {
    if (!(await this.repo.seriesExists(seriesId))) throw new NotFoundException('Series not found');
    await this.repo.markFine(seriesId, user.id);
  }

  async unmarkFine(user: RequestUser, seriesId: number): Promise<void> {
    if (!(await this.repo.seriesExists(seriesId))) throw new NotFoundException('Series not found');
    await this.repo.unmarkFine(seriesId);
  }

  async findWaiting(user: RequestUser, params: { page?: number; size?: number }): Promise<SeriesWaitingPage> {
    const page = params.page ?? 0;
    const size = params.size ?? 25;
    this.assertWindow(page, size);
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0) return { items: [], total: 0, page, size };

    const { items, total } = await this.repo.findWaiting(scope, { page, size });
    const authorsByBook = await this.repo.findBookAuthors([...new Set(items.map((item) => item.bookId))]);
    return { items: items.map((item) => ({ ...item, authors: authorsByBook.get(item.bookId) ?? [] })), total, page, size };
  }

  /** Saves the picked series for one waiting name through the normal metadata save, so locks, files and scores follow. */
  async resolveWaiting(user: RequestUser, dto: ResolveWaitingSeriesDto): Promise<BookDetailDto> {
    if ((dto.seriesId == null) === (dto.newSeries !== true)) throw new BadRequestException('Choose a series or ask for a new one');
    const event = 'series_review.resolve_waiting';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] bookId=${dto.bookId} userId=${user.id} displayOrder=${dto.displayOrder} newSeries=${dto.newSeries === true} - waiting series pick started`,
    );
    try {
      const detail = await this.bookService.getDetail(dto.bookId, user);
      const waiting = (detail.pendingSeries ?? []).find((entry) => entry.displayOrder === dto.displayOrder);
      if (!waiting) throw new NotFoundException('This series name is no longer waiting for a pick');

      const rows = [
        ...(detail.seriesMemberships ?? []).map((m) => ({
          order: m.displayOrder,
          input: { seriesName: m.seriesName, seriesIndex: m.seriesIndex ?? undefined, seriesId: m.seriesId },
        })),
        ...(detail.pendingSeries ?? []).map((p) => ({
          order: p.displayOrder,
          input:
            p.displayOrder === dto.displayOrder
              ? {
                  seriesName: p.seriesName,
                  seriesIndex: p.seriesIndex ?? undefined,
                  ...(dto.newSeries ? { newSeries: true } : { seriesId: dto.seriesId }),
                }
              : { seriesName: p.seriesName, seriesIndex: p.seriesIndex ?? undefined },
        })),
      ].sort((a, b) => a.order - b.order);

      const result = await this.bookService.updateMetadata(dto.bookId, { seriesMemberships: rows.map((row) => row.input) }, user);
      this.logger.log(
        `[${event}] [end] bookId=${dto.bookId} durationMs=${Date.now() - startedAt} stillWaiting=${result.book.pendingSeries?.length ?? 0} - waiting series pick completed`,
      );
      return result.book;
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${dto.bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - waiting series pick failed`,
      );
      throw err;
    }
  }
}
