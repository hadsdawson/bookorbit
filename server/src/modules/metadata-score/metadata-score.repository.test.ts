import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { bookMetadata } from '../../db/schema';
import { METADATA_SCORE_BASE_SELECT } from './metadata-score.repository';

describe('METADATA_SCORE_BASE_SELECT', () => {
  it('checks for an M4B on the scored book, not on any book', () => {
    const pool = new Pool();
    const { sql } = drizzle(pool).select(METADATA_SCORE_BASE_SELECT).from(bookMetadata).toSQL();
    void pool.end();

    expect(sql).toContain('where f.book_id = book_metadata.book_id and');
  });
});
