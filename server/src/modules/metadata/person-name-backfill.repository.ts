import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { normalizePersonNameSql } from '../../common/utils/person-name.utils';
import { DB } from '../../db';
import { refreshPrimaryAuthorSortNamesForAuthors } from '../../db/book-author-sort-key';
import * as schema from '../../db/schema';
import { authors, narrators } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SPACED_INITIALS_PATTERN = '[[:upper:]]\\.[[:space:]]+[[:upper:]]\\.';

@Injectable()
export class PersonNameBackfillRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Joins spaced initials in author names and their sort names. Returns the renamed author ids. */
  async joinAuthorInitials(): Promise<number[]> {
    const ids = await this.joinInitials(authors, authors.id, authors.name, authors.sortName);
    if (ids.length > 0) await refreshPrimaryAuthorSortNamesForAuthors(this.db, ids);
    return ids;
  }

  /** Joins spaced initials in narrator names and their sort names. Returns the renamed narrator ids. */
  joinNarratorInitials(): Promise<number[]> {
    return this.joinInitials(narrators, narrators.id, narrators.name, narrators.sortName);
  }

  private async joinInitials(table: PgTable, idCol: PgColumn, nameCol: PgColumn, sortNameCol: PgColumn): Promise<number[]> {
    const pattern = sql.raw(`'${SPACED_INITIALS_PATTERN}'`);
    const result = await this.db.execute<{ id: number }>(sql`
      WITH candidates AS (
        SELECT DISTINCT ON (joined.new_name) joined.id, joined.new_name
        FROM (
          SELECT ${idCol} AS id, ${normalizePersonNameSql(nameCol)} AS new_name
          FROM ${table}
          WHERE ${nameCol} ~ ${pattern}
        ) joined
        ORDER BY joined.new_name, joined.id
      )
      UPDATE ${table}
      SET ${sql.identifier(nameCol.name)} = candidates.new_name,
          ${sql.identifier(sortNameCol.name)} = ${normalizePersonNameSql(sortNameCol)}
      FROM candidates
      WHERE ${idCol} = candidates.id
        AND NOT EXISTS (SELECT 1 FROM ${table} other WHERE other.${sql.identifier(nameCol.name)} = candidates.new_name)
      RETURNING ${idCol} AS id
    `);
    return result.rows.map((row) => Number(row.id));
  }
}
