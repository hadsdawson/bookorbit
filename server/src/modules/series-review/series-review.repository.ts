import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules, SeriesReviewReason, SeriesReviewView } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookMetadata, books, bookSeriesPending, seriesReviewDismissals } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

type Scope = { libraryIds: number[]; contentFilters?: ContentFilterRules };

export type MixedSeriesRow = {
  id: number;
  name: string;
  bookCount: number;
  reasons: SeriesReviewReason[];
  repeatedNumbers: string[];
  markedFine: boolean;
};

export type WaitingBookRow = {
  bookId: number;
  title: string;
  seriesName: string;
  seriesIndex: string | null;
  displayOrder: number;
};

const REPEATED_NUMBER_LIMIT = 5;

const NUMERIC_INDEX_SQL = (column: SQL) => sql`CASE WHEN ${column} ~ '^[0-9]+(\\.[0-9]+)?$' THEN ${column}::numeric END`;

@Injectable()
export class SeriesReviewRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private scopeWhere(scope: Scope): SQL {
    const filterClauses = scope.contentFilters ? buildContentFilterClauses(scope.contentFilters, this.db) : [];
    return and(inArray(books.libraryId, scope.libraryIds), ...filterClauses) ?? sql`true`;
  }

  /**
   * Series whose books look like two real series: the same number on books with no author in
   * common, or authors who never wrote a book in the series together (found by walking co-author
   * links from one author; anyone not reached is unrelated). Counted over the books in scope.
   */
  async findMixed(
    scope: Scope,
    params: { view: SeriesReviewView; page: number; size: number },
  ): Promise<{ items: MixedSeriesRow[]; counts: { open: number; fine: number } }> {
    const viewFilter = params.view === 'fine' ? sql`marked_fine` : sql`NOT marked_fine`;
    const result = await this.db.execute<{ counts: { open: number; fine: number }; items: MixedSeriesRow[] | null }>(sql`
      WITH RECURSIVE scoped AS (
        SELECT book_series_memberships.series_id, book_series_memberships.book_id, book_series_memberships.series_index
        FROM ${books}
        JOIN book_series_memberships ON book_series_memberships.book_id = ${books.id}
        WHERE ${this.scopeWhere(scope)}
      ),
      series_authors AS (
        SELECT DISTINCT s.series_id, s.book_id, ba.author_id
        FROM scoped s
        JOIN book_authors ba ON ba.book_id = s.book_id
      ),
      repeated AS (
        SELECT a.series_id, a.series_index
        FROM scoped a
        JOIN scoped b ON b.series_id = a.series_id AND b.series_index = a.series_index AND b.book_id > a.book_id
        WHERE a.series_index IS NOT NULL
          AND EXISTS (SELECT 1 FROM book_authors x WHERE x.book_id = a.book_id)
          AND EXISTS (SELECT 1 FROM book_authors y WHERE y.book_id = b.book_id)
          AND NOT EXISTS (
            SELECT 1 FROM book_authors x
            JOIN book_authors y ON y.author_id = x.author_id
            WHERE x.book_id = a.book_id AND y.book_id = b.book_id
          )
        GROUP BY a.series_id, a.series_index
      ),
      author_counts AS (
        SELECT series_id, count(DISTINCT author_id) AS author_count, min(author_id) AS first_author
        FROM series_authors
        GROUP BY series_id
        HAVING count(DISTINCT author_id) > 1
      ),
      edges AS (
        SELECT DISTINCT x.series_id, x.author_id AS from_author, y.author_id AS to_author
        FROM series_authors x
        JOIN series_authors y ON y.series_id = x.series_id AND y.book_id = x.book_id AND y.author_id <> x.author_id
        WHERE x.series_id IN (SELECT series_id FROM author_counts)
      ),
      reach (series_id, author_id) AS (
        SELECT series_id, first_author FROM author_counts
        UNION
        SELECT e.series_id, e.to_author
        FROM reach r
        JOIN edges e ON e.series_id = r.series_id AND e.from_author = r.author_id
      ),
      unrelated AS (
        SELECT ac.series_id
        FROM author_counts ac
        JOIN (SELECT series_id, count(*) AS reached FROM reach GROUP BY series_id) r ON r.series_id = ac.series_id
        WHERE r.reached < ac.author_count
      ),
      flagged AS (
        SELECT series_id, bool_or(kind = 'repeated') AS repeated, bool_or(kind = 'unrelated') AS unrelated
        FROM (
          SELECT DISTINCT series_id, 'repeated' AS kind FROM repeated
          UNION ALL
          SELECT series_id, 'unrelated' AS kind FROM unrelated
        ) reasons
        GROUP BY series_id
      ),
      listed AS (
        SELECT f.series_id, f.repeated, f.unrelated, bs.name, bs.name_sort_key, (d.series_id IS NOT NULL) AS marked_fine
        FROM flagged f
        JOIN book_series bs ON bs.id = f.series_id
        LEFT JOIN series_review_dismissals d ON d.series_id = f.series_id
      )
      SELECT
        (SELECT json_build_object(
          'open', count(*) FILTER (WHERE NOT marked_fine),
          'fine', count(*) FILTER (WHERE marked_fine)
        ) FROM listed) AS counts,
        (SELECT json_agg(page ORDER BY page.sort_repeated DESC, page.sort_name, page.id) FROM (
          SELECT
            l.series_id AS id,
            l.name,
            l.repeated AS sort_repeated,
            l.name_sort_key AS sort_name,
            l.marked_fine AS "markedFine",
            (SELECT count(DISTINCT s.book_id) FROM scoped s WHERE s.series_id = l.series_id)::int AS "bookCount",
            array_remove(ARRAY[
              CASE WHEN l.repeated THEN 'repeatedNumber' END,
              CASE WHEN l.unrelated THEN 'unrelatedAuthors' END
            ], NULL) AS reasons,
            COALESCE((
              SELECT array_agg(n.series_index ORDER BY ${NUMERIC_INDEX_SQL(sql`n.series_index`)} NULLS LAST, n.series_index)
              FROM (
                SELECT r.series_index FROM repeated r
                WHERE r.series_id = l.series_id
                ORDER BY ${NUMERIC_INDEX_SQL(sql`r.series_index`)} NULLS LAST, r.series_index
                LIMIT ${REPEATED_NUMBER_LIMIT}
              ) n
            ), ARRAY[]::varchar[]) AS "repeatedNumbers"
          FROM listed l
          WHERE ${viewFilter}
          ORDER BY l.repeated DESC, l.name_sort_key, l.series_id
          LIMIT ${params.size} OFFSET ${params.page * params.size}
        ) page) AS items
    `);
    const row = result.rows[0];
    const items = (row?.items ?? []).map((item) => ({
      id: Number(item.id),
      name: item.name,
      bookCount: Number(item.bookCount),
      reasons: item.reasons,
      repeatedNumbers: item.repeatedNumbers,
      markedFine: item.markedFine,
    }));
    return { items, counts: { open: Number(row?.counts?.open ?? 0), fine: Number(row?.counts?.fine ?? 0) } };
  }

  /** Up to three author names per series, most books first, and how many more there are. */
  async findAuthors(seriesIds: number[], scope: Scope): Promise<Map<number, string[]>> {
    if (seriesIds.length === 0) return new Map();
    const rows = await this.db.execute<{ seriesId: number; name: string }>(sql`
      SELECT bsm.series_id AS "seriesId", ${authors.name} AS name
      FROM ${books}
      JOIN book_series_memberships bsm ON bsm.book_id = ${books.id}
      JOIN ${bookAuthors} ON ${bookAuthors.bookId} = ${books.id}
      JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId}
      WHERE bsm.series_id IN (${sql.join(
        seriesIds.map((id) => sql`${id}`),
        sql`, `,
      )}) AND ${this.scopeWhere(scope)}
      GROUP BY bsm.series_id, ${authors.name}
      ORDER BY bsm.series_id, count(DISTINCT ${books.id}) DESC, ${authors.name}
    `);
    const result = new Map<number, string[]>();
    for (const row of rows.rows) {
      const id = Number(row.seriesId);
      result.set(id, [...(result.get(id) ?? []), row.name]);
    }
    return result;
  }

  /** The first three books with a cover, in series order. */
  async findCoverBookIds(seriesIds: number[], scope: Scope): Promise<Map<number, number[]>> {
    if (seriesIds.length === 0) return new Map();
    const rows = await this.db.execute<{ seriesId: number; bookId: number }>(sql`
      SELECT series_id AS "seriesId", book_id AS "bookId"
      FROM (
        SELECT bsm.series_id, ${books.id} AS book_id,
          row_number() OVER (
            PARTITION BY bsm.series_id
            ORDER BY ${NUMERIC_INDEX_SQL(sql`bsm.series_index`)} NULLS LAST, bsm.series_index NULLS LAST, ${books.addedAt}
          ) AS position
        FROM ${books}
        JOIN book_series_memberships bsm ON bsm.book_id = ${books.id}
        JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
        WHERE bsm.series_id IN (${sql.join(
          seriesIds.map((id) => sql`${id}`),
          sql`, `,
        )})
          AND ${bookMetadata.coverSource} IS NOT NULL
          AND ${this.scopeWhere(scope)}
      ) ranked
      WHERE position <= 3
      ORDER BY series_id, position
    `);
    const result = new Map<number, number[]>();
    for (const row of rows.rows) {
      const id = Number(row.seriesId);
      result.set(id, [...(result.get(id) ?? []), Number(row.bookId)]);
    }
    return result;
  }

  async seriesExists(seriesId: number): Promise<boolean> {
    const [row] = await this.db.select({ id: schema.bookSeries.id }).from(schema.bookSeries).where(eq(schema.bookSeries.id, seriesId)).limit(1);
    return row != null;
  }

  async markFine(seriesId: number, userId: number): Promise<void> {
    await this.db.insert(seriesReviewDismissals).values({ seriesId, dismissedBy: userId }).onConflictDoNothing();
  }

  async unmarkFine(seriesId: number): Promise<void> {
    await this.db.delete(seriesReviewDismissals).where(eq(seriesReviewDismissals.seriesId, seriesId));
  }

  /** Books in scope with a series name still waiting for a pick, by series name then title. */
  async findWaiting(scope: Scope, params: { page: number; size: number }): Promise<{ items: WaitingBookRow[]; total: number }> {
    const where = and(eq(bookSeriesPending.bookId, books.id), this.scopeWhere(scope));
    const [items, [totalRow]] = await Promise.all([
      this.db
        .select({
          bookId: bookSeriesPending.bookId,
          title: bookMetadata.title,
          seriesName: bookSeriesPending.seriesName,
          seriesIndex: bookSeriesPending.seriesIndex,
          displayOrder: bookSeriesPending.displayOrder,
        })
        .from(bookSeriesPending)
        .innerJoin(books, eq(books.id, bookSeriesPending.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(
          asc(bookSeriesPending.seriesName),
          asc(bookMetadata.titleSortKey),
          asc(bookSeriesPending.bookId),
          asc(bookSeriesPending.displayOrder),
        )
        .limit(params.size)
        .offset(params.page * params.size),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(bookSeriesPending)
        .innerJoin(books, eq(books.id, bookSeriesPending.bookId))
        .where(where),
    ]);
    return { items: items.map((item) => ({ ...item, title: item.title ?? '' })), total: Number(totalRow?.total ?? 0) };
  }

  /** Author names per book, in credit order. */
  async findBookAuthors(bookIds: number[]): Promise<Map<number, string[]>> {
    if (bookIds.length === 0) return new Map();
    const rows = await this.db
      .select({ bookId: bookAuthors.bookId, name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(inArray(bookAuthors.bookId, bookIds))
      .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder));
    const result = new Map<number, string[]>();
    for (const row of rows) result.set(row.bookId, [...(result.get(row.bookId) ?? []), row.name]);
    return result;
  }
}
