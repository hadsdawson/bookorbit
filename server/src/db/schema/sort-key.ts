import { sql, type SQL } from 'drizzle-orm';

/**
 * Fork: the leading words ignored when sorting titles and series names, so "The Hobbit" files
 * under H. English only, matching how libraries shelve. Each needs whitespace after it, so a title
 * that is only "The" or that starts with "Theory" keeps its first word.
 */
export const LEADING_ARTICLE_PATTERN = '^(the|an|a)[[:space:]]+';

/**
 * The stored sort key for a name column: lower case, trimmed, leading article removed, and NULL
 * when nothing is left. Kept as a generated column so every list sorts on the same indexed value.
 */
export function sortKeyFromColumn(column: string): SQL {
  return sql.raw(`NULLIF(regexp_replace(lower(btrim(${column})), '${LEADING_ARTICLE_PATTERN}', ''), '')`);
}
