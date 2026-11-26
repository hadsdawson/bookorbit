import { SeriesIdentityService } from './series-identity.service';

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

/**
 * A stand-in for the query builder: every chained call returns the same query, and awaiting it
 * yields the next queued result for that kind of statement, in the order the statements run.
 */
function fakeDb(results: { select?: unknown[][]; insert?: unknown[][] } = {}) {
  const selectQueue = [...(results.select ?? [])];
  const insertQueue = [...(results.insert ?? [])];
  const calls: Record<string, unknown[][]> = {};
  const query = (queue: unknown[][]) => {
    const q: Record<string, unknown> = {};
    for (const method of [
      'from',
      'where',
      'orderBy',
      'limit',
      'innerJoin',
      'groupBy',
      'values',
      'onConflictDoUpdate',
      'onConflictDoNothing',
      'returning',
    ]) {
      q[method] = vi.fn((...args: unknown[]) => {
        (calls[method] ??= []).push(args);
        return q;
      });
    }
    q.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(resolve, reject);
    return q;
  };
  const select = vi.fn(() => query(selectQueue));
  const insert = vi.fn(() => query(insertQueue));
  return { db: { select, insert } as never, select, insert, calls };
}

describe('SeriesIdentityService', () => {
  it('normalizes names for identity while preserving display casing', () => {
    const service = new SeriesIdentityService({} as never);

    expect(service.normalizeName('  The   Expanse  ')).toBe('the expanse');
    expect(service.normalizeName('   ')).toBeNull();
    expect(service.normalizeName(null)).toBeNull();
    expect(service.normalizeDisplayName('  The   Expanse  ')).toBe('The Expanse');
    expect(service.normalizeDisplayName('   ')).toBeNull();
  });

  it('runs all startup backfill statements without requiring manual data migration SQL', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const service = new SeriesIdentityService({ execute } as never);

    await service.backfillMissingSeriesIds();

    expect(execute).toHaveBeenCalledTimes(3);
    const createSeriesSql = flattenSql(execute.mock.calls[0]![0]).replace(/\s+/g, ' ');
    expect(createSeriesSql).toContain('regexp_replace');
    expect(createSeriesSql).toContain('replace');
    expect(createSeriesSql).toContain('chr(160)');
    expect(createSeriesSql).toContain('btrim(regexp_replace');
    expect(createSeriesSql).toContain('ON CONFLICT (normalized_name, name_variant) DO NOTHING');
    const linkSql = flattenSql(execute.mock.calls[1]![0]).replace(/\s+/g, ' ');
    expect(linkSql).toContain('HAVING count(*) = 1');
    expect(linkSql).toContain('NOT EXISTS');
    expect(createSeriesSql).not.toContain('DO UPDATE SET');
    expect(createSeriesSql).not.toContain('excluded.name');
  });

  it('runs backfill inside a transaction on initialization', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const tx = { execute } as never;
    const transaction = vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<void>) => cb(tx));
    const service = new SeriesIdentityService({ transaction } as never);
    const backfill = vi.spyOn(service, 'backfillMissingSeriesIds').mockResolvedValue(undefined);
    const backfillMemberships = vi.spyOn(service, 'backfillMissingSeriesMemberships').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledWith(tx);
    expect(backfillMemberships).toHaveBeenCalledTimes(1);
    expect(backfillMemberships).toHaveBeenCalledWith(tx);
  });

  it('disables statement timeout before running backfill', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const tx = { execute } as never;
    const transaction = vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<void>) => cb(tx));
    const service = new SeriesIdentityService({ transaction } as never);
    vi.spyOn(service, 'backfillMissingSeriesIds').mockResolvedValue(undefined);
    vi.spyOn(service, 'backfillMissingSeriesMemberships').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(execute).toHaveBeenCalledTimes(1);
    const timeoutSql = flattenSql(execute.mock.calls[0]![0]);
    expect(timeoutSql).toMatch(/SET LOCAL statement_timeout\s*=\s*0/i);
  });

  it('continues startup and logs error when backfill transaction fails', async () => {
    const transaction = vi.fn().mockRejectedValue(new Error('connection reset'));
    const service = new SeriesIdentityService({ transaction } as never);
    const logError = vi.spyOn(service['logger' as never] as { error: (...args: unknown[]) => void }, 'error').mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const message = logError.mock.calls[0]![0] as string;
    expect(message).toContain('[series.backfill] [fail]');
    expect(message).toContain('connection reset');
  });

  it('does not query for a blank name lookup', async () => {
    const { db, select } = fakeDb();
    const service = new SeriesIdentityService({} as never);

    await expect(service.findIdByName('   ', db)).resolves.toBeNull();

    expect(select).not.toHaveBeenCalled();
  });

  it('does not create a series row for blank names', async () => {
    const { db, insert } = fakeDb();
    const service = new SeriesIdentityService(db);
    await expect(service.resolveSeriesId('   ')).resolves.toBeNull();
    await expect(service.resolveForBook('   ', { bookId: 1 })).resolves.toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('uses the existing series of a name, the automatic one first, without writing', async () => {
    const { db, insert } = fakeDb({ select: [[{ id: 77 }]] });
    const service = new SeriesIdentityService(db);
    await expect(service.resolveSeriesId('  Dune   Chronicles  ')).resolves.toBe(77);
    expect(insert).not.toHaveBeenCalled();
  });

  it('creates a missing series as the automatic one for its name, safe against a concurrent create', async () => {
    const { db, calls } = fakeDb({ select: [[]], insert: [[{ id: 78 }]] });
    const service = new SeriesIdentityService(db);
    await expect(service.resolveSeriesId('Dune')).resolves.toBe(78);
    expect(calls.values![0]![0]).toEqual({ name: 'Dune', normalizedName: 'dune', nameVariant: 0 });
    const conflict = calls.onConflictDoUpdate![0]![0] as { target: unknown[]; set: Record<string, unknown> };
    expect(conflict.target).toHaveLength(2);
    expect(conflict.set).toEqual({ updatedAt: expect.any(Date) });
  });

  describe('resolveForBook', () => {
    it('uses the only series with the name', async () => {
      const service = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }]] }).db);
      await expect(service.resolveForBook('Legacy', { bookId: 1 })).resolves.toEqual({ kind: 'series', seriesId: 5 });
    });

    it('creates the series when no series has the name', async () => {
      const service = new SeriesIdentityService(fakeDb({ select: [[]], insert: [[{ id: 9 }]] }).db);
      await expect(service.resolveForBook('Legacy', { bookId: 1 })).resolves.toEqual({ kind: 'series', seriesId: 9 });
    });

    it('keeps the book in the same-named series it is already in', async () => {
      const service = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }, { id: 6 }]] }).db);
      await expect(service.resolveForBook('Legacy', { bookId: 1, currentSeriesIds: new Set([6]) })).resolves.toEqual({ kind: 'series', seriesId: 6 });
    });

    it('looks up the series the book is in when the caller does not say', async () => {
      const service = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }, { id: 6 }], [{ seriesId: 6 }]] }).db);
      await expect(service.resolveForBook('Legacy', { bookId: 1 })).resolves.toEqual({ kind: 'series', seriesId: 6 });
    });

    it("picks the one same-named series where the book's author already has a book", async () => {
      const service = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }, { id: 6 }], [], [{ seriesId: 5 }]] }).db);
      await expect(service.resolveForBook('Legacy', { bookId: 1 })).resolves.toEqual({ kind: 'series', seriesId: 5 });
    });

    it('leaves the pick to a person when no author or both authors match', async () => {
      const noMatch = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }, { id: 6 }], [], []] }).db);
      await expect(noMatch.resolveForBook('Legacy', { bookId: 1 })).resolves.toEqual({ kind: 'pending' });
      const bothMatch = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }, { id: 6 }], [], [{ seriesId: 5 }, { seriesId: 6 }]] }).db);
      await expect(bothMatch.resolveForBook('Legacy', { bookId: 1 })).resolves.toEqual({ kind: 'pending' });
    });

    it('leaves the pick to a person when there is no book to compare authors with', async () => {
      const service = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }, { id: 6 }]] }).db);
      await expect(service.resolveForBook('Legacy', {})).resolves.toEqual({ kind: 'pending' });
    });
  });

  it('starts a same-named series after the ones that exist', async () => {
    const { db, calls } = fakeDb({ select: [[{ variant: 0 }]], insert: [[{ id: 12 }]] });
    const service = new SeriesIdentityService(db);
    await expect(service.createSeriesVariant(' Legacy ')).resolves.toBe(12);
    expect(calls.values![0]![0]).toEqual({ name: 'Legacy', normalizedName: 'legacy', nameVariant: 1 });
  });

  it('leaves metadata untouched when seriesName is absent or undefined', async () => {
    const { db, insert } = fakeDb();
    const service = new SeriesIdentityService(db);
    const withoutSeries = { title: 'Dune' };
    const undefinedSeries = { title: 'Dune Messiah', seriesName: undefined };
    await expect(service.resolveMetadataPatch(withoutSeries)).resolves.toBe(withoutSeries);
    await expect(service.resolveMetadataPatch(undefinedSeries)).resolves.toBe(undefinedSeries);
    expect(insert).not.toHaveBeenCalled();
  });

  it('adds the resolved series id and tidies the name, or no id while the series waits for a pick', async () => {
    const one = new SeriesIdentityService(fakeDb({ select: [[{ id: 88 }]] }).db);
    await expect(one.resolveMetadataPatch({ bookId: 1, title: 'Caliban War', seriesName: '  The   Expanse  ' })).resolves.toEqual({
      bookId: 1,
      title: 'Caliban War',
      seriesName: 'The Expanse',
      seriesId: 88,
    });
    const two = new SeriesIdentityService(fakeDb({ select: [[{ id: 5 }, { id: 6 }]] }).db);
    await expect(two.resolveMetadataPatch({ seriesName: 'Legacy' })).resolves.toEqual({ seriesName: 'Legacy', seriesId: null });
  });

  it('clears seriesId when metadata clears seriesName', async () => {
    const { db, insert } = fakeDb();
    const service = new SeriesIdentityService(db);
    await expect(service.resolveMetadataPatch({ bookId: 1, seriesName: '   ' })).resolves.toEqual({ bookId: 1, seriesName: null, seriesId: null });
    expect(insert).not.toHaveBeenCalled();
  });

  it('finds an id by name only when exactly one series has it', async () => {
    const service = new SeriesIdentityService({} as never);
    await expect(service.findIdByName('  DUNE  ', fakeDb({ select: [[{ id: 91 }]] }).db)).resolves.toBe(91);
    await expect(service.findIdByName('Dune', fakeDb({ select: [[]] }).db)).resolves.toBeNull();
    await expect(service.findIdByName('Legacy', fakeDb({ select: [[{ id: 5 }, { id: 6 }]] }).db)).resolves.toBeNull();
  });
});
