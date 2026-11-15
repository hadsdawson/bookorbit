import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { ContentFilterRules } from '@bookorbit/types';
import { accentInsensitiveExactMatchRank, accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { normalizeMetadataText } from '../../common/utils/metadata-text-normalize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authorAliases,
  authorPenNames,
  authors,
  bookAuthors,
  bookGenres,
  bookMetadata,
  bookNarrators,
  bookSeries,
  bookSeriesMemberships,
  bookTags,
  books,
  collections,
  genres,
  narrators,
  tags,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type SearchResult = { name: string };
type SearchResultWithId = { id: number; name: string };
type NamedTable = typeof authors | typeof narrators | typeof bookSeries;
type NamedTableWithId = typeof genres | typeof tags;
type MetadataTextColumn = typeof bookMetadata.publisher | typeof bookMetadata.language;
type Junction = { table: PgTable; entityId: PgColumn; bookId: PgColumn };

const AUTHOR_JUNCTION: Junction = { table: bookAuthors, entityId: bookAuthors.authorId, bookId: bookAuthors.bookId };
const GENRE_JUNCTION: Junction = { table: bookGenres, entityId: bookGenres.genreId, bookId: bookGenres.bookId };
const TAG_JUNCTION: Junction = { table: bookTags, entityId: bookTags.tagId, bookId: bookTags.bookId };
const NARRATOR_JUNCTION: Junction = { table: bookNarrators, entityId: bookNarrators.narratorId, bookId: bookNarrators.bookId };
const SERIES_JUNCTION: Junction = {
  table: bookSeriesMemberships,
  entityId: bookSeriesMemberships.seriesId,
  bookId: bookSeriesMemberships.bookId,
};

export interface CatalogSearchScope {
  libraryIds: number[];
  contentFilters?: ContentFilterRules;
}

const DEFAULT_SEARCH_LIMIT = 15;
const COLLECTION_SEARCH_LIMIT = 20;
// Distinct stored spellings, not languages: "en", "eng" and "English" are three rows here.
const LANGUAGE_LIST_LIMIT = 200;

@Injectable()
export class CatalogRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Authors by name, then authors whose alternate name matches (Fork), so typing a pen name offers
   * the author it belongs to. Those hits carry the alternate name they matched. Pen names and main
   * names with no books of their own are offered too, when the name they are tied to has books (Fork).
   */
  async searchAuthors(q: string, scope: CatalogSearchScope): Promise<(SearchResult & { alias?: string })[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];
    const [byName, byAlias, byLink] = await Promise.all([
      this.searchByName(q, authors, AUTHOR_JUNCTION, scope),
      this.db
        .selectDistinct({ name: authors.name, alias: authorAliases.name })
        .from(authorAliases)
        .innerJoin(authors, eq(authors.id, authorAliases.authorId))
        .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
        .innerJoin(books, eq(books.id, bookAuthors.bookId))
        .where(and(accentInsensitiveIlike(authorAliases.name, pattern), ...this.visibilityClauses(scope)))
        .orderBy(authorAliases.name)
        .limit(DEFAULT_SEARCH_LIMIT),
      this.db
        .selectDistinct({ name: authors.name })
        .from(authorPenNames)
        .innerJoin(authors, or(eq(authors.id, authorPenNames.penNameAuthorId), eq(authors.id, authorPenNames.authorId)))
        .innerJoin(bookAuthors, or(eq(bookAuthors.authorId, authorPenNames.penNameAuthorId), eq(bookAuthors.authorId, authorPenNames.authorId)))
        .innerJoin(books, eq(books.id, bookAuthors.bookId))
        .where(and(accentInsensitiveIlike(authors.name, pattern), ...this.visibilityClauses(scope)))
        .orderBy(authors.name)
        .limit(DEFAULT_SEARCH_LIMIT),
    ]);
    const seen = new Set(byName.map((row) => row.name));
    const aliasHits: (SearchResult & { alias: string })[] = [];
    for (const row of byAlias) {
      if (seen.has(row.name)) continue;
      seen.add(row.name);
      aliasHits.push(row);
    }
    const linkHits: SearchResult[] = [];
    for (const row of byLink) {
      if (seen.has(row.name)) continue;
      seen.add(row.name);
      linkHits.push(row);
    }
    return [...aliasHits, ...linkHits, ...byName].slice(0, DEFAULT_SEARCH_LIMIT);
  }

  /** Fork: the authors these names are alternate names of, among authors on visible books. */
  async resolveAuthorAliases(nameKeys: string[], scope: CatalogSearchScope): Promise<{ nameKey: string; name: string; alias: string }[]> {
    if (nameKeys.length === 0) return [];
    return this.db
      .selectDistinct({ nameKey: authorAliases.nameKey, name: authors.name, alias: authorAliases.name })
      .from(authorAliases)
      .innerJoin(authors, eq(authors.id, authorAliases.authorId))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(inArray(authorAliases.nameKey, nameKeys), ...this.visibilityClauses(scope)));
  }

  searchGenres(q: string, scope: CatalogSearchScope): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(q, genres, GENRE_JUNCTION, scope);
  }

  searchTags(q: string, scope: CatalogSearchScope): Promise<SearchResultWithId[]> {
    return this.searchByNameWithId(q, tags, TAG_JUNCTION, scope);
  }

  searchNarrators(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchByName(q, narrators, NARRATOR_JUNCTION, scope);
  }

  searchPublishers(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.publisher, scope);
  }

  searchSeries(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchByName(q, bookSeries, SERIES_JUNCTION, scope);
  }

  searchLanguages(q: string, scope: CatalogSearchScope): Promise<SearchResult[]> {
    return this.searchDistinctMetadataField(q, bookMetadata.language, scope);
  }

  /** Every language value on a visible book, most common first so a capped list keeps the ones that matter. */
  async listLanguages(scope: CatalogSearchScope): Promise<SearchResult[]> {
    const rows = await this.db
      .select({ name: bookMetadata.language })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(isNotNull(bookMetadata.language), ...this.visibilityClauses(scope)))
      .groupBy(bookMetadata.language)
      .orderBy(desc(sql`count(*)`), bookMetadata.language)
      .limit(LANGUAGE_LIST_LIMIT);

    return rows.filter((row): row is SearchResult => row.name !== null && row.name.trim() !== '');
  }

  searchCollections(userId: number, q: string): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return Promise.resolve([]);

    return this.db
      .select({ name: collections.name })
      .from(collections)
      .where(and(or(eq(collections.userId, userId), eq(collections.isPublic, true)), accentInsensitiveIlike(collections.name, pattern)))
      .orderBy(collections.name)
      .limit(COLLECTION_SEARCH_LIMIT);
  }

  private searchByName(q: string, table: NamedTable, junction: Junction, scope: CatalogSearchScope): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return Promise.resolve([]);

    return this.db
      .selectDistinct({ name: table.name })
      .from(table)
      .innerJoin(junction.table, eq(junction.entityId, table.id))
      .innerJoin(books, eq(books.id, junction.bookId))
      .where(and(accentInsensitiveIlike(table.name, pattern), ...this.visibilityClauses(scope)))
      .orderBy(table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private searchByNameWithId(q: string, table: NamedTableWithId, junction: Junction, scope: CatalogSearchScope): Promise<SearchResultWithId[]> {
    const term = normalizeMetadataText(q);
    if (!term) return Promise.resolve([]);

    return this.db
      .select({ id: table.id, name: table.name })
      .from(table)
      .innerJoin(junction.table, eq(junction.entityId, table.id))
      .innerJoin(books, eq(books.id, junction.bookId))
      .where(and(accentInsensitiveIlike(table.name, buildSearchPattern(term)), ...this.visibilityClauses(scope)))
      .groupBy(table.id, table.name)
      .orderBy(accentInsensitiveExactMatchRank(table.name, term), table.name)
      .limit(DEFAULT_SEARCH_LIMIT);
  }

  private async searchDistinctMetadataField(q: string, column: MetadataTextColumn, scope: CatalogSearchScope): Promise<SearchResult[]> {
    const pattern = this.toContainsPattern(q);
    if (!pattern) return [];

    const rows = await this.db
      .selectDistinct({ name: column })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(isNotNull(column), accentInsensitiveIlike(column, pattern), ...this.visibilityClauses(scope)))
      .orderBy(column)
      .limit(DEFAULT_SEARCH_LIMIT);

    return rows.filter((row): row is SearchResult => row.name !== null);
  }

  private visibilityClauses(scope: CatalogSearchScope): SQL[] {
    return [inArray(books.libraryId, scope.libraryIds), ...(scope.contentFilters ? buildContentFilterClauses(scope.contentFilters, this.db) : [])];
  }

  private toContainsPattern(q: string): string | null {
    const term = q.trim();
    if (!term) return null;

    return buildSearchPattern(term);
  }
}
