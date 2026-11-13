import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { and, asc } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';

import { EMPTY_CONTENT_FILTER_RULES, type ContentFilterRules } from '@bookorbit/types';
import { setBookAgeRating } from '../src/common/utils/age-rating-write.utils';
import { buildContentFilterClauses } from '../src/common/utils/content-filter-sql.utils';
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
    .filter((statement) => tables.some((table) => statement.includes(`ON "${table}"`) || statement.startsWith(`ALTER TABLE "${table}"`)));
}

/**
 * Fork: age ratings and article-free sort keys against a real PostgreSQL. Only the tables these
 * features touch are created, with the columns the queries use; the new columns, checks and
 * indexes come from the generated migration itself.
 */
describe('Age ratings and sort keys (e2e)', { timeout: 60_000 }, () => {
  let admin: Client;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let databaseName: string;

  beforeAll(async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    databaseName = `age_rating_${randomUUID().replace(/-/g, '').slice(0, 12)}_e2e`;
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

  async function visible(rules: Partial<ContentFilterRules>): Promise<number[]> {
    const clauses = buildContentFilterClauses({ ...EMPTY_CONTENT_FILTER_RULES, ...rules }, db);
    const rows = await db
      .select({ id: schema.books.id })
      .from(schema.books)
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(asc(schema.books.id));
    return rows.map((row) => row.id);
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

  it('gives a rating chosen on one book to its whole series, including books added later', async () => {
    const expanse = await addSeries('The Expanse');
    const first = await addBook('Leviathan Wakes', expanse);
    const second = await addBook("Caliban's War", expanse);
    const standalone = await addBook('Dune');

    expect((await setBookAgeRating(db, first, 16)).sort()).toEqual([first, second].sort());
    const later = await addBook("Abaddon's Gate", expanse);

    expect(await visible({ excludeAgeRatings: [16] })).toEqual([standalone]);
    expect(await visible({ includeAgeRatings: [16] })).toEqual([first, second, later]);

    const { rows } = await pool.query('SELECT book_id, age_rating FROM book_metadata ORDER BY book_id');
    expect(rows).toEqual([
      { book_id: first, age_rating: 16 },
      { book_id: second, age_rating: 16 },
      { book_id: standalone, age_rating: null },
      { book_id: later, age_rating: null },
    ]);
  });

  it('treats a book with no rating as Not rated, which can be shown or hidden', async () => {
    const rated = await addBook('Charlotte’s Web');
    const unrated = await addBook('Dune');
    await setBookAgeRating(db, rated, 0);

    expect(await visible({ includeAgeRatings: [0] })).toEqual([rated]);
    expect(await visible({ includeAgeRatings: [0, -1] })).toEqual([rated, unrated]);
    expect(await visible({ excludeAgeRatings: [-1] })).toEqual([rated]);
    expect(await visible({ excludeAgeRatings: [18] })).toEqual([rated, unrated]);
    expect(await visible({})).toEqual([rated, unrated]);
  });

  it("lets a series' rating win over a book's own, and clearing it clears the series", async () => {
    const series = await addSeries('Discworld');
    const book = await addBook('Mort', series);
    await pool.query('UPDATE book_metadata SET age_rating = 10 WHERE book_id = $1', [book]);
    await pool.query('UPDATE book_series SET age_rating = 13 WHERE id = $1', [series]);

    expect(await visible({ includeAgeRatings: [13] })).toEqual([book]);
    expect(await visible({ includeAgeRatings: [10] })).toEqual([]);

    await setBookAgeRating(db, book, null);
    expect(await visible({ includeAgeRatings: [-1] })).toEqual([book]);
    const { rows } = await pool.query('SELECT age_rating FROM book_series WHERE id = $1', [series]);
    expect(rows[0].age_rating).toBeNull();
  });

  it('refuses a rating that is not one of the five', async () => {
    const book = await addBook('Dune');
    await expect(pool.query('UPDATE book_metadata SET age_rating = 12 WHERE book_id = $1', [book])).rejects.toThrow(/bm_age_rating_chk/);
  });
});
