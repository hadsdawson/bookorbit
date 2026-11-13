import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { AgeRating } from '@bookorbit/types';
import * as schema from '../../db/schema';

type Executor = Pick<NodePgDatabase<typeof schema>, 'select' | 'update'>;

/**
 * Fork: sets a book's age rating. When the book is in one or more series, the rating becomes those
 * series' rating and every member book's own rating too, so it holds for books that join later and
 * for a book that later leaves the series. Returns the ids of every book whose rating was written.
 * Shared by the metadata editor and Book Dock so both spread a rating the same way.
 */
export async function setBookAgeRating(executor: Executor, bookId: number, ageRating: AgeRating | null): Promise<number[]> {
  const now = new Date();
  const seriesIds = (
    await executor
      .select({ seriesId: schema.bookSeriesMemberships.seriesId })
      .from(schema.bookSeriesMemberships)
      .where(eq(schema.bookSeriesMemberships.bookId, bookId))
  ).map((row) => row.seriesId);
  let bookIds = [bookId];
  if (seriesIds.length > 0) {
    await executor.update(schema.bookSeries).set({ ageRating }).where(inArray(schema.bookSeries.id, seriesIds));
    const members = await executor
      .select({ bookId: schema.bookSeriesMemberships.bookId })
      .from(schema.bookSeriesMemberships)
      .where(inArray(schema.bookSeriesMemberships.seriesId, seriesIds));
    bookIds = [...new Set([bookId, ...members.map((row) => row.bookId)])];
  }
  await executor.update(schema.bookMetadata).set({ ageRating, updatedAt: now }).where(inArray(schema.bookMetadata.bookId, bookIds));
  // Who may see these books changes with the rating, so devices are told to look again.
  await executor.update(schema.books).set({ updatedAt: now }).where(inArray(schema.books.id, bookIds));
  return bookIds;
}
