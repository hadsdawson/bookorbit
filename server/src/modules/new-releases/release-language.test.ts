import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { releaseLanguageCondition } from './new-releases.repository';

const dialect = new PgDialect();

describe('releaseLanguageCondition (fork)', () => {
  it('filters nothing when any language is allowed', () => {
    expect(dialect.sqlToQuery(releaseLanguageCondition(null, true)).sql).toBe('TRUE');
  });

  it('treats a source with no matching language as another language, even when its single language is unset', () => {
    const query = dialect.sqlToQuery(releaseLanguageCondition('en', false));
    expect(query.sql).toContain("COALESCE(src->>'language' = $1, false)");
    expect(query.sql).toContain('NOT EXISTS');
    expect(query.sql).not.toContain('AND EXISTS');
    expect(query.params).toEqual(['en', 'en']);
  });

  it('asks for a stated match when strict', () => {
    const query = dialect.sqlToQuery(releaseLanguageCondition('en', true));
    expect(query.sql).toContain('AND EXISTS');
    expect(query.params).toEqual(['en', 'en', 'en', 'en']);
  });
});
