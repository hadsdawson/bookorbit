import { type Journal, type JournalEntry, planForkMigrations, rewriteForkMigrationList } from './fork-migration-plan';

function entry(idx: number, name: string, when: number): JournalEntry {
  return { idx, version: '7', when, tag: `${idx.toString().padStart(4, '0')}_${name}`, breakpoints: true };
}

function journal(entries: JournalEntry[]): Journal {
  return { version: '7', dialect: 'postgresql', entries };
}

describe('planForkMigrations', () => {
  const shared = [entry(0, 'init', 100), entry(1, 'books', 200)];

  it("keeps upstream's entries as upstream has them and moves the fork's after them, times unchanged", () => {
    const ours = journal([...shared, entry(2, 'fork_tracking', 300), entry(3, 'fork_covers', 700)]);
    const theirs = journal([...shared, entry(2, 'upstream_editions', 500)]);

    const plan = planForkMigrations(ours, theirs);

    expect(plan.journal.entries.map((e) => [e.idx, e.tag, e.when])).toEqual([
      [0, '0000_init', 100],
      [1, '0001_books', 200],
      [2, '0002_upstream_editions', 500],
      [3, '0003_fork_tracking', 300],
      [4, '0004_fork_covers', 700],
    ]);
    expect(plan.moves).toEqual([
      { fromTag: '0002_fork_tracking', toTag: '0003_fork_tracking', fromSnapshot: '0002_snapshot.json', toSnapshot: '0003_snapshot.json' },
      { fromTag: '0003_fork_covers', toTag: '0004_fork_covers', fromSnapshot: '0003_snapshot.json', toSnapshot: '0004_snapshot.json' },
    ]);
    expect(plan.forkTagsBeforeUpstreamTimes).toEqual(['0003_fork_tracking']);
  });

  it('changes nothing when run again on an already joined journal', () => {
    const joined = journal([...shared, entry(2, 'upstream_editions', 500), entry(3, 'fork_tracking', 300)]);
    const theirs = journal([...shared, entry(2, 'upstream_editions', 500)]);

    const plan = planForkMigrations(joined, theirs);

    expect(plan.journal).toEqual(joined);
    expect(plan.moves.every((move) => move.fromTag === move.toTag)).toBe(true);
  });

  it('refuses an upstream migration with the same name as a fork one', () => {
    const ours = journal([...shared, entry(2, 'tracking', 300)]);
    const theirs = journal([...shared, entry(2, 'editions', 500), entry(3, 'tracking', 600)]);

    expect(() => planForkMigrations(ours, theirs)).toThrow(/same name/);
  });

  it("refuses a fork journal that lists upstream's migrations in another order", () => {
    const ours = journal([shared[1]!, shared[0]!]);
    const theirs = journal(shared);

    expect(() => planForkMigrations(ours, theirs)).toThrow(/different order/);
  });
});

describe('rewriteForkMigrationList', () => {
  const source = "export const FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES: ReadonlySet<string> = new Set([\n  '0001_old',\n]);\n";

  it('lists exactly the given tags', () => {
    expect(rewriteForkMigrationList(source, ['0003_a', '0004_b'])).toBe(
      "export const FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES: ReadonlySet<string> = new Set([\n  '0003_a',\n  '0004_b',\n]);\n",
    );
  });

  it('leaves an empty set when no fork migration predates upstream', () => {
    expect(rewriteForkMigrationList(source, [])).toBe('export const FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES: ReadonlySet<string> = new Set([]);\n');
  });
});
