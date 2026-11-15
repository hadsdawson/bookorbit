import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authorLinks, authors } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** Fork: groups of author names that are one person (pen names). */
@Injectable()
export class AuthorLinksRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findLinkedAuthors(authorId: number): Promise<{ id: number; name: string }[]> {
    const { rows } = await this.db.execute<{ id: number; name: string }>(sql`
      SELECT a.id, a.name
      FROM ${authorLinks} mine
      JOIN ${authorLinks} linked ON linked.group_id = mine.group_id AND linked.author_id <> mine.author_id
      JOIN ${authors} a ON a.id = linked.author_id
      WHERE mine.author_id = ${authorId}
      ORDER BY a.name
    `);
    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  /** Puts both authors, and anyone already linked to either, in one group. Returns every member. */
  async link(authorId: number, otherId: number): Promise<number[]> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ authorId: authorLinks.authorId, groupId: authorLinks.groupId })
        .from(authorLinks)
        .where(inArray(authorLinks.authorId, [authorId, otherId]));
      const groupOf = new Map(existing.map((row) => [row.authorId, row.groupId]));
      const groupId = groupOf.get(authorId) ?? groupOf.get(otherId) ?? Math.min(authorId, otherId);
      const otherGroups = [...new Set(existing.map((row) => row.groupId))].filter((id) => id !== groupId);
      if (otherGroups.length > 0) {
        await tx.update(authorLinks).set({ groupId }).where(inArray(authorLinks.groupId, otherGroups));
      }
      await tx
        .insert(authorLinks)
        .values([
          { authorId, groupId },
          { authorId: otherId, groupId },
        ])
        .onConflictDoUpdate({ target: authorLinks.authorId, set: { groupId } });
      const members = await tx.select({ authorId: authorLinks.authorId }).from(authorLinks).where(eq(authorLinks.groupId, groupId));
      return members.map((row) => row.authorId);
    });
  }

  /** Takes linkedId out of authorId's group, and drops the group once one name is left. */
  async unlink(authorId: number, linkedId: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [mine] = await tx.select({ groupId: authorLinks.groupId }).from(authorLinks).where(eq(authorLinks.authorId, authorId));
      if (!mine) return false;
      const removed = await tx
        .delete(authorLinks)
        .where(sql`${authorLinks.authorId} = ${linkedId} AND ${authorLinks.groupId} = ${mine.groupId}`)
        .returning({ authorId: authorLinks.authorId });
      if (removed.length === 0) return false;
      const left = await tx.select({ authorId: authorLinks.authorId }).from(authorLinks).where(eq(authorLinks.groupId, mine.groupId));
      if (left.length < 2) await tx.delete(authorLinks).where(eq(authorLinks.groupId, mine.groupId));
      return true;
    });
  }

  /** Credits every member of the group on every book credited to any member. Returns the books changed. */
  async creditGroupOnBooks(memberIds: number[]): Promise<number[]> {
    if (memberIds.length < 2) return [];
    const ids = sql.join(
      memberIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const { rows } = await this.db.execute<{ bookId: number }>(sql`
      WITH credited AS (
        SELECT DISTINCT book_id FROM book_authors WHERE author_id IN (${ids})
      ),
      missing AS (
        SELECT c.book_id, m.author_id
        FROM credited c
        CROSS JOIN (VALUES ${sql.join(
          memberIds.map((id) => sql`(${id}::int)`),
          sql`, `,
        )}) AS m(author_id)
        WHERE NOT EXISTS (SELECT 1 FROM book_authors e WHERE e.book_id = c.book_id AND e.author_id = m.author_id)
      )
      INSERT INTO book_authors (book_id, author_id, display_order)
      SELECT missing.book_id, missing.author_id,
        (SELECT coalesce(max(x.display_order), -1) FROM book_authors x WHERE x.book_id = missing.book_id)
          + row_number() OVER (PARTITION BY missing.book_id ORDER BY missing.author_id)
      FROM missing
      ON CONFLICT DO NOTHING
      RETURNING book_id AS "bookId"
    `);
    return [...new Set(rows.map((row) => Number(row.bookId)))];
  }
}
