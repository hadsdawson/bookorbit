import { Inject, Injectable } from '@nestjs/common';
import { countDistinct, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class CommunityRatingsRefreshRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async countBooksWithRatings(): Promise<number> {
    const [row] = await this.db.select({ count: countDistinct(schema.bookCommunityRatings.bookId) }).from(schema.bookCommunityRatings);
    return row?.count ?? 0;
  }

  /** The next batch of books that have at least one rating, in id order, for a pass that can resume. */
  async findBookIdsWithRatings(afterBookId: number, limit: number): Promise<number[]> {
    const rows = await this.db
      .selectDistinct({ bookId: schema.bookCommunityRatings.bookId })
      .from(schema.bookCommunityRatings)
      .where(gt(schema.bookCommunityRatings.bookId, afterBookId))
      .orderBy(schema.bookCommunityRatings.bookId)
      .limit(limit);
    return rows.map((row) => row.bookId);
  }
}
