import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, exists, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { DB } from '../../db';
import { refreshPrimaryAuthorSortNamesForAuthors, refreshPrimaryAuthorSortNamesForBooks } from '../../db/book-author-sort-key';
import * as schema from '../../db/schema';
import { authorAliases, authorPenNames, authors, bookAuthors, bookMetadata, books } from '../../db/schema';
import { normalizePersonName, normalizePersonNameKey } from '../../common/utils/person-name.utils';
import { AuthorBookSort } from './dto/list-author-books.dto';
import { AuthorListSort, SortDirection } from './dto/list-authors.dto';

type Db = NodePgDatabase<typeof schema>;

type AuthorSummaryRow = {
  id: number;
  name: string;
  sortName: string | null;
  description: string | null;
  bookCount: number;
  lastAddedAt: Date | null;
};

/** The list query alone resolves a cover fallback; detail and enrichment do not need one. */
export type AuthorListItemRow = AuthorSummaryRow & {
  coverBookId: number | null;
  otherNameCount: number;
};

export type AuthorLetterCountRow = {
  letter: string;
  count: number;
};

type AuthorBookIdRow = {
  id: number;
};

export type AuthorDetailRow = AuthorSummaryRow & {
  birthDate: string | null;
  birthYear: number | null;
  deathDate: string | null;
  deathYear: number | null;
  website: string | null;
  genres: string[] | null;
  influences: string[] | null;
  metadataProvider: string | null;
  metadataProviderId: string | null;
  metadataProviderPinned: boolean;
};

export type AuthorEnrichmentRow = AuthorSummaryRow & {
  hasPhoto: boolean;
  birthDate: string | null;
  birthYear: number | null;
  deathDate: string | null;
  deathYear: number | null;
  website: string | null;
  genres: string[] | null;
  influences: string[] | null;
  metadataProvider: string | null;
  metadataProviderId: string | null;
  metadataProviderPinned: boolean;
};

@Injectable()
export class AuthorsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPage(params: {
    q?: string;
    page: number;
    size: number;
    sort: AuthorListSort;
    order: SortDirection;
    libraryIds: number[];
    hasPhoto?: boolean;
    hasSortName?: boolean;
    addedWithinDays?: number;
    minBookCount?: number;
    contentFilters?: ContentFilterRules;
  }): Promise<{ items: AuthorListItemRow[]; total: number; page: number; size: number }> {
    const members = this.authorMembers();
    const where = this.buildAuthorWhere({
      q: params.q,
      libraryIds: params.libraryIds,
      hasPhoto: params.hasPhoto,
      hasSortName: params.hasSortName,
      addedWithinDays: params.addedWithinDays,
      contentFilters: params.contentFilters,
    });
    const lastAddedExpr = max(books.addedAt);
    const orderBy = this.listOrder(params.sort, params.order, params.q);

    const having = params.minBookCount !== undefined ? sql`count(distinct ${books.id}) >= ${params.minBookCount}` : undefined;

    const dataQuery = this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: lastAddedExpr,
        coverBookId: this.coverBookIdExpr(params.libraryIds),
        otherNameCount: sql<number>`((SELECT count(*) FROM ${authorPenNames} pn WHERE pn.author_id = ${authors.id}) + (SELECT count(*) FROM ${authorAliases} al WHERE al.author_id = ${authors.id}))::int`,
      })
      .from(authors)
      .innerJoin(members, eq(members.ownerId, authors.id))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(where)
      .groupBy(authors.id, authors.name, authors.sortName, authors.description)
      .having(having)
      .orderBy(...orderBy)
      .limit(params.size)
      .offset(params.page * params.size);

    // When minBookCount is set, HAVING must be applied per-author before counting,
    // which requires a subquery. For the common case, use the cheaper scalar count.
    const countQuery = having
      ? this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(
            this.db
              .select({ id: authors.id })
              .from(authors)
              .innerJoin(members, eq(members.ownerId, authors.id))
              .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
              .innerJoin(books, eq(books.id, bookAuthors.bookId))
              .where(where)
              .groupBy(authors.id)
              .having(having)
              .as('filtered_authors'),
          )
      : this.db
          .select({ total: sql<number>`count(distinct ${authors.id})::int` })
          .from(authors)
          .innerJoin(members, eq(members.ownerId, authors.id))
          .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
          .innerJoin(books, eq(books.id, bookAuthors.bookId))
          .where(where);

    const [items, [{ total }]] = await Promise.all([dataQuery, countQuery]);

    return { items, total: Number(total), page: params.page, size: params.size };
  }

  async countAuthors(params: { libraryIds: number[]; contentFilters?: ContentFilterRules }): Promise<number> {
    if (params.libraryIds.length === 0) return 0;

    const members = this.authorMembers();
    const [row] = await this.db
      .select({ total: sql<number>`count(distinct ${authors.id})::int` })
      .from(authors)
      .innerJoin(members, eq(members.ownerId, authors.id))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(this.buildAuthorWhere({ libraryIds: params.libraryIds, contentFilters: params.contentFilters }));

    return Number(row?.total ?? 0);
  }

  async findById(authorId: number, libraryIds: number[], contentFilters?: ContentFilterRules): Promise<AuthorDetailRow | null> {
    if (libraryIds.length === 0) return null;

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const members = this.authorMembers();

    const [row] = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        birthDate: authors.birthDate,
        birthYear: authors.birthYear,
        deathDate: authors.deathDate,
        deathYear: authors.deathYear,
        website: authors.website,
        genres: authors.genres,
        influences: authors.influences,
        metadataProvider: authors.metadataProvider,
        metadataProviderId: authors.metadataProviderId,
        metadataProviderPinned: authors.metadataProviderPinned,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: max(books.addedAt),
      })
      .from(authors)
      .innerJoin(members, eq(members.ownerId, authors.id))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(eq(authors.id, authorId), inArray(books.libraryId, libraryIds), ...filterClauses))
      .groupBy(
        authors.id,
        authors.name,
        authors.sortName,
        authors.description,
        authors.birthDate,
        authors.birthYear,
        authors.deathDate,
        authors.deathYear,
        authors.website,
        authors.genres,
        authors.influences,
        authors.metadataProvider,
        authors.metadataProviderId,
        authors.metadataProviderPinned,
      )
      .limit(1);

    return row ?? null;
  }

  async findByIdForEnrichment(authorId: number): Promise<AuthorEnrichmentRow | null> {
    const [row] = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        hasPhoto: authors.hasPhoto,
        birthDate: authors.birthDate,
        birthYear: authors.birthYear,
        deathDate: authors.deathDate,
        deathYear: authors.deathYear,
        website: authors.website,
        genres: authors.genres,
        influences: authors.influences,
        metadataProvider: authors.metadataProvider,
        metadataProviderId: authors.metadataProviderId,
        metadataProviderPinned: authors.metadataProviderPinned,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: max(books.addedAt),
      })
      .from(authors)
      .leftJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .leftJoin(books, eq(books.id, bookAuthors.bookId))
      .where(eq(authors.id, authorId))
      .groupBy(
        authors.id,
        authors.name,
        authors.sortName,
        authors.description,
        authors.hasPhoto,
        authors.birthDate,
        authors.birthYear,
        authors.deathDate,
        authors.deathYear,
        authors.website,
        authors.genres,
        authors.influences,
        authors.metadataProvider,
        authors.metadataProviderId,
        authors.metadataProviderPinned,
      )
      .limit(1);
    return row ?? null;
  }

  async findBookIdsPage(params: {
    authorId: number;
    page: number;
    size: number;
    sort: AuthorBookSort;
    order: SortDirection;
    libraryIds: number[];
    contentFilters?: ContentFilterRules;
  }): Promise<{ bookIds: number[]; total: number; page: number; size: number }> {
    if (params.libraryIds.length === 0) {
      return { bookIds: [], total: 0, page: params.page, size: params.size };
    }

    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    const where = and(eq(bookAuthors.authorId, params.authorId), inArray(books.libraryId, params.libraryIds), ...filterClauses);

    const sortExpr = params.sort === 'title' ? bookMetadata.title : params.sort === 'publishedYear' ? bookMetadata.publishedYear : books.addedAt;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ id: books.id })
        .from(books)
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(this.orderByDirection(sortExpr, params.order), asc(books.id))
        .limit(params.size)
        .offset(params.page * params.size),
      this.db
        .select({ total: sql<number>`count(distinct ${books.id})::int` })
        .from(books)
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
        .where(where),
    ]);

    return { bookIds: rows.map((row: AuthorBookIdRow) => row.id), total: Number(total), page: params.page, size: params.size };
  }

  /**
   * The same "books of this author the user may see" predicate as {@link findBookIdsPage}, shaped
   * for the collapsed book query. That query folds series in SQL over a CTE selecting from books
   * alone, so authorship has to arrive as a correlated EXISTS rather than the join used above.
   *
   * Keyed on the author id, not the author name: merged authors and two writers sharing a name
   * stay distinct here, which a name-based filter would silently collapse together.
   */
  buildBooksWhere(params: { authorId: number; libraryIds: number[]; contentFilters?: ContentFilterRules }): SQL {
    // Never `undefined` for the empty case: an absent predicate reads as "no restriction" to the
    // query that consumes this, which is the opposite of what no accessible library means.
    if (params.libraryIds.length === 0) return sql`false`;

    const byThisAuthor = exists(
      this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .where(and(sql`${bookAuthors.bookId} = ${books.id}`, eq(bookAuthors.authorId, params.authorId))),
    );

    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    return and(byThisAuthor, inArray(books.libraryId, params.libraryIds), ...filterClauses)!;
  }

  async updateAuthorById(
    authorId: number,
    values: Partial<{
      name: string;
      sortName: string | null;
      description: string | null;
      hasPhoto: boolean;
      birthDate: string | null;
      birthYear: number | null;
      deathDate: string | null;
      deathYear: number | null;
      website: string | null;
      genres: string[] | null;
      influences: string[] | null;
      metadataProvider: string | null;
      metadataProviderId: string | null;
      metadataProviderPinned: boolean;
      lastEnrichedAt: Date | null;
    }>,
  ) {
    const [updated] = await this.db.update(authors).set(values).where(eq(authors.id, authorId)).returning({
      id: authors.id,
      name: authors.name,
      sortName: authors.sortName,
      description: authors.description,
      hasPhoto: authors.hasPhoto,
      lastEnrichedAt: authors.lastEnrichedAt,
    });
    if (updated && (values.name !== undefined || values.sortName !== undefined)) {
      await refreshPrimaryAuthorSortNamesForAuthors(this.db, [authorId]);
    }
    return updated ?? null;
  }

  async updateAuthorDescriptionIfEmpty(authorId: number, description: string): Promise<boolean> {
    const updated = await this.db
      .update(authors)
      .set({ description })
      .where(and(eq(authors.id, authorId), or(isNull(authors.description), eq(sql`btrim(${authors.description})`, ''))))
      .returning({ id: authors.id });
    return updated.length > 0;
  }

  async findVisibleAuthorIds(authorIds: number[], libraryIds: number[]): Promise<number[]> {
    if (authorIds.length === 0 || libraryIds.length === 0) return [];
    const members = this.authorMembers();
    const rows = await this.db
      .selectDistinct({ id: authors.id })
      .from(authors)
      .innerJoin(members, eq(members.ownerId, authors.id))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(inArray(authors.id, authorIds), inArray(books.libraryId, libraryIds)));
    return rows.map((row) => row.id);
  }

  async countDistinctBooks(authorIds: number[]): Promise<number> {
    if (authorIds.length === 0) return 0;
    const [{ total }] = await this.db
      .select({ total: sql<number>`count(distinct ${bookAuthors.bookId})::int` })
      .from(bookAuthors)
      .where(inArray(bookAuthors.authorId, authorIds));
    return Number(total);
  }

  async findBookIdsByAuthorIds(authorIds: number[]): Promise<number[]> {
    if (authorIds.length === 0) return [];
    const rows = await this.db.selectDistinct({ bookId: bookAuthors.bookId }).from(bookAuthors).where(inArray(bookAuthors.authorId, authorIds));
    return rows.map((row) => row.bookId);
  }

  async findRelatedLibraryIds(authorIds: number[]): Promise<number[]> {
    if (authorIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ libraryId: books.libraryId })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(inArray(bookAuthors.authorId, authorIds));
    return rows.map((row) => row.libraryId);
  }

  /** Fork: clears biographies that are only Goodreads' "edit data" link, saved by older builds. */
  async clearEditDataDescriptions(): Promise<number> {
    const cleared = await this.db
      .update(authors)
      .set({ description: null })
      .where(sql`lower(btrim(${authors.description})) = 'edit data'`)
      .returning({ id: authors.id });
    return cleared.length;
  }

  async mergeAuthors(targetAuthorId: number, sourceAuthorIds: number[]): Promise<void> {
    if (sourceAuthorIds.length === 0) return;

    await this.db.transaction(async (tx) => {
      const sourceRelations = await tx
        .select({
          bookId: bookAuthors.bookId,
          displayOrder: bookAuthors.displayOrder,
        })
        .from(bookAuthors)
        .where(inArray(bookAuthors.authorId, sourceAuthorIds));

      if (sourceRelations.length > 0) {
        await tx
          .insert(bookAuthors)
          .values(
            sourceRelations.map((row) => ({
              bookId: row.bookId,
              authorId: targetAuthorId,
              displayOrder: row.displayOrder,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(bookAuthors).where(inArray(bookAuthors.authorId, sourceAuthorIds));

      // Fork: the merged names and their own alternate names become the target's alternate names,
      // so a book that comes in later under any of them goes to the target.
      await tx.update(authorAliases).set({ authorId: targetAuthorId }).where(inArray(authorAliases.authorId, sourceAuthorIds));
      const sources = await tx.select({ name: authors.name }).from(authors).where(inArray(authors.id, sourceAuthorIds));
      const aliasRows = sources.flatMap((source) => {
        const name = normalizePersonName(source.name);
        const nameKey = normalizePersonNameKey(name);
        return name && nameKey ? [{ authorId: targetAuthorId, name, nameKey }] : [];
      });
      if (aliasRows.length > 0) {
        await tx
          .insert(authorAliases)
          .values(aliasRows)
          .onConflictDoUpdate({ target: authorAliases.nameKey, set: { authorId: targetAuthorId } });
      }

      // Fork: pen-name links follow the merged authors to the target.
      const links = await tx
        .select({ penNameAuthorId: authorPenNames.penNameAuthorId, authorId: authorPenNames.authorId })
        .from(authorPenNames)
        .where(or(inArray(authorPenNames.penNameAuthorId, sourceAuthorIds), inArray(authorPenNames.authorId, sourceAuthorIds)));
      const sourceSet = new Set(sourceAuthorIds);
      const moved = links
        .map((link) => ({
          penNameAuthorId: sourceSet.has(link.penNameAuthorId) ? targetAuthorId : link.penNameAuthorId,
          authorId: sourceSet.has(link.authorId) ? targetAuthorId : link.authorId,
        }))
        .filter((link) => link.penNameAuthorId !== link.authorId);
      if (moved.length > 0) await tx.insert(authorPenNames).values(moved).onConflictDoNothing();

      await tx.delete(authors).where(inArray(authors.id, sourceAuthorIds));
      await refreshPrimaryAuthorSortNamesForBooks(
        tx,
        sourceRelations.map((row) => row.bookId),
      );
    });
  }

  async deleteAuthors(authorIds: number[]): Promise<void> {
    if (authorIds.length === 0) return;

    await this.db.transaction(async (tx) => {
      const relations = await tx
        .select({
          bookId: bookAuthors.bookId,
        })
        .from(bookAuthors)
        .where(inArray(bookAuthors.authorId, authorIds));
      await tx.delete(bookAuthors).where(inArray(bookAuthors.authorId, authorIds));
      await tx.delete(authors).where(inArray(authors.id, authorIds));
      await refreshPrimaryAuthorSortNamesForBooks(
        tx,
        relations.map((row) => row.bookId),
      );
    });
  }

  /**
   * The most recently added book of theirs that actually carries cover art, scoped to
   * the libraries the caller can see. Correlated per row rather than joined, so it costs
   * one index lookup per author on the page instead of widening the grouped join.
   */
  private coverBookIdExpr(libraryIds: number[]): SQL<number | null> {
    return sql<number | null>`(
      SELECT cb.id
      FROM ${bookAuthors} cba
      JOIN ${books} cb ON cb.id = cba.book_id
      JOIN ${bookMetadata} cm ON cm.book_id = cb.id
      WHERE (cba.author_id = ${authors.id} OR cba.author_id IN (SELECT cpn.pen_name_author_id FROM ${authorPenNames} cpn WHERE cpn.author_id = ${authors.id}))
        AND cb.library_id IN (${sql.join(
          libraryIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND cm.cover_source IS NOT NULL
      ORDER BY cb.added_at DESC, cb.id DESC
      LIMIT 1
    )`;
  }

  /**
   * Counts per A-Z bucket for the jump rail, under the same filters as the list. One
   * grouped query, so the rail stays correct for a library the page has not scrolled
   * through yet. Anything not starting A-Z buckets to "#".
   */
  async findLetterCounts(params: {
    q?: string;
    /** Must match the field the list is ordered by, or the rail points at the wrong rows. */
    sort: Extract<AuthorListSort, 'name' | 'sortName'>;
    order: SortDirection;
    libraryIds: number[];
    hasPhoto?: boolean;
    hasSortName?: boolean;
    addedWithinDays?: number;
    minBookCount?: number;
    contentFilters?: ContentFilterRules;
  }): Promise<AuthorLetterCountRow[]> {
    if (params.libraryIds.length === 0) return [];

    const where = this.buildAuthorWhere({
      q: params.q,
      libraryIds: params.libraryIds,
      hasPhoto: params.hasPhoto,
      hasSortName: params.hasSortName,
      addedWithinDays: params.addedWithinDays,
      contentFilters: params.contentFilters,
    });
    const having = params.minBookCount !== undefined ? sql`count(distinct ${books.id}) >= ${params.minBookCount}` : undefined;

    const members = this.authorMembers();
    const perAuthor = this.db
      .select({ letter: this.letterBucketExpr(params.sort).as('letter') })
      .from(authors)
      .innerJoin(members, eq(members.ownerId, authors.id))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(where)
      .groupBy(authors.id, authors.sortName, authors.name)
      .having(having)
      .as('per_author');

    const rows = await this.db
      .select({ letter: perAuthor.letter, count: sql<number>`count(*)::int` })
      .from(perAuthor)
      .groupBy(perAuthor.letter)
      .orderBy(params.order === 'asc' ? asc(perAuthor.letter) : desc(perAuthor.letter));

    return rows.map((row) => ({ letter: row.letter, count: Number(row.count) }));
  }

  /**
   * First character of whichever key the list is ordered by, folded to unaccented
   * uppercase so "Sjon" and "Sjón" share a bucket. Sorting by display name and
   * bucketing by sort name would put "Ben Aaronovitch" under A in a list ordered by B.
   */
  private letterBucketExpr(sort: 'name' | 'sortName'): SQL<string> {
    const key = sort === 'sortName' ? sql`COALESCE(NULLIF(BTRIM(${authors.sortName}), ''), ${authors.name})` : sql`${authors.name}`;
    const initial = sql`UPPER(LEFT(public.bookorbit_unaccent(BTRIM(${key})), 1))`;
    return sql<string>`CASE WHEN ${initial} BETWEEN 'A' AND 'Z' THEN ${initial} ELSE '#' END`;
  }

  /**
   * Points `has_photo` back at the image store. Two statements whatever the library
   * size, so it is cheap enough to run on every boot. Returns how many rows moved in
   * each direction, which is what makes the drift visible in the log.
   *
   * `sql.param` is required: interpolating the array directly expands it to
   * `ANY(($1, $2, ...))`, which Postgres rejects, and the failure is invisible here
   * because a stale flag must not stop the app from booting.
   */
  async reconcileHasPhoto(idsWithImage: number[]): Promise<{ marked: number; cleared: number }> {
    const marked = idsWithImage.length
      ? await this.db
          .update(authors)
          .set({ hasPhoto: true })
          .where(and(eq(authors.hasPhoto, false), sql`${authors.id} = ANY(${sql.param(idsWithImage)}::int[])`))
          .returning({ id: authors.id })
      : [];

    const cleared = idsWithImage.length
      ? await this.db
          .update(authors)
          .set({ hasPhoto: false })
          .where(and(eq(authors.hasPhoto, true), sql`NOT (${authors.id} = ANY(${sql.param(idsWithImage)}::int[]))`))
          .returning({ id: authors.id })
      : await this.db.update(authors).set({ hasPhoto: false }).where(eq(authors.hasPhoto, true)).returning({ id: authors.id });

    return { marked: marked.length, cleared: cleared.length };
  }

  /**
   * The list's order: the sort picked, then sort name, name and id, so every author has one place
   * and paging and stepping between authors agree.
   */
  private listOrder(sort: AuthorListSort, order: SortDirection, q?: string): SQL[] {
    const sortNameExpr = sql`COALESCE(${authors.sortName}, ${authors.name})`;
    const trimmedQuery = q?.trim();
    const primary =
      sort === 'relevance' && trimmedQuery
        ? this.orderByDirection(searchRelevance(authors.name, trimmedQuery), order)
        : sort === 'bookCount'
          ? this.orderByDirection(sql<number>`count(distinct ${books.id})`, order)
          : sort === 'lastAddedAt'
            ? this.orderByDirection(sql`max(${books.addedAt})`, order)
            : sort === 'lastEnrichedAt'
              ? order === 'asc'
                ? sql`${authors.lastEnrichedAt} ASC NULLS LAST`
                : sql`${authors.lastEnrichedAt} DESC NULLS LAST`
              : sort === 'sortName'
                ? this.orderByDirection(sortNameExpr, order)
                : this.orderByDirection(authors.name, order);
    return [primary, sql`${sortNameExpr} ASC`, asc(authors.name), asc(authors.id)];
  }

  /**
   * Fork: the authors just before and after this one in the Authors list, under the same filters
   * and sort, for the previous and next buttons on an author page. Null where there is none, and
   * both null when the author is not in that list.
   */
  async findNeighbors(
    authorId: number,
    params: {
      q?: string;
      sort: AuthorListSort;
      order: SortDirection;
      libraryIds: number[];
      hasPhoto?: boolean;
      hasSortName?: boolean;
      addedWithinDays?: number;
      minBookCount?: number;
      contentFilters?: ContentFilterRules;
    },
  ): Promise<{ previous: { id: number; name: string } | null; next: { id: number; name: string } | null }> {
    const none = { previous: null, next: null };
    if (params.libraryIds.length === 0) return none;
    const members = this.authorMembers();
    const where = this.buildAuthorWhere({
      q: params.q,
      libraryIds: params.libraryIds,
      hasPhoto: params.hasPhoto,
      hasSortName: params.hasSortName,
      addedWithinDays: params.addedWithinDays,
      contentFilters: params.contentFilters,
    });
    const having = params.minBookCount !== undefined ? sql`count(distinct ${books.id}) >= ${params.minBookCount}` : undefined;
    const window = sql`over (order by ${sql.join(this.listOrder(params.sort, params.order, params.q), sql`, `)})`;
    const ranked = this.db
      .select({
        id: authors.id,
        previousId: sql<number | null>`lag(${authors.id}) ${window}`.as('previous_id'),
        previousName: sql<string | null>`lag(${authors.name}) ${window}`.as('previous_name'),
        nextId: sql<number | null>`lead(${authors.id}) ${window}`.as('next_id'),
        nextName: sql<string | null>`lead(${authors.name}) ${window}`.as('next_name'),
      })
      .from(authors)
      .innerJoin(members, eq(members.ownerId, authors.id))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, members.memberId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(where)
      .groupBy(authors.id, authors.name, authors.sortName, authors.description)
      .having(having)
      .as('ranked_authors');
    const [row] = await this.db.select().from(ranked).where(eq(ranked.id, authorId)).limit(1);
    if (!row) return none;
    return {
      previous: row.previousId !== null ? { id: Number(row.previousId), name: row.previousName ?? '' } : null,
      next: row.nextId !== null ? { id: Number(row.nextId), name: row.nextName ?? '' } : null,
    };
  }

  /**
   * Fork: each author with the pen names they wrote under, so a person's books and counts take in
   * the books credited to their pen names. Every author is its own member.
   */
  private authorMembers() {
    return this.db
      .select({ ownerId: sql<number>`${authors.id}`.as('owner_id'), memberId: sql<number>`${authors.id}`.as('member_id') })
      .from(authors)
      .unionAll(
        this.db
          .select({
            ownerId: sql<number>`${authorPenNames.authorId}`.as('owner_id'),
            memberId: sql<number>`${authorPenNames.penNameAuthorId}`.as('member_id'),
          })
          .from(authorPenNames),
      )
      .as('author_members');
  }

  private buildAuthorWhere(params: {
    q?: string;
    libraryIds: number[];
    hasPhoto?: boolean;
    hasSortName?: boolean;
    addedWithinDays?: number;
    contentFilters?: ContentFilterRules;
  }): SQL {
    // Fork: a pen name is listed under the person who wrote under it, never on its own.
    const clauses: SQL[] = [
      inArray(books.libraryId, params.libraryIds),
      sql`NOT EXISTS (SELECT 1 FROM ${authorPenNames} own_pn WHERE own_pn.pen_name_author_id = ${authors.id})`,
    ];
    if (params.contentFilters) {
      clauses.push(...buildContentFilterClauses(params.contentFilters, this.db));
    }
    const query = params.q?.trim();
    if (query) {
      const pattern = buildSearchPattern(query);
      clauses.push(
        or(
          accentInsensitiveIlike(authors.name, pattern),
          sql`EXISTS (SELECT 1 FROM ${authorPenNames} q_pn JOIN ${authors} q_pa ON q_pa.id = q_pn.pen_name_author_id WHERE q_pn.author_id = ${authors.id} AND ${accentInsensitiveIlike(sql`q_pa.name`, pattern)})`,
          sql`EXISTS (SELECT 1 FROM ${authorAliases} q_al WHERE q_al.author_id = ${authors.id} AND ${accentInsensitiveIlike(sql`q_al.name`, pattern)})`,
        )!,
      );
    }
    if (params.hasPhoto !== undefined) {
      clauses.push(eq(authors.hasPhoto, params.hasPhoto));
    }
    if (params.hasSortName !== undefined) {
      // An empty string is a missing sort name as far as the UI is concerned.
      const missing = sql`(${authors.sortName} IS NULL OR BTRIM(${authors.sortName}) = '')`;
      clauses.push(params.hasSortName ? (sql`NOT ${missing}` as SQL) : (missing as SQL));
    }
    if (params.addedWithinDays !== undefined) {
      clauses.push(sql`${books.addedAt} >= NOW() - MAKE_INTERVAL(days => ${params.addedWithinDays})` as SQL);
    }
    return and(...clauses)!;
  }

  private orderByDirection(
    expression:
      SQL | typeof authors.name | typeof authors.sortName | typeof bookMetadata.title | typeof bookMetadata.publishedYear | typeof books.addedAt,
    order: SortDirection,
  ) {
    return order === 'asc' ? asc(expression) : desc(expression);
  }
}

function searchRelevance(column: typeof authors.name, query: string): SQL {
  const value = sql`lower(public.bookorbit_unaccent(COALESCE(${column}, '')))`;
  const q = sql`lower(public.bookorbit_unaccent(${query}))`;
  return sql`CASE
    WHEN ${value} = ${q} THEN 1000
    WHEN ${value} LIKE ${q} || '%' THEN 800
    WHEN ${value} LIKE '%' || ${q} || '%' THEN 600
    ELSE similarity(${value}, ${q}) * 400
  END`;
}
