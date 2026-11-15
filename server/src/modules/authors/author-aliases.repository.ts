import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { normalizePersonNameKeySql } from '../../common/utils/person-name.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authorAliases, authors } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** Fork: alternate names (pen names, spellings) that resolve to one author. */
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
}
