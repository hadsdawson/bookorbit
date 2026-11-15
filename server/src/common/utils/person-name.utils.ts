import type { SQL, SQLWrapper } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { normalizeMetadataText, normalizeMetadataTextSql } from './metadata-text-normalize.utils';

// Fork: "A. J. Clack" and "A.J. Clack" are one person, written the second way.
const SPACED_INITIAL = /(?<![\p{L}\p{M}])(\p{Lu})\.\s+(?=\p{Lu}\.)/gu;
const SPACED_INITIAL_SQL = '(?<![[:alpha:]])([[:upper:]])\\.[[:space:]]+(?=[[:upper:]]\\.)';

export function joinNameInitials(value: string): string {
  return value.replace(SPACED_INITIAL, '$1.');
}

export function normalizePersonName(value: string | null | undefined): string | null {
  const normalized = normalizeMetadataText(value);
  return normalized ? joinNameInitials(normalized) : null;
}

export function normalizePersonNameKey(value: string | null | undefined): string | null {
  return normalizePersonName(value)?.toLowerCase() ?? null;
}

export function normalizePersonNameSql(value: SQLWrapper): SQL<string> {
  return sql<string>`regexp_replace(${normalizeMetadataTextSql(value)}, ${sql.raw(`'${SPACED_INITIAL_SQL}'`)}, '\\1.', 'g')`;
}

export function normalizePersonNameKeySql(value: SQLWrapper): SQL<string> {
  return sql<string>`lower(${normalizePersonNameSql(value)})`;
}
