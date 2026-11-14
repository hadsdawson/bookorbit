import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizePersonNameSql } from '../../common/utils/person-name.utils';
import { DB } from '../../db';
import { refreshPrimaryAuthorSortNamesForAuthors } from '../../db/book-author-sort-key';
import * as schema from '../../db/schema';
import { authors, narrators } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const SPACED_INITIALS_PATTERN = '[[:upper:]]\\.[[:space:]]+[[:upper:]]\\.';

/**
 * Fork: rewrites existing author and narrator names from "A. J. Clack" to "A.J. Clack" on every boot.
 * A name whose joined form already belongs to another row is left alone, so the two show up in
 * Tools > Duplicates to merge, rather than being merged here without a person deciding.
 */
@Injectable()
export class PersonNameBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PersonNameBackfillService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'person_name.join_initials';
    const startedAt = Date.now();
    try {
      const authorIds = await this.joinInitials(authors, authors.id, authors.name, authors.sortName);
      if (authorIds.length > 0) await refreshPrimaryAuthorSortNamesForAuthors(this.db, authorIds);
      const narratorIds = await this.joinInitials(narrators, narrators.id, narrators.name, narrators.sortName);
      if (authorIds.length > 0 || narratorIds.length > 0) {
        this.logger.log(
          `[${event}] [end] durationMs=${Date.now() - startedAt} authorsRenamed=${authorIds.length} narratorsRenamed=${narratorIds.length} - initials joined`,
        );
      }
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - joining initials failed`,
      );
    }
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
