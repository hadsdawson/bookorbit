import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookAuthors, bookMetadata, bookSeries, bookSeriesMemberships, bookSeriesPending } from '../../db/schema';
import { sanitizeLogValue } from '../utils/log-sanitize.utils';
import {
  normalizeMetadataText,
  normalizeMetadataTextKey,
  normalizeMetadataTextKeySql,
  normalizeMetadataTextOrNullSql,
} from '../utils/metadata-text-normalize.utils';

type Db = NodePgDatabase<typeof schema>;
type SeriesWriteExecutor = Pick<Db, 'insert' | 'select'>;

/** Fork: what a series name resolved to for one book. */
export type SeriesMatch = { kind: 'series'; seriesId: number } | { kind: 'pending' };

/** Fork: what is known about the book a series name is being resolved for. */
export type SeriesMatchContext = {
  /** The book being saved; its authors decide between series that share a name. */
  bookId?: number | null;
  /** Series the book is already in: when one of them has this name, the book stays in it. */
  currentSeriesIds?: ReadonlySet<number>;
};

@Injectable()
export class SeriesIdentityService implements OnModuleInit {
  private readonly logger = new Logger(SeriesIdentityService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    const start = Date.now();
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = 0`);
        await this.backfillMissingSeriesIds(tx);
        await this.backfillMissingSeriesMemberships(tx);
      });
      this.logger.log(`[series.backfill] [end] durationMs=${Date.now() - start} - series id and membership backfill completed`);
    } catch (err) {
      const e = err as Error & { cause?: unknown };
      const cause = e.cause instanceof Error ? e.cause.message : e.message;
      this.logger.error(
        `[series.backfill] [fail] durationMs=${Date.now() - start} errorClass=${e.name} error="${sanitizeLogValue(cause)}" - series id backfill failed; continuing startup`,
      );
    }
  }

  normalizeName(name: string | null | undefined): string | null {
    return normalizeMetadataTextKey(name);
  }

  normalizeDisplayName(name: string | null | undefined): string | null {
    return normalizeMetadataText(name);
  }

  /**
   * The series of this name that automatic matching uses (variant 0), created if no series has the
   * name. Callers that know which book the name is for use {@link resolveForBook}, which can tell
   * series that share a name apart.
   */
  async resolveSeriesId(name: string | null | undefined, executor: SeriesWriteExecutor = this.db): Promise<number | null> {
    const displayName = this.normalizeDisplayName(name);
    const normalizedName = this.normalizeName(displayName);
    if (!displayName || !normalizedName) return null;

    const [existing] = await executor
      .select({ id: bookSeries.id })
      .from(bookSeries)
      .where(eq(bookSeries.normalizedName, normalizedName))
      .orderBy(asc(bookSeries.nameVariant), asc(bookSeries.id))
      .limit(1);
    if (existing) return existing.id;

    return this.createDefaultSeries(displayName, normalizedName, executor);
  }

  /**
   * Fork. Which series a book means by a series name. One series of that name, or none (it is
   * created): that one. Several: the one the book is already in, else the only one where one of the
   * book's authors already has a book. Anything else is left for a person to pick, so nothing is
   * filed under a guess.
   */
  async resolveForBook(
    name: string | null | undefined,
    context: SeriesMatchContext,
    executor: SeriesWriteExecutor = this.db,
  ): Promise<SeriesMatch | null> {
    const displayName = this.normalizeDisplayName(name);
    const normalizedName = this.normalizeName(displayName);
    if (!displayName || !normalizedName) return null;

    const candidates = await this.findIdsByName(normalizedName, executor);
    if (candidates.length === 0) {
      const seriesId = await this.createDefaultSeries(displayName, normalizedName, executor);
      return seriesId == null ? null : { kind: 'series', seriesId };
    }
    if (candidates.length === 1) return { kind: 'series', seriesId: candidates[0]! };

    const currentSeriesIds =
      context.currentSeriesIds ?? (context.bookId != null ? await this.findSeriesIdsOfBook(context.bookId, executor) : undefined);
    const current = candidates.filter((id) => currentSeriesIds?.has(id));
    if (current.length === 1) return { kind: 'series', seriesId: current[0]! };

    if (context.bookId != null) {
      const byAuthor = await this.findSeriesSharingAuthors(context.bookId, candidates, executor);
      if (byAuthor.length === 1) return { kind: 'series', seriesId: byAuthor[0]! };
    }
    return { kind: 'pending' };
  }

  /** Fork. A new series with this name beside any that already have it, for a person who asked for one. */
  async createSeriesVariant(name: string, executor: SeriesWriteExecutor = this.db): Promise<number | null> {
    const displayName = this.normalizeDisplayName(name);
    const normalizedName = this.normalizeName(displayName);
    if (!displayName || !normalizedName) return null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [top] = await executor
        .select({ variant: max(bookSeries.nameVariant) })
        .from(bookSeries)
        .where(eq(bookSeries.normalizedName, normalizedName));
      const nameVariant = top?.variant == null ? 0 : top.variant + 1;
      const [row] = await executor
        .insert(bookSeries)
        .values({ name: displayName, normalizedName, nameVariant })
        .onConflictDoNothing()
        .returning({ id: bookSeries.id });
      if (row) return row.id;
    }
    return null;
  }

  /** Fork. Every series with this (already normalized) name, the automatic one first. */
  async findIdsByName(normalizedName: string, executor: Pick<Db, 'select'> = this.db): Promise<number[]> {
    const rows = await executor
      .select({ id: bookSeries.id })
      .from(bookSeries)
      .where(eq(bookSeries.normalizedName, normalizedName))
      .orderBy(asc(bookSeries.nameVariant), asc(bookSeries.id));
    return rows.map((row) => row.id);
  }

  private async createDefaultSeries(displayName: string, normalizedName: string, executor: SeriesWriteExecutor): Promise<number | null> {
    const [row] = await executor
      .insert(bookSeries)
      .values({ name: displayName, normalizedName, nameVariant: 0 })
      .onConflictDoUpdate({
        target: [bookSeries.normalizedName, bookSeries.nameVariant],
        set: { updatedAt: new Date() },
      })
      .returning({ id: bookSeries.id });
    return row?.id ?? null;
  }

  private async findSeriesIdsOfBook(bookId: number, executor: Pick<Db, 'select'>): Promise<Set<number>> {
    const rows = await executor
      .select({ seriesId: bookSeriesMemberships.seriesId })
      .from(bookSeriesMemberships)
      .where(eq(bookSeriesMemberships.bookId, bookId));
    return new Set(rows.map((row) => row.seriesId));
  }

  /** The candidate series that hold a book by one of this book's authors. */
  private async findSeriesSharingAuthors(bookId: number, candidates: number[], executor: Pick<Db, 'select'>): Promise<number[]> {
    const ownAuthors = executor.select({ authorId: bookAuthors.authorId }).from(bookAuthors).where(eq(bookAuthors.bookId, bookId));
    const rows = await executor
      .select({ seriesId: bookSeriesMemberships.seriesId })
      .from(bookSeriesMemberships)
      .innerJoin(bookAuthors, eq(bookAuthors.bookId, bookSeriesMemberships.bookId))
      .where(
        and(
          inArray(bookSeriesMemberships.seriesId, candidates),
          inArray(bookAuthors.authorId, ownAuthors),
          sql`${bookSeriesMemberships.bookId} <> ${bookId}`,
        ),
      )
      .groupBy(bookSeriesMemberships.seriesId);
    return rows.map((row) => row.seriesId);
  }

  async resolveMetadataPatch<T extends Partial<typeof bookMetadata.$inferInsert>>(
    fields: T,
    executor: SeriesWriteExecutor = this.db,
    context: SeriesMatchContext = {},
  ): Promise<T> {
    if (!Object.prototype.hasOwnProperty.call(fields, 'seriesName') || fields.seriesName === undefined) {
      return fields;
    }

    const displayName = this.normalizeDisplayName(fields.seriesName);
    const match = await this.resolveForBook(displayName, context, executor);
    const seriesId = match?.kind === 'series' ? match.seriesId : null;
    return { ...fields, seriesName: displayName, seriesId };
  }

  async backfillMissingSeriesIds(executor: Pick<Db, 'execute'> = this.db): Promise<void> {
    await executor.execute(sql`
      WITH normalized AS (
        SELECT ${normalizeMetadataTextOrNullSql(bookMetadata.seriesName)} AS display_name
        FROM ${bookMetadata}
        WHERE ${bookMetadata.seriesName} IS NOT NULL
      )
      INSERT INTO book_series (name, normalized_name, name_variant)
      SELECT min(display_name), ${normalizeMetadataTextKeySql(sql`display_name`)}, 0
      FROM normalized
      WHERE display_name IS NOT NULL
      GROUP BY ${normalizeMetadataTextKeySql(sql`display_name`)}
      ON CONFLICT (normalized_name, name_variant)
      DO NOTHING
    `);

    // Fork: only books with no series id yet, and only where one series has the name. A book whose
    // name matches several series keeps no id until someone picks; re-pointing linked books here
    // would move them between series that share a name on every start.
    await executor.execute(sql`
      WITH normalized AS (
        SELECT
          ${bookMetadata.bookId} AS book_id,
          ${normalizeMetadataTextOrNullSql(bookMetadata.seriesName)} AS display_name
        FROM ${bookMetadata}
        WHERE ${bookMetadata.seriesId} IS NULL
      ),
      unique_names AS (
        SELECT ${bookSeries.normalizedName} AS normalized_name, min(${bookSeries.id}) AS series_id
        FROM ${bookSeries}
        GROUP BY ${bookSeries.normalizedName}
        HAVING count(*) = 1
      )
      UPDATE ${bookMetadata}
      SET series_id = unique_names.series_id
      FROM normalized, unique_names
      WHERE ${bookMetadata.bookId} = normalized.book_id
        AND normalized.display_name IS NOT NULL
        AND ${normalizeMetadataTextKeySql(sql`normalized.display_name`)} = unique_names.normalized_name
        AND NOT EXISTS (
          SELECT 1 FROM ${bookSeriesPending}
          WHERE ${bookSeriesPending.bookId} = ${bookMetadata.bookId} AND ${bookSeriesPending.displayOrder} = 0
        )
    `);

    await executor.execute(sql`
      UPDATE ${bookMetadata}
      SET series_id = NULL
      WHERE (${bookMetadata.seriesName} IS NULL OR ${normalizeMetadataTextOrNullSql(bookMetadata.seriesName)} IS NULL)
        AND ${bookMetadata.seriesId} IS NOT NULL
    `);
  }

  async backfillMissingSeriesMemberships(executor: Pick<Db, 'execute'> = this.db): Promise<void> {
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

  /** The series with this name, when exactly one has it; null when none or several do. */
  async findIdByName(name: string, executor: Pick<Db, 'select'> = this.db): Promise<number | null> {
    const normalizedName = this.normalizeName(name);
    if (!normalizedName) return null;
    const ids = await this.findIdsByName(normalizedName, executor);
    return ids.length === 1 ? ids[0]! : null;
  }
}
