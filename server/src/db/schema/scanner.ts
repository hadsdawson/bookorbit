import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';
import { libraries } from './libraries';
import { libraryFolders } from './libraries';

export const scanJobs = pgTable(
  'scan_jobs',
  {
    id: serial('id').primaryKey(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    triggeredBy: varchar('triggered_by', { length: 20 }).notNull(),
    addedCount: integer('added_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    missingCount: integer('missing_count').notNull().default(0),
    errorMessage: text('error_message'),
    changesTruncated: boolean('changes_truncated').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('scan_jobs_library_status_idx').on(t.libraryId, t.status),
    index('scan_jobs_library_started_at_idx').on(t.libraryId, sql`${t.startedAt} desc`),
    // History and Failed in the Jobs area; a background scan that found nothing is not listed.
    index('scan_jobs_history_idx')
      .on(sql`coalesce(${t.completedAt}, ${t.startedAt}) desc`, sql`${t.id} desc`)
      .where(
        sql`${t.status} in ('completed', 'failed') and not (${t.status} = 'completed' and ${t.triggeredBy} <> 'manual' and ${t.addedCount} = 0 and ${t.updatedCount} = 0 and ${t.missingCount} = 0)`,
      ),
    check('scan_jobs_status_chk', sql`${t.status} in ('running', 'completed', 'failed')`),
    check('scan_jobs_triggered_by_chk', sql`${t.triggeredBy} in ('manual', 'watcher', 'schedule')`),
    check('scan_jobs_added_count_nonnegative_chk', sql`${t.addedCount} >= 0`),
    check('scan_jobs_updated_count_nonnegative_chk', sql`${t.updatedCount} >= 0`),
    check('scan_jobs_missing_count_nonnegative_chk', sql`${t.missingCount} >= 0`),
  ],
);

export type ScanJob = typeof scanJobs.$inferSelect;
export type NewScanJob = typeof scanJobs.$inferInsert;

/** Fork: one book a scan added, changed, restored or found missing, with the field values before and after. */
export const scanJobChanges = pgTable(
  'scan_job_changes',
  {
    id: serial('id').primaryKey(),
    scanJobId: integer('scan_job_id')
      .notNull()
      .references(() => scanJobs.id, { onDelete: 'cascade' }),
    bookId: integer('book_id').references(() => books.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 1000 }),
    authors: text('authors'),
    folderPath: varchar('folder_path', { length: 4096 }),
    changeType: varchar('change_type', { length: 20 }).notNull(),
    fieldChanges: jsonb('field_changes')
      .$type<Array<{ field: string; old: string | null; new: string | null }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('scan_job_changes_job_idx').on(t.scanJobId, t.id),
    index('scan_job_changes_book_idx').on(t.bookId),
    check('scan_job_changes_type_chk', sql`${t.changeType} in ('added', 'updated', 'missing', 'restored')`),
  ],
);

export type ScanJobChange = typeof scanJobChanges.$inferSelect;
export type NewScanJobChange = typeof scanJobChanges.$inferInsert;

export const libraryDirScanState = pgTable(
  'library_dir_scan_state',
  {
    id: serial('id').primaryKey(),
    libraryFolderId: integer('library_folder_id')
      .notNull()
      .references(() => libraryFolders.id, { onDelete: 'cascade' }),
    dirPath: varchar('dir_path', { length: 4096 }).notNull(),
    lastSeenMtimeMs: bigint('last_seen_mtime_ms', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('library_dir_scan_state_folder_dir_uidx').on(t.libraryFolderId, t.dirPath),
    index('library_dir_scan_state_folder_idx').on(t.libraryFolderId),
  ],
);

export type LibraryDirScanState = typeof libraryDirScanState.$inferSelect;
