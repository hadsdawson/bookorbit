import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { AppSettingsService } from '../app-settings/app-settings.service';
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
    saveRetentionDays: ReturnType<typeof vi.fn<NewReleasesRepository['saveRetentionDays']>>;
    findUserSettings: ReturnType<typeof vi.fn<NewReleasesRepository['findUserSettings']>>;
  };
  let lookup: ReturnType<typeof vi.fn<ReleaseSourcesService['lookup']>>;
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
      saveRetentionDays: vi.fn<NewReleasesRepository['saveRetentionDays']>().mockResolvedValue(undefined),
      findUserSettings: vi.fn<NewReleasesRepository['findUserSettings']>().mockResolvedValue({ userId: 3, delivery: 'request', retentionDays: 60 }),
    };
    lookup = vi.fn<ReleaseSourcesService['lookup']>();
    service = new NewReleasesService(
      repository as unknown as NewReleasesRepository,
      { lookup } as unknown as ReleaseSourcesService,
      {} as AppSettingsService,
      { findAccessibleLibraryIds: vi.fn<LibraryService['findAccessibleLibraryIds']>().mockResolvedValue([1, 2]) } as unknown as LibraryService,
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

  it('saves how long released books stay listed and keeps the delivery choice', async () => {
    await expect(service.updateUserSettings(user, 60)).resolves.toEqual({ delivery: 'request', retentionDays: 60 });
    expect(repository.saveRetentionDays).toHaveBeenCalledWith(3, 60);
  });
});
