import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ACTIVE_BOOK_REQUEST_STATUSES, type ReleaseFollowKind } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { MergedRelease, SourceRelease } from './release-merge';
import type { ReleaseTarget } from './release-sources.service';

export type ReleaseFollowRow = typeof schema.releaseFollows.$inferSelect;
export type UpcomingReleaseRow = typeof schema.upcomingReleases.$inferSelect;

export interface FollowInput {
  kind: ReleaseFollowKind;
  name: string;
  nameKey: string;
  authorHint: string | null;
  authorId: number | null;
  seriesId: number | null;
}

export interface ListedReleaseRow extends UpcomingReleaseRow {
  matchedFollows: { kind: ReleaseFollowKind; name: string }[];
  state: 'requested' | 'dismissed' | null;
}

/** Escapes the LIKE wildcards in what a person typed, so "100%" searches for itself. */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

@Injectable()
export class NewReleasesRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  // ── Follows ─────────────────────────────────────────────

  async findFollow(userId: number, kind: ReleaseFollowKind, nameKey: string): Promise<ReleaseFollowRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.releaseFollows)
      .where(and(eq(schema.releaseFollows.userId, userId), eq(schema.releaseFollows.kind, kind), eq(schema.releaseFollows.nameKey, nameKey)))
      .limit(1);
    return row ?? null;
  }

  async findFollowById(userId: number, id: number): Promise<ReleaseFollowRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.releaseFollows)
      .where(and(eq(schema.releaseFollows.userId, userId), eq(schema.releaseFollows.id, id)))
      .limit(1);
    return row ?? null;
  }

  async insertFollow(userId: number, input: FollowInput): Promise<ReleaseFollowRow> {
    const [row] = await this.db
      .insert(schema.releaseFollows)
      .values({ userId, ...input })
      .onConflictDoUpdate({
        target: [schema.releaseFollows.userId, schema.releaseFollows.kind, schema.releaseFollows.nameKey],
        set: { name: input.name },
      })
      .returning();
    return row!;
  }

  async deleteFollow(userId: number, id: number): Promise<boolean> {
    const rows = await this.db
      .delete(schema.releaseFollows)
      .where(and(eq(schema.releaseFollows.userId, userId), eq(schema.releaseFollows.id, id)))
      .returning({ id: schema.releaseFollows.id });
    return rows.length > 0;
  }

  async listFollows(
    userId: number,
    kind: ReleaseFollowKind | null,
    search: string | null,
    offset: number,
    limit: number,
  ): Promise<{ items: ReleaseFollowRow[]; total: number }> {
    const where = and(
      eq(schema.releaseFollows.userId, userId),
      kind ? eq(schema.releaseFollows.kind, kind) : undefined,
      search ? ilike(schema.releaseFollows.name, likePattern(search)) : undefined,
    );
    const [items, [totals]] = await Promise.all([
      this.db.select().from(schema.releaseFollows).where(where).orderBy(asc(schema.releaseFollows.name)).offset(offset).limit(limit),
      this.db.select({ total: count() }).from(schema.releaseFollows).where(where),
    ]);
    return { items, total: totals?.total ?? 0 };
  }

  async countFollows(userId: number): Promise<{ author: number; series: number }> {
    const rows = await this.db
      .select({ kind: schema.releaseFollows.kind, total: count() })
      .from(schema.releaseFollows)
      .where(eq(schema.releaseFollows.userId, userId))
      .groupBy(schema.releaseFollows.kind);
    return {
      author: rows.find((row) => row.kind === 'author')?.total ?? 0,
      series: rows.find((row) => row.kind === 'series')?.total ?? 0,
    };
  }

  /** The next page of authors with a book in these libraries, in id order. */
  async findLibraryAuthorsPage(libraryIds: number[], afterId: number, limit: number): Promise<{ id: number; name: string }[]> {
    if (libraryIds.length === 0) return [];
    const libraries = sql.join(
      libraryIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const result = await this.db.execute<{ id: number; name: string }>(sql`
      SELECT a.id, a.name FROM authors a
      WHERE a.id > ${afterId}
        AND EXISTS (
          SELECT 1 FROM book_authors ba JOIN books b ON b.id = ba.book_id
          WHERE ba.author_id = a.id AND b.library_id IN (${libraries})
        )
      ORDER BY a.id
      LIMIT ${limit}
    `);
    return result.rows;
  }

  /**
   * The next page of series with a book in these libraries, in id order, each with the author its
   * books are most often first credited to.
   */
  async findLibrarySeriesPage(
    libraryIds: number[],
    afterId: number,
    limit: number,
  ): Promise<{ id: number; name: string; author_hint: string | null }[]> {
    if (libraryIds.length === 0) return [];
    const libraries = sql.join(
      libraryIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const result = await this.db.execute<{ id: number; name: string; author_hint: string | null }>(sql`
      SELECT s.id, s.name, (
        SELECT a.name FROM book_series_memberships m
        JOIN book_authors ba ON ba.book_id = m.book_id AND ba.display_order = 0
        JOIN authors a ON a.id = ba.author_id
        WHERE m.series_id = s.id
        GROUP BY a.name ORDER BY count(*) DESC, a.name LIMIT 1
      ) AS author_hint
      FROM book_series s
      WHERE s.id > ${afterId}
        AND EXISTS (
          SELECT 1 FROM book_series_memberships m JOIN books b ON b.id = m.book_id
          WHERE m.series_id = s.id AND b.library_id IN (${libraries})
        )
      ORDER BY s.id
      LIMIT ${limit}
    `);
    return result.rows;
  }

  /** Adds follows the user does not have yet; returns how many were new. */
  async insertFollowsIfMissing(userId: number, inputs: FollowInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const rows = await this.db
      .insert(schema.releaseFollows)
      .values(inputs.map((input) => ({ userId, ...input })))
      .onConflictDoNothing({ target: [schema.releaseFollows.userId, schema.releaseFollows.kind, schema.releaseFollows.nameKey] })
      .returning({ id: schema.releaseFollows.id });
    return rows.length;
  }

  /** The author a series' books are most often first credited to, to tell it from a same-named series. */
  async findSeriesAuthor(seriesId: number): Promise<string | null> {
    const result = await this.db.execute<{ name: string }>(sql`
      SELECT a.name FROM book_series_memberships m
      JOIN book_authors ba ON ba.book_id = m.book_id AND ba.display_order = 0
      JOIN authors a ON a.id = ba.author_id
      WHERE m.series_id = ${seriesId}
      GROUP BY a.name ORDER BY count(*) DESC, a.name LIMIT 1
    `);
    return result.rows[0]?.name ?? null;
  }

  // ── Checks ──────────────────────────────────────────────

  /** Followed names due a look: never checked first, then the longest ago, skipping ones checked within `freshDays`. */
  async findDueTargets(freshDays: number, limit: number): Promise<ReleaseTarget[]> {
    const result = await this.db.execute<{ kind: ReleaseFollowKind; name_key: string; name: string; author_hint: string | null }>(sql`
      SELECT f.kind, f.name_key, min(f.name) AS name, min(f.author_hint) AS author_hint
      FROM release_follows f
      LEFT JOIN release_checks c ON c.kind = f.kind AND c.name_key = f.name_key
      WHERE c.checked_at IS NULL OR c.checked_at < now() - make_interval(days => ${freshDays})
      GROUP BY f.kind, f.name_key, c.checked_at
      ORDER BY c.checked_at ASC NULLS FIRST, f.name_key
      LIMIT ${limit}
    `);
    return result.rows.map((row) => ({ kind: row.kind, nameKey: row.name_key, name: row.name, authorHint: row.author_hint }));
  }

  async countUncheckedFollows(userId: number): Promise<number> {
    const result = await this.db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM release_follows f
      LEFT JOIN release_checks c ON c.kind = f.kind AND c.name_key = f.name_key
      WHERE f.user_id = ${userId} AND c.checked_at IS NULL
    `);
    return result.rows[0]?.total ?? 0;
  }

  async lastCheckedAt(userId: number): Promise<Date | null> {
    const result = await this.db.execute<{ checked_at: Date | string | null }>(sql`
      SELECT max(c.checked_at) AS checked_at FROM release_follows f
      JOIN release_checks c ON c.kind = f.kind AND c.name_key = f.name_key
      WHERE f.user_id = ${userId}
    `);
    const value = result.rows[0]?.checked_at ?? null;
    return value === null ? null : new Date(value);
  }

  async recordCheck(target: ReleaseTarget, found: number): Promise<void> {
    await this.db
      .insert(schema.releaseChecks)
      .values({ kind: target.kind, nameKey: target.nameKey, checkedAt: new Date(), found })
      .onConflictDoUpdate({
        target: [schema.releaseChecks.kind, schema.releaseChecks.nameKey],
        set: { checkedAt: new Date(), found },
      });
  }

  // ── Releases ────────────────────────────────────────────

  async findReleasesByWorkKeys(workKeys: string[]): Promise<UpcomingReleaseRow[]> {
    if (workKeys.length === 0) return [];
    return this.db.select().from(schema.upcomingReleases).where(inArray(schema.upcomingReleases.workKey, workKeys));
  }

  async upsertRelease(release: MergedRelease, ownedBookId: number | null): Promise<void> {
    const values = {
      workKey: release.workKey,
      title: release.title,
      authors: release.authors,
      authorKeys: release.authorKeys,
      seriesName: release.seriesName,
      seriesKey: release.seriesKey,
      seriesIndex: release.seriesIndex,
      coverUrl: release.coverUrl,
      isbn13: release.isbn13,
      asin: release.asin,
      ebookDate: release.ebookDate,
      audiobookDate: release.audiobookDate,
      releaseDate: release.releaseDate,
      sources: release.sources as SourceRelease[],
      ownedBookId,
      lastSeenAt: new Date(),
    };
    await this.db.insert(schema.upcomingReleases).values(values).onConflictDoUpdate({ target: schema.upcomingReleases.workKey, set: values });
  }

  /**
   * A library book that is this release: one of its title forms and one of its authors agree. Uses
   * the lowercase title index, so it is one indexed probe per release.
   */
  async findOwnedBookId(titleKeys: string[], authorNames: string[]): Promise<number | null> {
    if (titleKeys.length === 0 || authorNames.length === 0) return null;
    const lowered = authorNames.map((name) => name.toLowerCase());
    const [row] = await this.db
      .select({ bookId: schema.bookMetadata.bookId })
      .from(schema.bookMetadata)
      .innerJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.bookMetadata.bookId))
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(and(inArray(sql`lower(${schema.bookMetadata.title})`, titleKeys), inArray(sql`lower(${schema.authors.name})`, lowered)))
      .limit(1);
    return row?.bookId ?? null;
  }

  /** Drops releases long gone from every list, and ones no source has reported for months. */
  async pruneReleases(keepReleasedDays: number, staleDays: number): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM upcoming_releases
      WHERE (release_date IS NOT NULL AND release_date < current_date - ${keepReleasedDays}::int)
         OR last_seen_at < now() - make_interval(days => ${staleDays})
    `);
    return result.rowCount ?? 0;
  }

  /**
   * The user's list: books from their follows with a confirmed date that are still to come, or came
   * out within `retentionDays`. Owned and hidden books are left out. Bounded, soonest first.
   */
  async listForUser(userId: number, retentionDays: number, limit: number): Promise<ListedReleaseRow[]> {
    const activeStatuses = sql.join(
      ACTIVE_BOOK_REQUEST_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    );
    const result = await this.db.execute<Record<string, unknown>>(sql`
      SELECT r.*, matched.follows AS matched_follows,
        CASE
          WHEN st.state IS NOT NULL THEN st.state
          WHEN EXISTS (
            SELECT 1 FROM book_requests br
            WHERE br.user_id = ${userId} AND br.status IN (${activeStatuses}) AND lower(br.title) = lower(r.title)
          ) THEN 'requested'
          ELSE NULL
        END AS user_state
      FROM upcoming_releases r
      CROSS JOIN LATERAL (
        SELECT json_agg(json_build_object('kind', f.kind, 'name', f.name) ORDER BY f.kind, f.name) AS follows
        FROM release_follows f
        WHERE f.user_id = ${userId}
          AND ((f.kind = 'author' AND f.name_key = ANY(r.author_keys)) OR (f.kind = 'series' AND f.name_key = r.series_key))
      ) matched
      LEFT JOIN release_user_states st ON st.user_id = ${userId} AND st.release_id = r.id
      WHERE matched.follows IS NOT NULL
        AND r.release_date IS NOT NULL
        AND r.release_date >= current_date - ${retentionDays}::int
        AND r.owned_book_id IS NULL
        AND (st.state IS NULL OR st.state <> 'dismissed')
      ORDER BY r.release_date ASC, r.title ASC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => ({
      id: row.id as number,
      workKey: row.work_key as string,
      title: row.title as string,
      authors: row.authors as string[],
      authorKeys: row.author_keys as string[],
      seriesName: row.series_name as string | null,
      seriesKey: row.series_key as string | null,
      seriesIndex: row.series_index as number | null,
      coverUrl: row.cover_url as string | null,
      isbn13: row.isbn13 as string | null,
      asin: row.asin as string | null,
      ebookDate: row.ebook_date as string | null,
      audiobookDate: row.audiobook_date as string | null,
      releaseDate: row.release_date as string | null,
      sources: row.sources,
      ownedBookId: row.owned_book_id as number | null,
      firstSeenAt: row.first_seen_at as Date,
      lastSeenAt: row.last_seen_at as Date,
      matchedFollows: (row.matched_follows as { kind: ReleaseFollowKind; name: string }[] | null) ?? [],
      state: (row.user_state as 'requested' | 'dismissed' | null) ?? null,
    }));
  }

  async releaseExists(id: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.upcomingReleases.id })
      .from(schema.upcomingReleases)
      .where(eq(schema.upcomingReleases.id, id))
      .limit(1);
    return !!row;
  }

  async setUserState(userId: number, releaseId: number, state: 'dismissed' | null): Promise<void> {
    if (state === null) {
      await this.db
        .delete(schema.releaseUserStates)
        .where(and(eq(schema.releaseUserStates.userId, userId), eq(schema.releaseUserStates.releaseId, releaseId)));
      return;
    }
    await this.db
      .insert(schema.releaseUserStates)
      .values({ userId, releaseId, state })
      .onConflictDoUpdate({
        target: [schema.releaseUserStates.userId, schema.releaseUserStates.releaseId],
        set: { state, updatedAt: new Date() },
      });
  }

  async saveRetentionDays(userId: number, retentionDays: number): Promise<void> {
    await this.db
      .insert(schema.releaseUserSettings)
      .values({ userId, retentionDays })
      .onConflictDoUpdate({ target: schema.releaseUserSettings.userId, set: { retentionDays } });
  }

  async findUserSettings(userId: number): Promise<typeof schema.releaseUserSettings.$inferSelect | null> {
    const [row] = await this.db.select().from(schema.releaseUserSettings).where(eq(schema.releaseUserSettings.userId, userId)).limit(1);
    return row ?? null;
  }
}
