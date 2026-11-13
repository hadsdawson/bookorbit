import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { books } from './books';
import { authors } from './metadata';
import { bookSeries } from './series';

/**
 * Fork only. An author or series one user follows for books that are not out yet. Matched to
 * releases by `nameKey`, so a follow keeps working when the library's author or series row goes.
 */
export const releaseFollows = pgTable(
  'release_follows',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 10 }).notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    nameKey: varchar('name_key', { length: 500 }).notNull(),
    authorId: integer('author_id').references(() => authors.id, { onDelete: 'set null' }),
    seriesId: integer('series_id').references(() => bookSeries.id, { onDelete: 'set null' }),
    /** For a series, its author when followed, so a same-named series by someone else is not mixed in. */
    authorHint: varchar('author_hint', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('release_follows_user_kind_key_uidx').on(t.userId, t.kind, t.nameKey),
    index('release_follows_kind_key_idx').on(t.kind, t.nameKey),
    check('release_follows_kind_chk', sql`${t.kind} IN ('author', 'series')`),
  ],
);

/**
 * Fork only. When each followed name was last looked up. One row per name however many people
 * follow it, so the weekly check visits it once.
 */
export const releaseChecks = pgTable(
  'release_checks',
  {
    kind: varchar('kind', { length: 10 }).notNull(),
    nameKey: varchar('name_key', { length: 500 }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    found: integer('found').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.kind, t.nameKey] }), index('release_checks_checked_at_idx').on(t.checkedAt)],
);

/**
 * Fork only. A book that is not out yet, found for some follow. Shared by every user: who sees it
 * is worked out from their follows. Dates are confirmed full dates or null; `sources` keeps what
 * each source reported, so a later check can confirm or drop a date.
 */
export const upcomingReleases = pgTable(
  'upcoming_releases',
  {
    id: serial('id').primaryKey(),
    workKey: varchar('work_key', { length: 600 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    authors: text('authors').array().notNull(),
    authorKeys: text('author_keys').array().notNull(),
    seriesName: varchar('series_name', { length: 500 }),
    seriesKey: varchar('series_key', { length: 500 }),
    seriesIndex: real('series_index'),
    coverUrl: varchar('cover_url', { length: 2048 }),
    isbn13: varchar('isbn13', { length: 13 }),
    asin: varchar('asin', { length: 20 }),
    ebookDate: date('ebook_date', { mode: 'string' }),
    audiobookDate: date('audiobook_date', { mode: 'string' }),
    releaseDate: date('release_date', { mode: 'string' }),
    sources: jsonb('sources')
      .notNull()
      .default(sql`'[]'::jsonb`),
    ownedBookId: integer('owned_book_id').references(() => books.id, { onDelete: 'set null' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('upcoming_releases_work_key_uidx').on(t.workKey),
    index('upcoming_releases_series_key_idx').on(t.seriesKey),
    index('upcoming_releases_author_keys_idx').using('gin', t.authorKeys),
    index('upcoming_releases_release_date_idx').on(t.releaseDate),
  ],
);

/** Fork only. What one user did with one release: asked for it, or hid it. */
export const releaseUserStates = pgTable(
  'release_user_states',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    releaseId: integer('release_id')
      .notNull()
      .references(() => upcomingReleases.id, { onDelete: 'cascade' }),
    state: varchar('state', { length: 12 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.releaseId] }), check('release_user_states_state_chk', sql`${t.state} IN ('requested', 'dismissed')`)],
);

/** Fork only. A user's own New Releases choices; no row means the defaults. */
export const releaseUserSettings = pgTable(
  'release_user_settings',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    delivery: varchar('delivery', { length: 10 }),
    retentionDays: smallint('retention_days').notNull().default(30),
  },
  (t) => [
    check('release_user_settings_delivery_chk', sql`${t.delivery} IS NULL OR ${t.delivery} IN ('suggest', 'request')`),
    check('release_user_settings_retention_chk', sql`${t.retentionDays} IN (15, 30, 60, 90)`),
  ],
);
