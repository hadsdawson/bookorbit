import { SeriesMembershipService } from './series-membership.service';
import { normalizeMetadataText, normalizeMetadataTextKey } from '../utils/metadata-text-normalize.utils';

/** Names resolve through this map; a name mapped to 'pending' matches several series and waits for a pick. */
function makeSeriesIdentity(ids: Record<string, number | 'pending'>, variants: number[] = []) {
  return {
    normalizeDisplayName: vi.fn((name: string | null | undefined) => normalizeMetadataText(name)),
    normalizeName: vi.fn((name: string | null | undefined) => normalizeMetadataTextKey(name)),
    resolveForBook: vi.fn((name: string | null | undefined) => {
      const match = ids[normalizeMetadataTextKey(name) ?? ''];
      if (match === undefined) return Promise.resolve(null);
      return Promise.resolve(match === 'pending' ? { kind: 'pending' } : { kind: 'series', seriesId: match });
    }),
    createSeriesVariant: vi.fn(() => Promise.resolve(variants.shift() ?? null)),
  };
}

/**
 * A stand-in for the query builder: chained calls return the same query, and awaiting a select
 * yields the next queued rows. Writes are recorded by table position: delete/insert/update calls.
 */
function fakeDb(selectResults: unknown[][] = []) {
  const queue = [...selectResults];
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'orderBy', 'limit', 'innerJoin']) q[method] = vi.fn(() => q);
    q.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(resolve, reject);
    return q;
  };
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const db = {
    select: vi.fn(() => query()),
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
  };
  return { db: db as never, raw: db, deleteWhere, insertValues, updateSet };
}

describe('SeriesMembershipService', () => {
  it('replaces memberships with normalized unique series and syncs primary scalar metadata', async () => {
    const identity = makeSeriesIdentity({ dune: 101, 'the expanse': 202 });
    const { db, raw, insertValues, updateSet } = fakeDb();
    const service = new SeriesMembershipService(db, identity as never);

    const result = await service.replaceForBook(
      10,
      [
        { seriesName: '  Dune  ', seriesIndex: '1' },
        { seriesName: 'dune', seriesIndex: '2' },
        { seriesName: 'The   Expanse', seriesIndex: '5' },
        { seriesName: 'The Expanse', seriesIndex: null },
        { seriesName: '   ', seriesIndex: '3' },
      ],
      db,
    );

    expect(result).toEqual([
      { seriesId: 101, seriesName: 'Dune', seriesIndex: '1', displayOrder: 0, expectedBookCount: null },
      { seriesId: 202, seriesName: 'The Expanse', seriesIndex: '5', displayOrder: 1, expectedBookCount: null },
    ]);
    expect(raw.delete).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith([
      { bookId: 10, seriesId: 101, seriesIndex: '1', displayOrder: 0 },
      { bookId: 10, seriesId: 202, seriesIndex: '5', displayOrder: 1 },
    ]);
    expect(updateSet).toHaveBeenNthCalledWith(1, { seriesId: 101, seriesName: 'Dune', seriesIndex: '1', updatedAt: expect.any(Date) });
    expect(updateSet).toHaveBeenNthCalledWith(2, { updatedAt: expect.any(Date) });
  });

  it('does not insert membership rows when replacement normalizes to empty', async () => {
    const identity = makeSeriesIdentity({});
    const { db, raw, updateSet } = fakeDb();
    const service = new SeriesMembershipService(db, identity as never);

    await expect(service.replaceForBook(10, [{ seriesName: 'unknown' }], db)).resolves.toEqual([]);

    expect(raw.insert).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenNthCalledWith(1, { seriesId: null, seriesName: null, seriesIndex: null, updatedAt: expect.any(Date) });
  });

  it('keeps a picked series when it still carries the name, without matching by name', async () => {
    const identity = makeSeriesIdentity({ legacy: 'pending' });
    const { db, insertValues } = fakeDb([[], [{ id: 6 }]]);
    const service = new SeriesMembershipService(db, identity as never);

    const result = await service.replaceForBook(10, [{ seriesName: 'Legacy', seriesIndex: '2', seriesId: 6 }], db);

    expect(result.map((ref) => ref.seriesId)).toEqual([6]);
    expect(identity.resolveForBook).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith([{ bookId: 10, seriesId: 6, seriesIndex: '2', displayOrder: 0 }]);
  });

  it('matches by name again when a picked series no longer carries the name', async () => {
    const identity = makeSeriesIdentity({ legacy: 5 });
    const { db } = fakeDb([[], []]);
    const service = new SeriesMembershipService(db, identity as never);

    const result = await service.replaceForBook(10, [{ seriesName: 'Legacy', seriesId: 99 }], db);

    expect(result.map((ref) => ref.seriesId)).toEqual([5]);
  });

  it('starts a new same-named series when asked', async () => {
    const identity = makeSeriesIdentity({ legacy: 5 }, [12]);
    const { db } = fakeDb();
    const service = new SeriesMembershipService(db, identity as never);

    const result = await service.replaceForBook(10, [{ seriesName: 'Legacy', newSeries: true }], db);

    expect(result.map((ref) => ref.seriesId)).toEqual([12]);
    expect(identity.resolveForBook).not.toHaveBeenCalled();
  });

  it('holds a series that matches several same-named ones, keeping its name as the main series', async () => {
    const identity = makeSeriesIdentity({ legacy: 'pending', 'other series': 7 });
    const { db, insertValues, updateSet } = fakeDb();
    const service = new SeriesMembershipService(db, identity as never);

    const result = await service.replaceForBook(
      10,
      [
        { seriesName: 'Legacy', seriesIndex: '1' },
        { seriesName: 'Other Series', seriesIndex: '3' },
      ],
      db,
    );

    expect(result).toEqual([{ seriesId: 7, seriesName: 'Other Series', seriesIndex: '3', displayOrder: 0, expectedBookCount: null }]);
    expect(insertValues).toHaveBeenNthCalledWith(1, [{ bookId: 10, seriesId: 7, seriesIndex: '3', displayOrder: 0 }]);
    expect(insertValues).toHaveBeenNthCalledWith(2, [{ bookId: 10, seriesName: 'Legacy', seriesIndex: '1', displayOrder: 0 }]);
    expect(updateSet).toHaveBeenNthCalledWith(1, { seriesId: null, seriesName: 'Legacy', seriesIndex: '1', updatedAt: expect.any(Date) });
  });

  it('promotes remaining memberships when legacy scalar metadata is cleared', async () => {
    const identity = makeSeriesIdentity({});
    const { db } = fakeDb([
      [{ seriesName: null, seriesIndex: null, seriesId: null }],
      [
        { bookId: 7, seriesId: 1, seriesName: 'Primary', seriesIndex: '1', displayOrder: 0, expectedBookCount: null },
        { bookId: 7, seriesId: 2, seriesName: 'Rest', seriesIndex: '2', displayOrder: 1, expectedBookCount: null },
      ],
      [],
    ]);
    const service = new SeriesMembershipService(db, identity as never);
    const replaceForBook = vi.spyOn(service, 'replaceForBook').mockResolvedValue([]);

    await service.syncPrimaryFromMetadata(7, db);

    expect(replaceForBook).toHaveBeenCalledWith(7, [{ seriesId: 2, seriesName: 'Rest', seriesIndex: '2' }], db);
  });

  it('keeps exact series and still-waiting series when the main series is rewritten', async () => {
    const identity = makeSeriesIdentity({});
    const { db } = fakeDb([
      [{ seriesName: 'Legacy', seriesIndex: '1', seriesId: 6 }],
      [{ bookId: 7, seriesId: 6, seriesName: 'Legacy', seriesIndex: '1', displayOrder: 0, expectedBookCount: null }],
      [{ bookId: 7, seriesName: 'Twisted Tales', seriesIndex: '4', displayOrder: 1 }],
    ]);
    const service = new SeriesMembershipService(db, identity as never);
    const replaceForBook = vi.spyOn(service, 'replaceForBook').mockResolvedValue([]);

    await service.syncPrimaryFromMetadata(7, db);

    expect(replaceForBook).toHaveBeenCalledWith(
      7,
      [
        { seriesId: 6, seriesName: 'Legacy', seriesIndex: '1' },
        { seriesName: 'Twisted Tales', seriesIndex: '4' },
      ],
      db,
    );
  });
});
