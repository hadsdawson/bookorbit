import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class BackupRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  /** Hashes of every migration the database has run, recorded in a backup so a newer one is refused on restore. */
  async migrationLedgerHashes(): Promise<string[]> {
    const result = await this.db.execute<{ hash: string }>(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`);
    return result.rows.map((row) => row.hash);
  }
}
