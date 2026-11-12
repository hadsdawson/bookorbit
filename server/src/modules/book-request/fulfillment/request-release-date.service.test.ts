import { of } from 'rxjs';

import { RequestReleaseDateService } from './request-release-date.service';

function makeService(byProvider: Record<string, unknown[]>, request: Record<string, unknown> = {}) {
  const repo = {
    findById: vi.fn().mockResolvedValue({
      request: {
        id: 7,
        title: 'The Divine Shadow',
        authors: ['Lyndsay Ely'],
        mediaKind: 'audiobook',
        publishedDate: '2026-03-01',
        coverUrl: null,
        ...request,
      },
    }),
    setPublishedDate: vi.fn().mockResolvedValue(undefined),
    setCoverUrlIfMissing: vi.fn().mockResolvedValue(true),
    findOpenAudiobookIds: vi.fn().mockResolvedValue([]),
    findOpenEbookIdsWithoutDate: vi.fn().mockResolvedValue([]),
    findOpenDatedIds: vi.fn().mockResolvedValue([]),
  };
  const metadata = { searchCandidates: vi.fn((_params: unknown, keys: string[]) => of(...((byProvider[keys[0]!] ?? []) as object[]))) };
  const gateway = { emitChanged: vi.fn() };
  const appSettings = { getValue: vi.fn().mockResolvedValue('true'), setValue: vi.fn() };
  const throttle = { isThrottled: vi.fn().mockReturnValue(false) };
  const service = new RequestReleaseDateService(repo as never, metadata as never, gateway as never, appSettings as never, throttle as never);
  return { service, repo, metadata, gateway, appSettings, throttle };
}

describe('RequestReleaseDateService', () => {
  it('takes the audiobook date from Audible when it matches the book', async () => {
    const { service, repo, metadata } = makeService({
      audible: [{ title: 'The Divine Shadow', authors: ['Lyndsay Ely'], publishedDate: '2026-06-10' }],
    });
    await expect(service.enrich(7)).resolves.toBe(true);
    expect(repo.setPublishedDate).toHaveBeenCalledWith(7, '2026-06-10', 2026);
    expect(metadata.searchCandidates).toHaveBeenCalledTimes(1);
  });

  it('falls back to Libro.fm when Audible has nothing', async () => {
    const { service, repo } = makeService({
      audible: [],
      librofm: [{ title: 'The Divine Shadow: A Novel', authors: ['Lyndsay Ely'], publishedDate: '2026-06-12' }],
    });
    await service.enrich(7);
    expect(repo.setPublishedDate).toHaveBeenCalledWith(7, '2026-06-12', 2026);
  });

  it('ignores a result by another author or with another title', async () => {
    const { service, repo } = makeService({
      audible: [
        { title: 'The Divine Shadow', authors: ['Someone Else'], publishedDate: '2026-06-10' },
        { title: 'A Different Book', authors: ['Lyndsay Ely'], publishedDate: '2026-06-11' },
      ],
      librofm: [],
    });
    await expect(service.enrich(7)).resolves.toBe(false);
    expect(repo.setPublishedDate).not.toHaveBeenCalled();
  });

  it('leaves an ebook request that already has a full date alone', async () => {
    const { service, metadata } = makeService({}, { mediaKind: 'ebook' });
    await expect(service.enrich(7)).resolves.toBe(false);
    expect(metadata.searchCandidates).not.toHaveBeenCalled();
  });

  it('looks up an ebook without a date on Amazon first', async () => {
    const { service, repo, metadata } = makeService(
      { amazon: [{ title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: '2026-05-19' }] },
      { mediaKind: 'ebook', title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: null },
    );
    await expect(service.enrich(7)).resolves.toBe(true);
    expect(repo.setPublishedDate).toHaveBeenCalledWith(7, '2026-05-19', 2026);
    expect(metadata.searchCandidates).toHaveBeenCalledWith(expect.objectContaining({ mediaKind: 'ebook', isAudiobook: false }), ['amazon']);
  });

  it('falls back to Kobo, then Google Books, for an ebook', async () => {
    const { service, repo } = makeService(
      {
        amazon: [],
        kobo: [{ title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: '2026' }],
        google: [{ title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: '2026-05-19' }],
      },
      { mediaKind: 'ebook', title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: null },
    );
    await expect(service.enrich(7)).resolves.toBe(true);
    expect(repo.setPublishedDate).toHaveBeenCalledWith(7, '2026-05-19', 2026);
  });

  it('writes nothing when the date is already right', async () => {
    const { service, repo, gateway } = makeService({
      audible: [{ title: 'The Divine Shadow', authors: ['Lyndsay Ely'], publishedDate: '2026-03-01' }],
    });
    await service.enrich(7);
    expect(repo.setPublishedDate).not.toHaveBeenCalled();
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('never fills a cover outside the weekly re-check', async () => {
    const { service, repo } = makeService({
      audible: [{ title: 'The Divine Shadow', authors: ['Lyndsay Ely'], publishedDate: '2026-06-10', coverUrl: 'https://img.example/cover.jpg' }],
    });
    await service.enrich(7);
    expect(repo.setCoverUrlIfMissing).not.toHaveBeenCalled();
  });

  describe('weekly re-check', () => {
    const lease = { mediaKind: 'ebook', title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: '2026-05-19' };

    async function recheck(service: RequestReleaseDateService, repo: { findOpenDatedIds: ReturnType<typeof vi.fn> }) {
      repo.findOpenDatedIds.mockResolvedValue([7]);
      await service.runWeeklyRecheck(new Date('2026-11-15T10:23:00Z'));
    }

    it('updates an ebook date that moved and fills a missing cover from the matched result, going live', async () => {
      const { service, repo, metadata, gateway, appSettings } = makeService(
        {
          amazon: [
            { title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: '2026-07-07', coverUrl: 'https://img.example/lease.jpg' },
          ],
        },
        lease,
      );
      appSettings.getValue.mockResolvedValue(null);
      await recheck(service, repo);

      expect(appSettings.setValue).toHaveBeenCalledWith('book_request_weekly_recheck_last_run', '2026-11-15T10:23:00.000Z');
      expect(repo.setPublishedDate).toHaveBeenCalledWith(7, '2026-07-07', 2026);
      expect(repo.setCoverUrlIfMissing).toHaveBeenCalledWith(7, 'https://img.example/lease.jpg');
      expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
      expect(metadata.searchCandidates).toHaveBeenCalledWith(expect.anything(), ['amazon'], {
        directive: { policy: 'refresh', allowFallback: true },
      });
      expect(metadata.searchCandidates).toHaveBeenCalledTimes(1);
    });

    it('keeps looking on the next site for a cover the first match lacked', async () => {
      const { service, repo, appSettings } = makeService(
        {
          amazon: [{ title: 'The Lease of Nature', authors: ['Anderson Boyd'], publishedDate: '2026-05-19' }],
          kobo: [{ title: 'The Lease of Nature', authors: ['Anderson Boyd'], coverUrl: 'https://kobo.example/lease.jpg' }],
        },
        lease,
      );
      appSettings.getValue.mockResolvedValue(null);
      await recheck(service, repo);

      expect(repo.setPublishedDate).not.toHaveBeenCalled();
      expect(repo.setCoverUrlIfMissing).toHaveBeenCalledWith(7, 'https://kobo.example/lease.jpg');
    });

    it('leaves a request that has a cover alone, and skips a site that asked to slow down', async () => {
      const { service, repo, metadata, appSettings, throttle } = makeService(
        { librofm: [{ title: 'The Divine Shadow', authors: ['Lyndsay Ely'], publishedDate: '2026-06-12', coverUrl: 'https://img.example/new.jpg' }] },
        { coverUrl: 'https://img.example/picked.jpg' },
      );
      appSettings.getValue.mockResolvedValue(null);
      throttle.isThrottled.mockImplementation((key: string) => key === 'audible');
      await recheck(service, repo);

      expect(metadata.searchCandidates).toHaveBeenCalledTimes(1);
      expect(metadata.searchCandidates).toHaveBeenCalledWith(expect.anything(), ['librofm'], expect.anything());
      expect(repo.setPublishedDate).toHaveBeenCalledWith(7, '2026-06-12', 2026);
      expect(repo.setCoverUrlIfMissing).not.toHaveBeenCalled();
    });

    it('waits a full week between runs', async () => {
      const { service, repo, appSettings } = makeService({});
      appSettings.getValue.mockResolvedValue('2026-11-10T10:23:00.000Z');
      await recheck(service, repo);
      expect(repo.findOpenDatedIds).not.toHaveBeenCalled();

      appSettings.getValue.mockResolvedValue('2026-11-08T10:23:00.000Z');
      await recheck(service, repo);
      expect(repo.findOpenDatedIds).toHaveBeenCalledWith(1000);
    });
  });
});
