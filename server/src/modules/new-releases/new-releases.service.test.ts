import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { AppSettingsService } from '../app-settings/app-settings.service';
import type { AuthService } from '../auth/auth.service';
import type { BookRequestService } from '../book-request/book-request.service';
import type { LibraryService } from '../library/library.service';
import type { NewReleasesRepository } from './new-releases.repository';
import type { SourceRelease } from './release-merge';
import type { ReleaseSourcesService, ReleaseTarget } from './release-sources.service';
import { comingTuesday, NewReleasesService } from './new-releases.service';

const TODAY = '2026-11-13';
const user = { id: 3 } as RequestUser;
const target: ReleaseTarget = { kind: 'author', name: 'Jane Writer', nameKey: 'janewriter', authorHint: null };

function report(overrides: Partial<SourceRelease> = {}): SourceRelease {
  return {
    source: 'hardcover',
    sourceId: '1:ebook',
    mediaKind: 'ebook',
    title: 'Next',
    authors: ['Jane Writer'],
    seriesName: null,
    seriesIndex: null,
    coverUrl: null,
    isbn13: null,
    asin: null,
    date: '2027-03-09',
    ...overrides,
  };
}

describe('NewReleasesService', () => {
  let repository: {
    findReleasesByWorkKeys: ReturnType<typeof vi.fn<NewReleasesRepository['findReleasesByWorkKeys']>>;
    upsertRelease: ReturnType<typeof vi.fn<NewReleasesRepository['upsertRelease']>>;
    findOwnedBookId: ReturnType<typeof vi.fn<NewReleasesRepository['findOwnedBookId']>>;
    recordCheck: ReturnType<typeof vi.fn<NewReleasesRepository['recordCheck']>>;
    findLibraryAuthorsPage: ReturnType<typeof vi.fn<NewReleasesRepository['findLibraryAuthorsPage']>>;
    insertFollowsIfMissing: ReturnType<typeof vi.fn<NewReleasesRepository['insertFollowsIfMissing']>>;
    saveUserSettings: ReturnType<typeof vi.fn<NewReleasesRepository['saveUserSettings']>>;
    findReleaseById: ReturnType<typeof vi.fn<NewReleasesRepository['findReleaseById']>>;
    findPendingAutoRequests: ReturnType<typeof vi.fn<NewReleasesRepository['findPendingAutoRequests']>>;
    setRequested: ReturnType<typeof vi.fn<NewReleasesRepository['setRequested']>>;
    findUserSettings: ReturnType<typeof vi.fn<NewReleasesRepository['findUserSettings']>>;
    findSeriesAudibleAsins: ReturnType<typeof vi.fn<NewReleasesRepository['findSeriesAudibleAsins']>>;
    listForUser: ReturnType<typeof vi.fn<NewReleasesRepository['listForUser']>>;
    insertFollow: ReturnType<typeof vi.fn<NewReleasesRepository['insertFollow']>>;
    findLinkedAuthorNames: ReturnType<typeof vi.fn<NewReleasesRepository['findLinkedAuthorNames']>>;
    findFollowById: ReturnType<typeof vi.fn<NewReleasesRepository['findFollowById']>>;
    deleteAuthorFollowsByKeys: ReturnType<typeof vi.fn<NewReleasesRepository['deleteAuthorFollowsByKeys']>>;
    deleteFollow: ReturnType<typeof vi.fn<NewReleasesRepository['deleteFollow']>>;
  };
  let lookup: ReturnType<typeof vi.fn<ReleaseSourcesService['lookup']>>;
  let submit: ReturnType<typeof vi.fn<BookRequestService['submit']>>;
  let submitPair: ReturnType<typeof vi.fn<BookRequestService['submitPair']>>;
  let findActingUser: ReturnType<typeof vi.fn<AuthService['findActingUser']>>;
  let appValues: Map<string, string>;
  let service: NewReleasesService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    repository = {
      findReleasesByWorkKeys: vi.fn<NewReleasesRepository['findReleasesByWorkKeys']>().mockResolvedValue([]),
      upsertRelease: vi.fn<NewReleasesRepository['upsertRelease']>().mockResolvedValue(undefined),
      findOwnedBookId: vi.fn<NewReleasesRepository['findOwnedBookId']>().mockResolvedValue(null),
      recordCheck: vi.fn<NewReleasesRepository['recordCheck']>().mockResolvedValue(undefined),
      findLibraryAuthorsPage: vi.fn<NewReleasesRepository['findLibraryAuthorsPage']>(),
      insertFollowsIfMissing: vi.fn<NewReleasesRepository['insertFollowsIfMissing']>(),
      saveUserSettings: vi.fn<NewReleasesRepository['saveUserSettings']>().mockResolvedValue(undefined),
      findReleaseById: vi.fn<NewReleasesRepository['findReleaseById']>(),
      findPendingAutoRequests: vi.fn<NewReleasesRepository['findPendingAutoRequests']>().mockResolvedValue([]),
      setRequested: vi.fn<NewReleasesRepository['setRequested']>().mockResolvedValue(undefined),
      findUserSettings: vi.fn<NewReleasesRepository['findUserSettings']>().mockResolvedValue({ userId: 3, delivery: 'request', retentionDays: 60 }),
      findSeriesAudibleAsins: vi.fn<NewReleasesRepository['findSeriesAudibleAsins']>().mockResolvedValue([]),
      listForUser: vi.fn<NewReleasesRepository['listForUser']>().mockResolvedValue([]),
      insertFollow: vi.fn<NewReleasesRepository['insertFollow']>(),
      findLinkedAuthorNames: vi.fn<NewReleasesRepository['findLinkedAuthorNames']>().mockResolvedValue([]),
      findFollowById: vi.fn<NewReleasesRepository['findFollowById']>(),
      deleteAuthorFollowsByKeys: vi.fn<NewReleasesRepository['deleteAuthorFollowsByKeys']>().mockResolvedValue(0),
      deleteFollow: vi.fn<NewReleasesRepository['deleteFollow']>().mockResolvedValue(true),
    };
    lookup = vi.fn<ReleaseSourcesService['lookup']>();
    submit = vi.fn<BookRequestService['submit']>().mockResolvedValue({} as never);
    submitPair = vi.fn<BookRequestService['submitPair']>().mockResolvedValue({} as never);
    findActingUser = vi.fn<AuthService['findActingUser']>();
    appValues = new Map([['new_releases_default_delivery', 'request']]);
    service = new NewReleasesService(
      repository as unknown as NewReleasesRepository,
      { lookup } as unknown as ReleaseSourcesService,
      { getValues: vi.fn<AppSettingsService['getValues']>(() => Promise.resolve(appValues)) } as unknown as AppSettingsService,
      { findAccessibleLibraryIds: vi.fn<LibraryService['findAccessibleLibraryIds']>().mockResolvedValue([1, 2]) } as unknown as LibraryService,
      { submit, submitPair } as unknown as BookRequestService,
      { findActingUser } as unknown as AuthService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves what a lookup finds, marks books already in the library, and records the check', async () => {
    lookup.mockResolvedValue({ releases: [report()], failedSources: [], attempted: 1 });
    repository.findOwnedBookId.mockResolvedValue(42);

    await expect(service.checkTarget(target, TODAY)).resolves.toBe(1);

    expect(repository.upsertRelease).toHaveBeenCalledWith(expect.objectContaining({ title: 'Next', ebookDate: '2027-03-09' }), 42);
    expect(repository.recordCheck).toHaveBeenCalledWith(target, 1);
  });

  it('confirms a 1 January date once an earlier lookup from another source agrees', async () => {
    lookup.mockResolvedValue({ releases: [report({ date: '2027-01-01' })], failedSources: [], attempted: 1 });
    repository.findReleasesByWorkKeys.mockResolvedValue([
      { workKey: 'next|janewriter', sources: [report({ source: 'google', sourceId: 'g1', date: '2027-01-01' })] } as never,
    ]);

    await service.checkTarget(target, TODAY);

    expect(repository.upsertRelease).toHaveBeenCalledWith(expect.objectContaining({ ebookDate: '2027-01-01' }), null);
  });

  it('hands a series check the Audible ASINs of its books in the library', async () => {
    repository.findSeriesAudibleAsins.mockResolvedValue(['B0OWNED']);
    lookup.mockResolvedValue({ releases: [], failedSources: [], attempted: 1 });
    const series: ReleaseTarget = { kind: 'series', name: 'The Saga', nameKey: 'thesaga', authorHint: null };

    await service.checkTarget(series, TODAY);

    expect(repository.findSeriesAudibleAsins).toHaveBeenCalledWith('thesaga');
    expect(lookup).toHaveBeenCalledWith({ ...series, audibleAsins: ['B0OWNED'] }, TODAY);
  });

  it('leaves a name due when every source failed', async () => {
    lookup.mockResolvedValue({ releases: [], failedSources: ['hardcover', 'audible'], attempted: 2 });

    await service.checkTarget(target, TODAY);

    expect(repository.recordCheck).not.toHaveBeenCalled();
  });

  it('follows every author a page at a time, keyed the same way releases are', async () => {
    repository.findLibraryAuthorsPage
      .mockResolvedValueOnce([
        { id: 1, name: 'Émile Zola' },
        { id: 2, name: 'Jane Writer' },
      ])
      .mockResolvedValueOnce([]);
    repository.insertFollowsIfMissing.mockResolvedValue(2);

    await expect(service.followAll(user, 'author')).resolves.toEqual({ added: 2 });

    expect(repository.findLibraryAuthorsPage).toHaveBeenLastCalledWith([1, 2], 2, 1000);
    expect(repository.insertFollowsIfMissing).toHaveBeenCalledWith(3, [
      expect.objectContaining({ name: 'Émile Zola', nameKey: 'emilezola', authorId: 1 }),
      expect.objectContaining({ name: 'Jane Writer', nameKey: 'janewriter', authorId: 2 }),
    ]);
  });

  it('saves the settings given and keeps the rest', async () => {
    await expect(service.updateUserSettings(user, { retentionDays: 60 })).resolves.toEqual({ delivery: 'request', retentionDays: 60 });
    expect(repository.saveUserSettings).toHaveBeenCalledWith(3, { retentionDays: 60 });
  });

  const listed = {
    id: 8,
    title: 'Next',
    authors: ['Jane Writer'],
    seriesName: null,
    seriesIndex: null,
    coverUrl: null,
    isbn13: null,
    ebookDate: '2027-03-09',
    audiobookDate: null,
    sources: [],
  } as never;

  it('requests a listed book in the formats with a date and marks it requested', async () => {
    repository.findReleaseById.mockResolvedValue(listed);

    await expect(service.requestRelease(user, 8, ['ebook'])).resolves.toEqual({ requested: ['ebook'] });

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ mediaKind: 'ebook', title: 'Next', publishedDate: '2027-03-09' }), user);
    expect(repository.setRequested).toHaveBeenCalledWith(3, 8);
  });

  it('requests both formats as one paired request, each with its own date', async () => {
    repository.findReleaseById.mockResolvedValue(listed);

    await expect(service.requestRelease(user, 8, ['ebook', 'audiobook'])).resolves.toEqual({ requested: ['ebook', 'audiobook'] });

    expect(submit).not.toHaveBeenCalled();
    expect(submitPair).toHaveBeenCalledTimes(1);
    const [work, actor, halves] = submitPair.mock.calls[0]!;
    expect(work).toEqual(expect.objectContaining({ title: 'Next' }));
    expect(work).not.toHaveProperty('mediaKind');
    expect(work).not.toHaveProperty('publishedDate');
    expect(actor).toBe(user);
    expect(halves?.ebook).toEqual(expect.objectContaining({ publishedDate: '2027-03-09' }));
    expect(halves?.audiobook?.publishedDate).toBeUndefined();
    expect(repository.setRequested).toHaveBeenCalledWith(3, 8);
  });

  it('files each format on its own when the paired request is refused', async () => {
    repository.findReleaseById.mockResolvedValue(listed);
    submitPair.mockRejectedValueOnce(new Error('pairs not allowed'));

    await expect(service.requestRelease(user, 8, ['ebook', 'audiobook'])).resolves.toEqual({ requested: ['ebook', 'audiobook'] });

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ mediaKind: 'audiobook', title: 'Next' }), user);
    expect(submit).not.toHaveBeenCalledWith(expect.objectContaining({ mediaKind: 'audiobook', publishedDate: expect.anything() }), user);
  });

  it('auto-requests the server default of both formats even when one has no date yet', async () => {
    repository.findPendingAutoRequests.mockResolvedValue([{ userId: 3, releaseId: 8 }]);
    repository.findReleaseById.mockResolvedValue(listed);
    findActingUser.mockResolvedValue({ id: 3, isSuperuser: false, permissions: ['new_releases_access', 'book_request_access'] } as never);

    await expect(service.autoRequest(1_000)).resolves.toEqual({ filed: 1, failed: 0 });

    expect(submitPair).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('requests for people set to have books requested, once, and holds back one that fails', async () => {
    appValues.set('new_releases_default_format', 'ebook');
    repository.findPendingAutoRequests.mockResolvedValue([
      { userId: 3, releaseId: 8 },
      { userId: 4, releaseId: 8 },
    ]);
    repository.findReleaseById.mockResolvedValue(listed);
    findActingUser.mockImplementation((id) =>
      Promise.resolve({ id, isSuperuser: false, permissions: ['new_releases_access', 'book_request_access'] } as never),
    );
    submit.mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('format locked'));

    await expect(service.autoRequest(1_000)).resolves.toEqual({ filed: 1, failed: 1 });
    expect(repository.findPendingAutoRequests).toHaveBeenCalledWith('request', 100);
    expect(repository.setRequested).toHaveBeenCalledTimes(1);

    submit.mockClear();
    await service.autoRequest(2_000);
    expect(submit).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 4 }));
  });

  it('never requests for someone without the permission', async () => {
    repository.findPendingAutoRequests.mockResolvedValue([{ userId: 5, releaseId: 8 }]);
    findActingUser.mockResolvedValue({ id: 5, isSuperuser: false, permissions: ['new_releases_access'] } as never);

    await service.autoRequest(1_000);

    expect(submit).not.toHaveBeenCalled();
    expect(submitPair).not.toHaveBeenCalled();
  });

  it('lists followed books out on the coming Tuesday, with the formats out that day', async () => {
    repository.listForUser.mockResolvedValue([
      { ...listed, ebookDate: '2026-11-17', audiobookDate: '2026-12-01', matchedFollows: [], state: null, totalCount: 14 } as never,
    ]);

    const result = await service.upcomingTuesday({ ...user, isSuperuser: false, permissions: ['new_releases_access'] } as never, '2026-11-13');

    expect(repository.listForUser).toHaveBeenCalledWith(3, { onDate: '2026-11-17' }, 12);
    expect(result).toEqual({ date: '2026-11-17', total: 14, items: [expect.objectContaining({ id: 8, formats: ['ebook'] })] });
  });

  it('follows the other names of a followed author', async () => {
    repository.insertFollow.mockResolvedValue({ id: 1, kind: 'author', name: 'Seanan McGuire', createdAt: new Date() } as never);
    repository.findLinkedAuthorNames.mockResolvedValue([{ userId: 3, name: 'A. Deborah Baker', authorId: 40 }]);
    repository.insertFollowsIfMissing.mockResolvedValue(1);

    await service.follow(user, { kind: 'author', name: 'Seanan McGuire', authorId: 12 });

    expect(repository.findLinkedAuthorNames).toHaveBeenCalledWith({ userId: 3 }, true);
    expect(repository.insertFollowsIfMissing).toHaveBeenCalledWith(3, [
      expect.objectContaining({ kind: 'author', name: 'A. Deborah Baker', authorId: 40 }),
    ]);
  });

  it('unfollows the other names with the author', async () => {
    repository.findFollowById.mockResolvedValue({ id: 1, kind: 'author', name: 'Seanan McGuire', nameKey: 'seananmcguire' } as never);
    repository.findLinkedAuthorNames.mockResolvedValue([
      { userId: 3, name: 'Seanan McGuire', authorId: 12 },
      { userId: 3, name: 'A. Deborah Baker', authorId: 40 },
    ]);

    await service.unfollow(user, 1);

    expect(repository.findLinkedAuthorNames).toHaveBeenCalledWith({ userId: 3, followId: 1 }, false);
    expect(repository.deleteAuthorFollowsByKeys).toHaveBeenCalledWith(3, [expect.not.stringMatching(/^seananmcguire$/)]);
    expect(repository.deleteFollow).toHaveBeenCalledWith(3, 1);
  });

  it('gives no widget data to someone without New Releases access', async () => {
    await expect(service.upcomingTuesday({ ...user, isSuperuser: false, permissions: [] } as never, '2026-11-13')).resolves.toBeNull();
    expect(repository.listForUser).not.toHaveBeenCalled();
  });
});

describe('comingTuesday', () => {
  it('is today on a Tuesday and the next Tuesday otherwise', () => {
    expect(comingTuesday('2026-11-17')).toBe('2026-11-17');
    expect(comingTuesday('2026-11-18')).toBe('2026-11-24');
    expect(comingTuesday('2026-11-16')).toBe('2026-11-17');
    expect(comingTuesday('2026-12-30')).toBe('2027-01-05');
  });
});
