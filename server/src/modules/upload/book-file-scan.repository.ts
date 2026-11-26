import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** Fork. The reads a scan of one book's folder needs. */
@Injectable()
export class BookFileScanRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findBook(bookId: number) {
    const [book] = await this.db
      .select({ id: books.id, libraryId: books.libraryId, folderPath: books.folderPath, organizationMode: libraries.organizationMode })
      .from(books)
      .innerJoin(libraries, eq(books.libraryId, libraries.id))
      .where(eq(books.id, bookId))
      .limit(1);
    return book ?? null;
  }

  async findFilePaths(bookId: number): Promise<Set<string>> {
    const rows = await this.db.select({ absolutePath: bookFiles.absolutePath }).from(bookFiles).where(eq(bookFiles.bookId, bookId));
    return new Set(rows.map((row) => row.absolutePath));
  }
}
