import { ConflictException } from '@nestjs/common';

import { CommunityRatingsRefreshService } from './community-ratings-refresh.service';

function makeService(bookIds: number[] = [1, 2, 3], stored: Record<string, string> = {}) {
  const values = new Map(Object.entries(stored));
  const appSettings = {
    getValue: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setValue: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
  };
  const repository = {
    countBooksWithRatings: vi.fn().mockResolvedValue(bookIds.length),
    findBookIdsWithRatings: vi.fn((afterId: number, limit: number) => Promise.resolve(bookIds.filter((id) => id > afterId).slice(0, limit))),
  };
  const bookService = { refreshCommunityRatings: vi.fn().mockResolvedValue({ status: 'updated', outboundRequests: 1 }) };
  const service = new CommunityRatingsRefreshService(repository as never, appSettings as never, bookService as never);
  service.setPaceForTesting(0);
  return { service, values, appSettings, repository, bookService };
}

const storedRun = (values: Map<string, string>) => JSON.parse(values.get('community_ratings_refresh_run') ?? 'null');

describe('CommunityRatingsRefreshService', () => {
  it('visits every book that has ratings once and records the outcome', async () => {
    const { service, bookService, values } = makeService([4, 9, 12]);
    bookService.refreshCommunityRatings
      .mockResolvedValueOnce({ status: 'updated', outboundRequests: 2 })
      .mockResolvedValueOnce({ status: 'unchanged', outboundRequests: 0 })
      .mockRejectedValueOnce(new Error('provider down'));

    const started = await service.start('manual');
    expect(started.running).toBe(true);
    await service.whenIdle();

    expect(bookService.refreshCommunityRatings.mock.calls.map((call) => call[0])).toEqual([4, 9, 12]);
    const status = await service.status();
    expect(status.running).toBe(false);
    expect(status.run).toMatchObject({ trigger: 'manual', total: 3, processed: 3, updated: 1, unchanged: 1, failed: 1, cancelled: false });
    expect(status.run?.finishedAt).not.toBeNull();
    expect(storedRun(values).lastBookId).toBe(12);
  });

  it('refuses a second pass while one is running', async () => {
    const { service } = makeService();
    await service.start('manual');
    await expect(service.start('manual')).rejects.toBeInstanceOf(ConflictException);
    await service.whenIdle();
  });

  it('stops after the book in hand when cancelled', async () => {
    const { service, bookService } = makeService([1, 2, 3]);
    bookService.refreshCommunityRatings.mockImplementationOnce(async () => {
      await service.cancel();
      return { status: 'updated', outboundRequests: 0 };
    });
    await service.start('manual');
    await service.whenIdle();

    expect(bookService.refreshCommunityRatings).toHaveBeenCalledTimes(1);
    expect((await service.status()).run).toMatchObject({ processed: 1, cancelled: true });
  });

  it('starts a monthly pass only when the schedule is on and the last one began 30 days ago', async () => {
    const now = new Date('2026-11-12T12:00:00Z');
    const off = makeService();
    await off.service.runScheduled(now);
    expect(off.bookService.refreshCommunityRatings).not.toHaveBeenCalled();

    const recent = JSON.stringify({ startedAt: '2026-11-01T00:00:00Z', finishedAt: '2026-11-01T02:00:00Z', lastBookId: 3 });
    const tooSoon = makeService([1], { community_ratings_refresh_schedule: 'monthly', community_ratings_refresh_run: recent });
    await tooSoon.service.runScheduled(now);
    expect(tooSoon.bookService.refreshCommunityRatings).not.toHaveBeenCalled();
    expect((await tooSoon.service.status(now)).nextScheduledAt).toBe('2026-12-01T00:00:00.000Z');

    const old = JSON.stringify({ startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T02:00:00Z', lastBookId: 3 });
    const due = makeService([1], { community_ratings_refresh_schedule: 'monthly', community_ratings_refresh_run: old });
    await due.service.runScheduled(now);
    await due.service.whenIdle();
    expect(due.bookService.refreshCommunityRatings).toHaveBeenCalledTimes(1);
    expect((await due.service.status()).run?.trigger).toBe('scheduled');
  });

  it('carries on after the last book it reached when a restart interrupted a pass', async () => {
    const interrupted = JSON.stringify({
      trigger: 'manual',
      startedAt: '2026-11-12T00:00:00Z',
      finishedAt: null,
      cancelled: false,
      total: 4,
      processed: 2,
      updated: 2,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      lastBookId: 2,
    });
    const { service, bookService } = makeService([1, 2, 3, 4], { community_ratings_refresh_run: interrupted });
    await (service as unknown as { resumeInterrupted: () => Promise<void> }).resumeInterrupted();
    await service.whenIdle();

    expect(bookService.refreshCommunityRatings.mock.calls.map((call) => call[0])).toEqual([3, 4]);
    expect((await service.status()).run).toMatchObject({ processed: 4, updated: 4 });
  });

  it('saves the schedule and falls back to off for anything unknown', async () => {
    const { service, values } = makeService([], { community_ratings_refresh_schedule: 'weekly' });
    expect((await service.status()).schedule).toBe('off');
    expect((await service.setSchedule('monthly')).schedule).toBe('monthly');
    expect(values.get('community_ratings_refresh_schedule')).toBe('monthly');
  });
});
