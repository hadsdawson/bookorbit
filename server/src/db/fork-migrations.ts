/**
 * Fork only. These migrations were written in this fork before upstream's 0143 to 0161 reached it,
 * and were renumbered after upstream's when the two were merged. Their SQL and journal `when` stay as
 * first deployed, because databases record them by both, so their times fall between upstream's
 * instead of after them. The journal tests check their order among themselves rather than against
 * upstream's entries. Databases that ran them before upstream's catch up through
 * applySkippedMigrations in server/src/scripts/skipped-migration-compatibility.ts.
 */
export const FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES: ReadonlySet<string> = new Set([
  '0162_request_tracking_and_not_interested',
  '0163_folder_covers_and_metadata_json',
  '0164_chapters_write_on_save',
  '0165_age_ratings_and_sort_keys',
  '0166_new_releases',
  '0167_rename_on_add_file',
  '0168_remove_age_ratings',
  '0169_author_links',
  '0170_author_aliases',
  '0171_request_tracking_source',
  '0172_author_pen_names',
  '0173_book_dock_merged_into',
  '0174_book_request_tracking_grabbed',
]);

/** The entry each journal entry's `when` must be later than, or undefined for the first of its kind. */
export function previousComparableEntry<T extends { tag: string }>(entries: readonly T[], index: number): T | undefined {
  const forkOnly = FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES.has(entries[index]!.tag);
  for (let i = index - 1; i >= 0; i -= 1) {
    if (FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES.has(entries[i]!.tag) === forkOnly) return entries[i];
  }
  return undefined;
}
