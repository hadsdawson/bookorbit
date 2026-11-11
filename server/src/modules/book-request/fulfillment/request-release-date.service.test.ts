import { of } from 'rxjs';

import { RequestReleaseDateService } from './request-release-date.service';

function makeService(byProvider: Record<string, unknown[]>, request: Record<string, unknown> = {}) {
  const repo = {
    findById: vi.fn().mockResolvedValue({
      request: { id: 7, title: 'The Divine Shadow', authors: ['Lyndsay Ely'], mediaKind: 'audiobook', publishedDate: '2026-03-01', ...request },
    }),
    setPublishedDate: vi.fn().mockResolvedValue(undefined),
    findOpenAudiobookIds: vi.fn().mockResolvedValue([]),
    findOpenEbookIdsWithoutDate: vi.fn().mockResolvedValue([]),
  };
  const metadata = { searchCandidates: vi.fn((_params: unknown, keys: string[]) => of(...((byProvider[keys[0]!] ?? []) as object[]))) };
  const gateway = { emitChanged: vi.fn() };
  const appSettings = { getValue: vi.fn().mockResolvedValue('true'), setValue: vi.fn() };
  const service = new RequestReleaseDateService(repo as never, metadata as never, gateway as never, appSettings as never);
  return { service, repo, metadata, gateway };
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
});
