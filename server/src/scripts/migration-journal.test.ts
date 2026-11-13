import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const MIGRATIONS_DIRECTORY = join(__dirname, '..', 'db', 'migrations');

/**
 * Fork only. Upstream and this fork both add migrations, and a merge joins the two lists by hand in
 * meta/_journal.json. Drizzle trusts that file completely, so a slip there (an entry dropped, two
 * entries swapped, a file left out) only shows up as a broken or half-updated database at startup.
 * These checks catch it in CI instead. See docs/FORK_UPSTREAM_MERGES.md for how to fix a failure.
 */
describe('migration journal', () => {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIRECTORY, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] };
  const entries = journal.entries;
  const sqlTags = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();

  it('lists every migration file exactly once, and nothing else', () => {
    const tags = entries.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect([...tags].sort()).toEqual(sqlTags);
  });

  it('numbers its entries in order with no gaps', () => {
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index));
  });

  it('keeps its entries in the order they were written, each with its own time', () => {
    const outOfOrder = entries.filter((entry, index) => index > 0 && entry.when <= entries[index - 1]!.when).map((entry) => entry.tag);
    expect(outOfOrder).toEqual([]);
  });
});
