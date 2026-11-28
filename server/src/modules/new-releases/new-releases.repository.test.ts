import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { NewReleasesRepository } from './new-releases.repository';

function makeRepo() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const repo = new NewReleasesRepository({ execute } as never);
  const compiled = () => new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
  return { repo, compiled };
}

const WINDOW = { retentionDays: 30 };

describe('NewReleasesRepository.listForUser', () => {
  it('leaves out a book the user has an active request for', async () => {
    const { repo, compiled } = makeRepo();
    await repo.listForUser(5, WINDOW, 100);
    const { sql } = compiled();
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('lower(br.title) = lower(r.title)');
  });

  it('lists requested books along with the hidden ones', async () => {
    const { repo, compiled } = makeRepo();
    await repo.listForUser(5, WINDOW, 100, { includeHidden: true });
    expect(compiled().sql).not.toContain('NOT EXISTS');
  });
});

describe('NewReleasesRepository.findPendingAutoRequests', () => {
  it('files requests for everything followed, or only for books of a followed series', async () => {
    const { repo, compiled } = makeRepo();
    await repo.findPendingAutoRequests('series', 10);
    const { sql, params } = compiled();
    expect(sql).toContain("= 'request'");
    expect(sql).toContain("= 'series' AND f.kind = 'series'");
    expect(params).toContain('series');
  });
});
