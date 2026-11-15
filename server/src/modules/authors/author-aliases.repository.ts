import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { normalizePersonNameKeySql } from '../../common/utils/person-name.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authorAliases, authorPenNames, authors } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** Fork: other names an author goes by: spellings that resolve to them, and pen names linked to them. */
@Injectable()
export class AuthorAliasesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  listForAuthor(authorId: number): Promise<{ id: number; name: string }[]> {
    return this.db
      .select({ id: authorAliases.id, name: authorAliases.name })
      .from(authorAliases)
      .where(eq(authorAliases.authorId, authorId))
      .orderBy(asc(authorAliases.name));
  }

  async findByKey(nameKey: string): Promise<{ id: number; authorId: number; authorName: string } | null> {
    const [row] = await this.db
      .select({ id: authorAliases.id, authorId: authorAliases.authorId, authorName: authors.name })
      .from(authorAliases)
      .innerJoin(authors, eq(authors.id, authorAliases.authorId))
      .where(eq(authorAliases.nameKey, nameKey))
      .limit(1);
    return row ?? null;
  }

  /** Authors whose own name has this person-name key, so adding it as an alias can fold them in. */
  async findAuthorIdsByNameKey(nameKey: string): Promise<{ id: number; name: string }[]> {
    return this.db
      .select({ id: authors.id, name: authors.name })
      .from(authors)
      .where(eq(normalizePersonNameKeySql(authors.name), nameKey));
  }

  async add(authorId: number, name: string, nameKey: string): Promise<void> {
    await this.db
      .insert(authorAliases)
      .values({ authorId, name, nameKey })
      .onConflictDoUpdate({ target: authorAliases.nameKey, set: { authorId, name } });
  }

  async remove(authorId: number, aliasId: number): Promise<boolean> {
    const removed = await this.db
      .delete(authorAliases)
      .where(and(eq(authorAliases.id, aliasId), eq(authorAliases.authorId, authorId)))
      .returning({ id: authorAliases.id });
    return removed.length > 0;
  }

  /** Pen names this person wrote under, with the books under each the viewer can see. */
  async listPenNames(
    authorId: number,
    libraryIds: number[],
  ): Promise<{ id: number; name: string; bookCount: number; sharedWith: { id: number; name: string }[] }[]> {
    const penNames = await this.linkedNames(sql`pn.author_id = ${authorId}`, sql`pn.pen_name_author_id`, libraryIds);
    if (penNames.length === 0) return [];
    // Fork: the other people a shared pen name belongs to, so the page can say who shares it.
    const { rows } = await this.db.execute<{ pen_name_author_id: number; id: number; name: string }>(sql`
      SELECT pn.pen_name_author_id, a.id, a.name
      FROM ${authorPenNames} pn JOIN ${authors} a ON a.id = pn.author_id
      WHERE pn.pen_name_author_id = ANY(${sql.param(penNames.map((penName) => penName.id))}::int[]) AND pn.author_id <> ${authorId}
      ORDER BY a.name
    `);
    return penNames.map((penName) => ({
      ...penName,
      sharedWith: rows.filter((row) => Number(row.pen_name_author_id) === penName.id).map((row) => ({ id: Number(row.id), name: row.name })),
    }));
  }

  /** The person or people behind a pen name. */
  listPenNameOf(authorId: number, libraryIds: number[]): Promise<{ id: number; name: string; bookCount: number }[]> {
    return this.linkedNames(sql`pn.pen_name_author_id = ${authorId}`, sql`pn.author_id`, libraryIds);
  }

  async isPenName(authorId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: authorPenNames.authorId })
      .from(authorPenNames)
      .where(eq(authorPenNames.penNameAuthorId, authorId))
      .limit(1);
    return !!row;
  }

  async hasPenNames(authorId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: authorPenNames.penNameAuthorId })
      .from(authorPenNames)
      .where(eq(authorPenNames.authorId, authorId))
      .limit(1);
    return !!row;
  }

  async linkPenName(penNameAuthorId: number, authorId: number): Promise<void> {
    await this.db.insert(authorPenNames).values({ penNameAuthorId, authorId }).onConflictDoNothing();
  }

  async unlinkPenName(penNameAuthorId: number, authorId: number): Promise<boolean> {
    const removed = await this.db
      .delete(authorPenNames)
      .where(and(eq(authorPenNames.penNameAuthorId, penNameAuthorId), eq(authorPenNames.authorId, authorId)))
      .returning({ id: authorPenNames.authorId });
    return removed.length > 0;
  }

  /** An author with no books yet, so a name can be linked before any book carries it. */
  async createAuthor(name: string): Promise<{ id: number; name: string }> {
    const [row] = await this.db.insert(authors).values({ name }).returning({ id: authors.id, name: authors.name });
    return row!;
  }

  private async linkedNames(
    where: ReturnType<typeof sql>,
    linkedId: ReturnType<typeof sql>,
    libraryIds: number[],
  ): Promise<{ id: number; name: string; bookCount: number }[]> {
    const { rows } = await this.db.execute<{ id: number; name: string; book_count: number }>(sql`
      SELECT a.id, a.name, count(DISTINCT b.id)::int AS book_count
      FROM ${authorPenNames} pn
      JOIN ${authors} a ON a.id = ${linkedId}
      LEFT JOIN book_authors ba ON ba.author_id = a.id
      LEFT JOIN books b ON b.id = ba.book_id AND b.library_id = ANY(${sql.param(libraryIds)}::int[])
      WHERE ${where}
      GROUP BY a.id, a.name
      ORDER BY a.name
    `);
    return rows.map((row) => ({ id: Number(row.id), name: row.name, bookCount: Number(row.book_count) }));
  }
}
