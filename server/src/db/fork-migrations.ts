/**
 * Fork only. These migrations were written in this fork before upstream's 0143 to 0162 reached it,
 * and were renumbered after upstream's when the two were merged. Their SQL and journal `when` stay as
 * first deployed, because databases record them by both, so their times fall between upstream's
 * instead of after them. The journal tests check their order among themselves rather than against
 * upstream's entries. Databases that ran them before upstream's catch up through
 * applySkippedMigrations in server/src/scripts/skipped-migration-compatibility.ts.
 */
export const FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES: ReadonlySet<string> = new Set([
  '0163_request_tracking_and_not_interested',
  '0164_folder_covers_and_metadata_json',
  '0165_chapters_write_on_save',
  '0166_age_ratings_and_sort_keys',
  '0167_new_releases',
  '0168_rename_on_add_file',
  '0169_remove_age_ratings',
  '0170_author_links',
  '0171_author_aliases',
  '0172_request_tracking_source',
  '0173_author_pen_names',
  '0174_book_dock_merged_into',
  '0175_book_request_tracking_grabbed',
  '0176_person_name_key_indexes',
  '0177_book_request_saved_views',
  '0178_book_pinned_primary_file',
]);

/** The entry each journal entry's `when` must be later than, or undefined for the first of its kind. */
export function previousComparableEntry<T extends { tag: string }>(entries: readonly T[], index: number): T | undefined {
  const forkOnly = FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES.has(entries[index]!.tag);
  for (let i = index - 1; i >= 0; i -= 1) {
    if (FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES.has(entries[i]!.tag) === forkOnly) return entries[i];
  }
  return undefined;
}
