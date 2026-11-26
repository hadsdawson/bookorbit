import { BadRequestException, NotFoundException } from '@nestjs/common';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { SeriesReviewService } from './series-review.service';

const user: RequestUser = { id: 7, username: 'u', isSuperuser: false, permissions: [], contentFilters: EMPTY_CONTENT_FILTER_RULES };

function makeService(editableLibraryIds = [1]) {
  const repo = {
    findMixed: vi.fn().mockResolvedValue({
      items: [{ id: 3, name: 'Wisdom', bookCount: 4, reasons: ['repeatedNumber'], repeatedNumbers: ['1'], markedFine: false }],
      counts: { open: 1, fine: 2 },
    }),
    findAuthors: vi.fn().mockResolvedValue(new Map([[3, ['A', 'B', 'C', 'D']]])),
    findCoverBookIds: vi.fn().mockResolvedValue(new Map([[3, [30, 31]]])),
    seriesExists: vi.fn().mockResolvedValue(true),
    markFine: vi.fn().mockResolvedValue(undefined),
    unmarkFine: vi.fn().mockResolvedValue(undefined),
    findWaiting: vi.fn().mockResolvedValue({
      items: [{ bookId: 5, title: 'T', seriesName: 'Wisdom', seriesIndex: '2', displayOrder: 0 }],
      total: 1,
    }),
    findBookAuthors: vi.fn().mockResolvedValue(new Map([[5, ['Weaver']]])),
  };
  const libraryService = { findEditableLibraryIds: vi.fn().mockResolvedValue(editableLibraryIds) };
  const bookService = {
    getDetail: vi.fn(),
    updateMetadata: vi.fn().mockResolvedValue({ book: { id: 5, pendingSeries: [] } }),
  };
  const service = new SeriesReviewService(repo as never, libraryService as never, bookService as never);
  return { service, repo, libraryService, bookService };
}

describe('SeriesReviewService', () => {
  it('lists mixed series in editable libraries with their authors and covers', async () => {
    const { service, repo } = makeService();

    const page = await service.findMixed(user, { view: 'open' });

    expect(repo.findMixed).toHaveBeenCalledWith({ libraryIds: [1], contentFilters: user.contentFilters }, { view: 'open', page: 0, size: 25 });
    expect(page.items[0]).toMatchObject({ id: 3, authors: ['A', 'B', 'C'], moreAuthorCount: 1, coverBookIds: [30, 31] });
    expect(page.total).toBe(1);
    expect(page.counts).toEqual({ open: 1, fine: 2 });
  });

  it('reports the marked-fine total for that view', async () => {
    const { service } = makeService();
    expect((await service.findMixed(user, { view: 'fine' })).total).toBe(2);
  });

  it('returns an empty list without editable libraries', async () => {
    const { service, repo } = makeService([]);
    const page = await service.findMixed(user, {});
    expect(page.items).toEqual([]);
    expect(repo.findMixed).not.toHaveBeenCalled();
    expect((await service.findWaiting(user, {})).items).toEqual([]);
  });

  it('marks and unmarks a series as fine, and 404s on a missing one', async () => {
    const { service, repo } = makeService();
    await service.markFine(user, 3);
    await service.unmarkFine(user, 3);
    expect(repo.markFine).toHaveBeenCalledWith(3, 7);
    expect(repo.unmarkFine).toHaveBeenCalledWith(3);

    repo.seriesExists.mockResolvedValue(false);
    await expect(service.markFine(user, 99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists waiting books with their authors', async () => {
    const { service } = makeService();
    const page = await service.findWaiting(user, { page: 0, size: 10 });
    expect(page.items).toEqual([{ bookId: 5, title: 'T', seriesName: 'Wisdom', seriesIndex: '2', displayOrder: 0, authors: ['Weaver'] }]);
  });

  describe('resolveWaiting', () => {
    const detail = {
      id: 5,
      seriesMemberships: [{ seriesId: 8, seriesName: 'Cosmere', seriesIndex: null, displayOrder: 1, expectedBookCount: 12 }],
      pendingSeries: [
        { seriesName: 'Wisdom', seriesIndex: '2', displayOrder: 0 },
        { seriesName: 'Shared', seriesIndex: null, displayOrder: 2 },
      ],
    };

    it('saves every series in order with the pick on the chosen name only', async () => {
      const { service, bookService } = makeService();
      bookService.getDetail.mockResolvedValue(detail);

      await service.resolveWaiting(user, { bookId: 5, displayOrder: 0, seriesId: 42 });

      expect(bookService.updateMetadata).toHaveBeenCalledWith(
        5,
        {
          seriesMemberships: [
            { seriesName: 'Wisdom', seriesIndex: '2', seriesId: 42 },
            { seriesName: 'Cosmere', seriesIndex: undefined, seriesId: 8 },
            { seriesName: 'Shared', seriesIndex: undefined },
          ],
        },
        user,
      );
    });

    it('can start a new series for the name', async () => {
      const { service, bookService } = makeService();
      bookService.getDetail.mockResolvedValue(detail);

      await service.resolveWaiting(user, { bookId: 5, displayOrder: 2, newSeries: true });

      const [, dto] = bookService.updateMetadata.mock.calls[0] as [number, { seriesMemberships: unknown[] }];
      expect(dto.seriesMemberships[2]).toEqual({ seriesName: 'Shared', seriesIndex: undefined, newSeries: true });
    });

    it('needs exactly one of a series or a new series', async () => {
      const { service } = makeService();
      await expect(service.resolveWaiting(user, { bookId: 5, displayOrder: 0 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.resolveWaiting(user, { bookId: 5, displayOrder: 0, seriesId: 1, newSeries: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s when the name is no longer waiting', async () => {
      const { service, bookService } = makeService();
      bookService.getDetail.mockResolvedValue({ ...detail, pendingSeries: [] });
      await expect(service.resolveWaiting(user, { bookId: 5, displayOrder: 0, seriesId: 42 })).rejects.toBeInstanceOf(NotFoundException);
      expect(bookService.updateMetadata).not.toHaveBeenCalled();
    });
  });
});
