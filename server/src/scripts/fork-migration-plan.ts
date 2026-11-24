/**
 * Fork only. Works out how upstream's and this fork's migration journals join after a merge (see
 * docs/FORK_UPSTREAM_MERGES.md): upstream's entries exactly as upstream has them, then the fork's own,
 * renumbered to follow. Pure so it can be tested; renumber-fork-migrations.ts applies the result.
 */

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface ForkMigrationMove {
  fromTag: string;
  toTag: string;
  fromSnapshot: string;
  toSnapshot: string;
}

export interface ForkMigrationPlan {
  journal: Journal;
  moves: ForkMigrationMove[];
  upstreamTags: string[];
  /** Fork tags (new names) written before upstream's newest migration, for fork-migrations.ts. */
  forkTagsBeforeUpstreamTimes: string[];
}

export function migrationPrefix(idx: number): string {
  return idx.toString().padStart(4, '0');
}

export function snapshotFileName(idx: number): string {
  return `${migrationPrefix(idx)}_snapshot.json`;
}

function migrationName(tag: string): string {
  const match = /^\d{4}_(.+)$/.exec(tag);
  if (!match) throw new Error(`Migration tag "${tag}" does not start with a four-digit number`);
  return match[1]!;
}

/**
 * `ours` is the fork's journal before the merge, `theirs` upstream's. A fork migration is any entry
 * of ours whose tag upstream does not have. Their SQL and `when` never change, only their numbers.
 */
export function planForkMigrations(ours: Journal, theirs: Journal): ForkMigrationPlan {
  const upstreamTags = new Set(theirs.entries.map((entry) => entry.tag));
  const forkEntries = ours.entries.filter((entry) => !upstreamTags.has(entry.tag));
  const forkNames = new Set(forkEntries.map((entry) => migrationName(entry.tag)));
  for (const tag of upstreamTags) {
    if (forkNames.has(migrationName(tag))) {
      throw new Error(`Upstream migration "${tag}" has the same name as a fork migration; sort this one out by hand`);
    }
  }
  const sharedTags = ours.entries.filter((entry) => upstreamTags.has(entry.tag)).map((entry) => entry.tag);
  const upstreamPrefix = theirs.entries.slice(0, sharedTags.length).map((entry) => entry.tag);
  if (sharedTags.some((tag, index) => tag !== upstreamPrefix[index])) {
    throw new Error("The fork's journal lists upstream's migrations in a different order from upstream; sort this one out by hand");
  }
  const newestUpstream = theirs.entries.reduce((max, entry) => Math.max(max, entry.when), 0);
  const moves: ForkMigrationMove[] = [];
  const forkTagsBeforeUpstreamTimes: string[] = [];
  const renumbered = forkEntries.map((entry, offset) => {
    const idx = theirs.entries.length + offset;
    const tag = `${migrationPrefix(idx)}_${migrationName(entry.tag)}`;
    moves.push({ fromTag: entry.tag, toTag: tag, fromSnapshot: snapshotFileName(entry.idx), toSnapshot: snapshotFileName(idx) });
    if (entry.when < newestUpstream) forkTagsBeforeUpstreamTimes.push(tag);
    return { ...entry, idx, tag };
  });

  return {
    journal: { ...theirs, entries: [...theirs.entries.map((entry) => ({ ...entry })), ...renumbered] },
    moves,
    upstreamTags: [...upstreamTags],
    forkTagsBeforeUpstreamTimes,
  };
}

/** Rewrites the Set in fork-migrations.ts to list exactly `tags`. */
export function rewriteForkMigrationList(source: string, tags: readonly string[]): string {
  const pattern = /(FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES: ReadonlySet<string> = new Set\(\[)[\s\S]*?(\]\);)/;
  if (!pattern.test(source)) throw new Error('Could not find FORK_MIGRATIONS_BEFORE_UPSTREAM_TIMES in fork-migrations.ts');
  const body = tags.length === 0 ? '' : `\n${tags.map((tag) => `  '${tag}',`).join('\n')}\n`;
  return source.replace(pattern, `$1${body}$2`);
}
