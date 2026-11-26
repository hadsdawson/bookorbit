import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, bookSeries, bookSeriesMemberships, bookSeriesPending, books } from '../../db/schema';
import { SeriesIdentityService } from './series-identity.service';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type SeriesMembershipExecutor = Pick<Db, 'delete' | 'insert' | 'select' | 'update'> | DbTransaction;
type SeriesResolveExecutor = Pick<Db, 'insert' | 'select'> | DbTransaction;
type SeriesMembershipReadExecutor = Pick<Db, 'select'> | DbTransaction;

export type SeriesMembershipInput = {
  seriesName: string | null;
  seriesIndex?: string | null;
  /** Fork: the exact series a person picked; ignored when it no longer carries this name. */
  seriesId?: number | null;
  /** Fork: start a new series of this name beside any that already have it. */
  newSeries?: boolean;
};

/** Fork: a series the book names that could not be told apart from another of the same name. */
export type SeriesPendingRef = {
  seriesName: string;
  seriesIndex: string | null;
  /** Position among everything the book named; 0 is its main series. */
  displayOrder: number;
};

export type SeriesMembershipRef = {
  seriesId: number;
  seriesName: string;
  seriesIndex: string | null;
  displayOrder: number;
  expectedBookCount: number | null;
};

@Injectable()
export class SeriesMembershipService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly seriesIdentity: SeriesIdentityService,
  ) {}

  async replaceForBook(
    bookId: number,
    memberships: readonly SeriesMembershipInput[] | null | undefined,
    executor: SeriesMembershipExecutor = this.db,
  ): Promise<SeriesMembershipRef[]> {
    const current = await this.findByBookId(bookId, executor);
    const { resolved, pending } = await this.resolveMemberships(bookId, memberships ?? [], new Set(current.map((m) => m.seriesId)), executor);

    await executor.delete(bookSeriesMemberships).where(eq(bookSeriesMemberships.bookId, bookId));
    await executor.delete(bookSeriesPending).where(eq(bookSeriesPending.bookId, bookId));

    if (resolved.length > 0) {
      await executor.insert(bookSeriesMemberships).values(
        resolved.map((membership) => ({
          bookId,
          seriesId: membership.seriesId,
          seriesIndex: membership.seriesIndex,
          displayOrder: membership.displayOrder,
        })),
      );
    }
    if (pending.length > 0) {
      await executor.insert(bookSeriesPending).values(pending.map((entry) => ({ bookId, ...entry })));
    }

    await this.syncPrimaryMetadata(bookId, resolved, executor, pending);
    return resolved;
  }

  async syncPrimaryFromMetadata(bookId: number, executor: SeriesMembershipExecutor = this.db): Promise<SeriesMembershipRef[]> {
    const [metadata] = await executor
      .select({
        seriesId: bookMetadata.seriesId,
        seriesName: bookMetadata.seriesName,
        seriesIndex: bookMetadata.seriesIndex,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);

    const current = await this.findByBookId(bookId, executor);
    const pendingNow = await this.findPendingByBookId(bookId, executor);
    // Fork: the other series keep their exact ids, and those still waiting for a pick stay waiting.
    const ordered: Array<{ order: number; input: SeriesMembershipInput }> = [
      ...current
        .filter((membership) => membership.displayOrder !== 0)
        .map((membership) => ({
          order: membership.displayOrder,
          input: { seriesId: membership.seriesId, seriesName: membership.seriesName, seriesIndex: membership.seriesIndex },
        })),
      ...pendingNow
        .filter((entry) => entry.displayOrder !== 0)
        .map((entry) => ({ order: entry.displayOrder, input: { seriesName: entry.seriesName, seriesIndex: entry.seriesIndex } })),
    ];
    const rest = ordered.sort((a, b) => a.order - b.order).map((entry) => entry.input);
    const displayName = this.seriesIdentity.normalizeDisplayName(metadata?.seriesName);

    if (!displayName) return this.replaceForBook(bookId, rest, executor);

    return this.replaceForBook(
      bookId,
      [{ seriesId: metadata?.seriesId ?? null, seriesName: displayName, seriesIndex: metadata?.seriesIndex ?? null }, ...rest],
      executor,
    );
  }

  async syncPrimaryFromMetadataForBooks(bookIds: number[], executor: SeriesMembershipExecutor = this.db): Promise<void> {
    for (const bookId of bookIds) {
      await this.syncPrimaryFromMetadata(bookId, executor);
    }
  }

  async findByBookId(bookId: number, executor: SeriesMembershipReadExecutor = this.db): Promise<SeriesMembershipRef[]> {
    const map = await this.findByBookIds([bookId], executor);
    return map.get(bookId) ?? [];
  }

  async findByBookIds(bookIds: number[], executor: SeriesMembershipReadExecutor = this.db): Promise<Map<number, SeriesMembershipRef[]>> {
    const result = new Map<number, SeriesMembershipRef[]>();
    if (bookIds.length === 0) return result;

    const rows = await executor
      .select({
        bookId: bookSeriesMemberships.bookId,
        seriesId: bookSeriesMemberships.seriesId,
        seriesName: bookSeries.name,
        seriesIndex: bookSeriesMemberships.seriesIndex,
        displayOrder: bookSeriesMemberships.displayOrder,
        expectedBookCount: bookSeries.expectedBookCount,
      })
      .from(bookSeriesMemberships)
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .where(inArray(bookSeriesMemberships.bookId, bookIds))
      .orderBy(asc(bookSeriesMemberships.bookId), asc(bookSeriesMemberships.displayOrder), asc(bookSeriesMemberships.seriesId));

    for (const row of rows) {
      const list = result.get(row.bookId) ?? [];
      list.push({
        seriesId: row.seriesId,
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        displayOrder: row.displayOrder,
        expectedBookCount: row.expectedBookCount ?? null,
      });
      result.set(row.bookId, list);
    }

    return result;
  }

  /** Fork: the series each book names but that still need a person to pick which one. */
  async findPendingByBookIds(bookIds: number[], executor: SeriesMembershipReadExecutor = this.db): Promise<Map<number, SeriesPendingRef[]>> {
    const result = new Map<number, SeriesPendingRef[]>();
    if (bookIds.length === 0) return result;
    const rows = await executor
      .select({
        bookId: bookSeriesPending.bookId,
        seriesName: bookSeriesPending.seriesName,
        seriesIndex: bookSeriesPending.seriesIndex,
        displayOrder: bookSeriesPending.displayOrder,
      })
      .from(bookSeriesPending)
      .where(inArray(bookSeriesPending.bookId, bookIds))
      .orderBy(asc(bookSeriesPending.bookId), asc(bookSeriesPending.displayOrder));
    for (const { bookId, ...entry } of rows) {
      const list = result.get(bookId) ?? [];
      list.push(entry);
      result.set(bookId, list);
    }
    return result;
  }

  async findPendingByBookId(bookId: number, executor: SeriesMembershipReadExecutor = this.db): Promise<SeriesPendingRef[]> {
    return (await this.findPendingByBookIds([bookId], executor)).get(bookId) ?? [];
  }

  async backfillFromMetadata(executor: Pick<Db, 'execute'> = this.db): Promise<void> {
    await executor.execute(sql`
      INSERT INTO ${bookSeriesMemberships} (book_id, series_id, series_index, display_order)
      SELECT ${bookMetadata.bookId}, ${bookMetadata.seriesId}, ${bookMetadata.seriesIndex}, 0
      FROM ${bookMetadata}
      WHERE ${bookMetadata.seriesId} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ${bookSeriesMemberships}
          WHERE ${bookSeriesMemberships.bookId} = ${bookMetadata.bookId}
        )
      ON CONFLICT DO NOTHING
    `);
  }

  async syncPrimaryMetadata(
    bookId: number,
    memberships: readonly SeriesMembershipRef[],
    executor: SeriesMembershipExecutor = this.db,
    pending: readonly SeriesPendingRef[] = [],
  ): Promise<void> {
    // Fork: a main series still waiting for a pick keeps its name and number but no series id.
    const pendingPrimary = pending.find((entry) => entry.displayOrder === 0) ?? null;
    const primary = pendingPrimary ? null : (memberships[0] ?? null);
    await executor
      .update(bookMetadata)
      .set({
        seriesId: primary?.seriesId ?? null,
        seriesName: primary?.seriesName ?? pendingPrimary?.seriesName ?? null,
        seriesIndex: primary?.seriesIndex ?? pendingPrimary?.seriesIndex ?? null,
        updatedAt: new Date(),
      })
      .where(eq(bookMetadata.bookId, bookId));
    await executor.update(books).set({ updatedAt: new Date() }).where(eq(books.id, bookId));
  }

  /**
   * Fork. Each named series becomes an exact series (a picked id, a new series, or one name match),
   * or waits for a person when it matches several series that share the name.
   */
  private async resolveMemberships(
    bookId: number,
    memberships: readonly SeriesMembershipInput[],
    currentSeriesIds: ReadonlySet<number>,
    executor: SeriesResolveExecutor,
  ): Promise<{ resolved: SeriesMembershipRef[]; pending: SeriesPendingRef[] }> {
    const resolved: SeriesMembershipRef[] = [];
    const pending: SeriesPendingRef[] = [];
    const seenIds = new Set<number>();
    const seenPending = new Set<string>();
    let position = 0;

    for (const membership of memberships) {
      const displayName = this.seriesIdentity.normalizeDisplayName(membership.seriesName);
      const normalizedName = this.seriesIdentity.normalizeName(displayName);
      if (!displayName || !normalizedName) continue;
      const seriesIndex = membership.seriesIndex ?? null;

      const seriesId = await this.pickSeriesId(bookId, membership, displayName, normalizedName, currentSeriesIds, executor);
      if (seriesId === 'pending') {
        if (seenPending.has(normalizedName)) continue;
        seenPending.add(normalizedName);
        pending.push({ seriesName: displayName, seriesIndex, displayOrder: position });
        position += 1;
        continue;
      }
      if (seriesId == null || seenIds.has(seriesId)) continue;

      seenIds.add(seriesId);
      resolved.push({ seriesId, seriesName: displayName, seriesIndex, displayOrder: resolved.length, expectedBookCount: null });
      position += 1;
    }

    return { resolved, pending };
  }

  private async pickSeriesId(
    bookId: number,
    membership: SeriesMembershipInput,
    displayName: string,
    normalizedName: string,
    currentSeriesIds: ReadonlySet<number>,
    executor: SeriesResolveExecutor,
  ): Promise<number | 'pending' | null> {
    if (membership.seriesId != null) {
      const [row] = await executor
        .select({ id: bookSeries.id })
        .from(bookSeries)
        .where(and(eq(bookSeries.id, membership.seriesId), eq(bookSeries.normalizedName, normalizedName)))
        .limit(1);
      if (row) return row.id;
    }
    if (membership.newSeries) return this.seriesIdentity.createSeriesVariant(displayName, executor);

    const match = await this.seriesIdentity.resolveForBook(displayName, { bookId, currentSeriesIds }, executor);
    if (!match) return null;
    return match.kind === 'series' ? match.seriesId : 'pending';
  }
}
