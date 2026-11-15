import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

export interface RecycleBinFolder {
  path: string;
  libraryName: string;
}

@Injectable()
export class RecycleBinRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  /** Every library folder on the server; each one keeps its own recycle bin. */
  async findLibraryFolders(): Promise<RecycleBinFolder[]> {
    return this.db
      .select({ path: schema.libraryFolders.path, libraryName: schema.libraries.name })
      .from(schema.libraryFolders)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.libraryFolders.libraryId))
      .orderBy(asc(schema.libraryFolders.id));
  }
}
