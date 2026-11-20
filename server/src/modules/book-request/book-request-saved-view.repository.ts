import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BookRequestSavedViewFilters } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookRequestSavedViews } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
export type BookRequestSavedViewRow = typeof bookRequestSavedViews.$inferSelect;

@Injectable()
export class BookRequestSavedViewRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(userId: number): Promise<BookRequestSavedViewRow[]> {
    return this.db
      .select()
      .from(bookRequestSavedViews)
      .where(eq(bookRequestSavedViews.userId, userId))
      .orderBy(asc(sql`lower(${bookRequestSavedViews.name})`), asc(bookRequestSavedViews.id));
  }

  async count(userId: number): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(bookRequestSavedViews).where(eq(bookRequestSavedViews.userId, userId));
    return row?.total ?? 0;
  }

  async exists(userId: number, name: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: bookRequestSavedViews.id })
      .from(bookRequestSavedViews)
      .where(and(eq(bookRequestSavedViews.userId, userId), eq(bookRequestSavedViews.name, name)))
      .limit(1);
    return row !== undefined;
  }

  /** Saving under a name the person already has replaces that view's filters. */
  async upsert(userId: number, name: string, filters: BookRequestSavedViewFilters): Promise<BookRequestSavedViewRow> {
    const [row] = await this.db
      .insert(bookRequestSavedViews)
      .values({ userId, name, filters })
      .onConflictDoUpdate({
        target: [bookRequestSavedViews.userId, bookRequestSavedViews.name],
        set: { filters, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async remove(userId: number, id: number): Promise<boolean> {
    const rows = await this.db
      .delete(bookRequestSavedViews)
      .where(and(eq(bookRequestSavedViews.id, id), eq(bookRequestSavedViews.userId, userId)))
      .returning({ id: bookRequestSavedViews.id });
    return rows.length > 0;
  }
}
