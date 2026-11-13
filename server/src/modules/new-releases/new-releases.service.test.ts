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
import { NewReleasesService } from './new-releases.service';

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
  };
  let lookup: ReturnType<typeof vi.fn<ReleaseSourcesService['lookup']>>;
  let submit: ReturnType<typeof vi.fn<BookRequestService['submit']>>;
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
    };
    lookup = vi.fn<ReleaseSourcesService['lookup']>();
    submit = vi.fn<BookRequestService['submit']>().mockResolvedValue({} as never);
    findActingUser = vi.fn<AuthService['findActingUser']>();
    appValues = new Map([['new_releases_default_delivery', 'request']]);
    service = new NewReleasesService(
      repository as unknown as NewReleasesRepository,
      { lookup } as unknown as ReleaseSourcesService,
      { getValues: vi.fn<AppSettingsService['getValues']>(() => Promise.resolve(appValues)) } as unknown as AppSettingsService,
      { findAccessibleLibraryIds: vi.fn<LibraryService['findAccessibleLibraryIds']>().mockResolvedValue([1, 2]) } as unknown as LibraryService,
      { submit } as unknown as BookRequestService,
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
    await expect(service.requestRelease(user, 8, ['audiobook'])).rejects.toThrow('no confirmed release date');
  });

  it('requests for people set to have books requested, once, and holds back one that fails', async () => {
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
  });
});
