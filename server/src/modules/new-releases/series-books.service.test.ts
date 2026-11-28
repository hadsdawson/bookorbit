import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookRequestAvailability, BookRequestAvailabilityQuery } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BookRequestService } from '../book-request/book-request.service';
import type { LibraryService } from '../library/library.service';
import type { NewReleasesRepository } from './new-releases.repository';
import type { NewReleasesService } from './new-releases.service';
import type { SourceRelease } from './release-merge';
import type { ReleaseSourcesService } from './release-sources.service';
import { SERIES_REQUEST_NOTE, SeriesBooksService } from './series-books.service';

const user = { id: 3 } as RequestUser;
const none: BookRequestAvailability = { ownedBookId: null, existingRequestId: null, existingRequestStatus: null, alreadySubscribed: false };

function report(title: string, index: number, date: string): SourceRelease {
  return {
    source: 'hardcover',
    sourceId: `${index}:ebook`,
    mediaKind: 'ebook',
    title,
    authors: ['Jessica Cage'],
    seriesName: 'Accidents Happen',
    seriesIndex: index,
    coverUrl: null,
    isbn13: null,
    asin: null,
    date,
  };
}

describe('SeriesBooksService', () => {
  let lookupSeries: ReturnType<typeof vi.fn<ReleaseSourcesService['lookupSeries']>>;
  let checkAvailability: ReturnType<typeof vi.fn<BookRequestService['checkAvailability']>>;
  let fileRequestsFor: ReturnType<typeof vi.fn<NewReleasesService['fileRequestsFor']>>;
  let repository: {
    findLibraryLinks: ReturnType<typeof vi.fn<NewReleasesRepository['findLibraryLinks']>>;
    findSeriesAuthor: ReturnType<typeof vi.fn<NewReleasesRepository['findSeriesAuthor']>>;
    findLibrarySeriesAudibleAsins: ReturnType<typeof vi.fn<NewReleasesRepository['findLibrarySeriesAudibleAsins']>>;
    findReleasesByWorkKeys: ReturnType<typeof vi.fn<NewReleasesRepository['findReleasesByWorkKeys']>>;
    setRequested: ReturnType<typeof vi.fn<NewReleasesRepository['setRequested']>>;
  };
  let service: SeriesBooksService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    lookupSeries = vi.fn<ReleaseSourcesService['lookupSeries']>().mockResolvedValue({
      releases: [
        report('I Accidentally Hired a Shadow Walker', 1, '2025-01-10'),
        report('Book Two', 2, '2025-08-01'),
        report('Book Three', 3, '2027-02-02'),
      ],
      failedSources: [],
      attempted: 1,
    });
    // Book one is owned, book two is requested, book three is missing.
    checkAvailability = vi.fn<BookRequestService['checkAvailability']>((queries: BookRequestAvailabilityQuery[]) =>
      Promise.resolve(
        queries.map((query) =>
          query.title.startsWith('I Accidentally')
            ? { ...none, ownedBookId: 11 }
            : query.title === 'Book Two'
              ? { ...none, existingRequestId: 22 }
              : none,
        ),
      ),
    );
    fileRequestsFor = vi.fn<NewReleasesService['fileRequestsFor']>().mockResolvedValue(['ebook']);
    repository = {
      findLibraryLinks: vi.fn().mockResolvedValue({ authors: new Map(), series: new Map([['accidents happen', 7]]) }),
      findSeriesAuthor: vi.fn().mockResolvedValue('Jessica Cage'),
      findLibrarySeriesAudibleAsins: vi.fn().mockResolvedValue(['B0OWNED']),
      findReleasesByWorkKeys: vi.fn().mockResolvedValue([]),
      setRequested: vi.fn().mockResolvedValue(undefined),
    };
    service = new SeriesBooksService(
      repository as unknown as NewReleasesRepository,
      { lookupSeries, status: () => Promise.resolve({ hardcover: true, audible: true, google: false }) } as unknown as ReleaseSourcesService,
      {
        serverSettings: () => Promise.resolve({ defaultFormat: 'ebook', defaultDelivery: 'suggest', language: 'any', languageStrict: false }),
        fileRequestsFor,
      } as unknown as NewReleasesService,
      { findAccessibleLibraryIds: () => Promise.resolve([1]) } as unknown as LibraryService,
      { checkAvailability } as unknown as BookRequestService,
    );
  });

  it('lists every book of the series with where each stands, in the format the settings name', async () => {
    const result = await service.list(user, 'Accidents Happen');

    expect(lookupSeries).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Accidents Happen', authorHint: 'Jessica Cage', audibleAsins: ['B0OWNED'] }),
    );
    expect(result.seriesId).toBe(7);
    expect(result.formats).toEqual(['ebook']);
    expect(result.books.map((book) => [book.title, book.status, book.comingSoon])).toEqual([
      ['I Accidentally Hired a Shadow Walker', 'owned', false],
      ['Book Two', 'requested', false],
      ['Book Three', 'missing', true],
    ]);
  });

  it('asks the book sites once, then answers from memory', async () => {
    await service.list(user, 'Accidents Happen');
    await service.list(user, 'Accidents Happen');
    expect(lookupSeries).toHaveBeenCalledTimes(1);
  });

  it('requests only the books still missing, and reports the ones that could not be found', async () => {
    const listed = await service.list(user, 'Accidents Happen');
    const keys = listed.books.map((book) => book.key);

    const result = await service.request(user, 'Accidents Happen', undefined, [...keys, 'gone|key']);

    expect(fileRequestsFor).toHaveBeenCalledTimes(1);
    expect(fileRequestsFor).toHaveBeenCalledWith(user, expect.objectContaining({ title: 'Book Three' }), ['ebook'], { note: SERIES_REQUEST_NOTE });
    expect(result.requested).toEqual([keys[1], keys[2]]);
    expect(result.failed).toEqual(['gone|key']);
  });

  it('marks a requested book as requested in New Releases too', async () => {
    repository.findReleasesByWorkKeys.mockResolvedValue([{ id: 55 } as never]);
    const listed = await service.list(user, 'Accidents Happen');

    await service.request(user, 'Accidents Happen', undefined, [listed.books[2]!.key]);

    expect(repository.setRequested).toHaveBeenCalledWith(3, 55);
  });

  it('counts a book whose request was refused as failed', async () => {
    fileRequestsFor.mockRejectedValue(new Error('format locked'));
    const listed = await service.list(user, 'Accidents Happen');

    const result = await service.request(user, 'Accidents Happen', undefined, [listed.books[2]!.key]);

    expect(result).toEqual({ requested: [], failed: [listed.books[2]!.key] });
  });
});
