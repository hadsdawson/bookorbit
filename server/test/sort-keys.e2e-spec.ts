import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { asc } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';

import * as schema from '../src/db/schema';

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** The statements of the new migration that touch books and series, run as written. */
function migrationStatementsFor(tables: string[]): string[] {
  const text = readFileSync(join(__dirname, '../src/db/migrations/0146_age_ratings_and_sort_keys.sql'), 'utf8');
  return text
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => !statement.includes('age_rating'))
    .filter((statement) => tables.some((table) => statement.includes(`ON "${table}"`) || statement.startsWith(`ALTER TABLE "${table}"`)));
}

/**
 * Fork: article-free sort keys against a real PostgreSQL. Only the tables they touch are created,
 * with the columns the queries use; the sort key columns and indexes come from the migration
 * itself. Its age rating statements are skipped: that feature was removed later.
 */
describe('Sort keys (e2e)', { timeout: 60_000 }, () => {
  let admin: Client;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let databaseName: string;

  beforeAll(async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    databaseName = `sort_keys_${randomUUID().replace(/-/g, '').slice(0, 12)}_e2e`;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';
    admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
    pool = new Pool({ connectionString: targetUrl.toString(), max: 2 });
    pool.on('error', () => undefined);
    db = drizzle(pool, { schema });
    await pool.query(`
      CREATE TABLE books (id serial PRIMARY KEY, updated_at timestamptz);
      CREATE TABLE book_metadata (book_id integer PRIMARY KEY, title varchar(1000), series_name varchar(500), updated_at timestamptz);
      CREATE TABLE book_series (id serial PRIMARY KEY, name varchar(500) NOT NULL, updated_at timestamptz);
      CREATE TABLE book_series_memberships (book_id integer NOT NULL, series_id integer NOT NULL, display_order integer NOT NULL DEFAULT 0);
    `);
    for (const statement of migrationStatementsFor(['book_metadata', 'book_series'])) await pool.query(statement);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE)`);
    await admin.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE books, book_metadata, book_series, book_series_memberships RESTART IDENTITY');
  });

  async function addBook(title: string, seriesId?: number): Promise<number> {
    const { rows } = await pool.query<{ id: number }>('INSERT INTO books (updated_at) VALUES (now()) RETURNING id');
    const id = rows[0]!.id;
    await pool.query('INSERT INTO book_metadata (book_id, title) VALUES ($1, $2)', [id, title]);
    if (seriesId !== undefined) await pool.query('INSERT INTO book_series_memberships (book_id, series_id) VALUES ($1, $2)', [id, seriesId]);
    return id;
  }

  async function addSeries(name: string): Promise<number> {
    const { rows } = await pool.query<{ id: number }>('INSERT INTO book_series (name) VALUES ($1) RETURNING id', [name]);
    return rows[0]!.id;
  }

  it('sorts titles and series names without a leading "The", "A" or "An"', async () => {
    for (const title of ['The Hobbit', 'A Wizard of Earthsea', 'Anansi Boys', 'Theory of Everything', '  An Echo', 'Dune']) await addBook(title);
    await addSeries('The Expanse');
    await addSeries('Discworld');

    const titles = await db.select({ title: schema.bookMetadata.title }).from(schema.bookMetadata).orderBy(asc(schema.bookMetadata.titleSortKey));
    expect(titles.map((row) => row.title)).toEqual([
      'Anansi Boys',
      'Dune',
      '  An Echo',
      'The Hobbit',
      'Theory of Everything',
      'A Wizard of Earthsea',
    ]);

    const series = await db.select({ name: schema.bookSeries.name }).from(schema.bookSeries).orderBy(asc(schema.bookSeries.nameSortKey));
    expect(series.map((row) => row.name)).toEqual(['Discworld', 'The Expanse']);

    await pool.query(`UPDATE book_metadata SET series_name = 'The Wheel of Time' WHERE title = 'Dune'`);
    const { rows } = await pool.query('SELECT series_name_sort_key FROM book_metadata WHERE title = $1', ['Dune']);
    expect(rows[0].series_name_sort_key).toBe('wheel of time');
  });
});
