/**
 * Fork only. Settles the migration conflicts of an upstream merge, as docs/FORK_UPSTREAM_MERGES.md
 * describes, so a clash of numbers never needs doing by hand:
 *
 *   cd server && npx tsx src/scripts/renumber-fork-migrations.ts [--upstream upstream/main] [--ours HEAD]
 *
 * Run it during (or after) `git merge upstream/main`. It takes upstream's migrations, journal entries
 * and snapshots exactly from `--upstream`, moves the fork's own migrations (read from `--ours`) to the
 * numbers after upstream's newest with their SQL and `when` untouched, links the first fork snapshot to
 * upstream's newest, brings the newest snapshot up to the combined schema with drizzle-kit, rewrites the
 * list in src/db/fork-migrations.ts and stages the result. Running it again changes nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { type Journal, planForkMigrations, rewriteForkMigrationList, snapshotFileName } from './fork-migration-plan';

const SERVER_DIR = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(SERVER_DIR, 'src', 'db', 'migrations');
const META_DIR = join(MIGRATIONS_DIR, 'meta');
const JOURNAL_PATH = join(META_DIR, '_journal.json');
const FORK_LIST_PATH = join(SERVER_DIR, 'src', 'db', 'fork-migrations.ts');

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: SERVER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

const repoRoot = git(['rev-parse', '--show-toplevel']).trim();

function showAt(ref: string, absolutePath: string): string {
  return git(['show', `${ref}:${relative(repoRoot, absolutePath).split('\\').join('/')}`]);
}

function snapshotId(text: string): string {
  return (JSON.parse(text) as { id: string }).id;
}

function relinkPrevId(text: string, prevId: string): string {
  const pattern = /("prevId":\s*")[^"]*(")/;
  if (!pattern.test(text)) throw new Error('Snapshot has no prevId');
  return text.replace(pattern, `$1${prevId}$2`);
}

function refreshNewestSnapshot(journal: Journal): string | null {
  const before = new Set(readdirSync(MIGRATIONS_DIR));
  execFileSync('npx', ['drizzle-kit', 'generate', '--name', 'fork_snapshot_refresh'], { cwd: SERVER_DIR, stdio: 'pipe' });
  const generated = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql') && !before.has(file));
  if (generated.length === 0) return null;

  const generatedSqlPath = join(MIGRATIONS_DIR, generated[0]!);
  const sql = readFileSync(generatedSqlPath, 'utf8');
  const newest = journal.entries[journal.entries.length - 1]!;
  const newestPath = join(META_DIR, snapshotFileName(newest.idx));
  const generatedSnapshotPath = join(META_DIR, snapshotFileName(journal.entries.length));
  const current = JSON.parse(readFileSync(newestPath, 'utf8')) as { id: string; prevId: string };
  const refreshed = JSON.parse(readFileSync(generatedSnapshotPath, 'utf8')) as { id: string; prevId: string };
  refreshed.id = current.id;
  refreshed.prevId = current.prevId;
  writeFileSync(newestPath, `${JSON.stringify(refreshed, null, 2)}\n`);
  rmSync(generatedSqlPath);
  rmSync(generatedSnapshotPath);
  writeFileSync(JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`);
  return sql;
}

function main(): void {
  const upstreamRef = option('--upstream', 'upstream/main');
  const oursRef = option('--ours', 'HEAD');
  const ours = JSON.parse(showAt(oursRef, JOURNAL_PATH)) as Journal;
  const theirs = JSON.parse(showAt(upstreamRef, JOURNAL_PATH)) as Journal;
  const plan = planForkMigrations(ours, theirs);

  const forkFiles = plan.moves.map((move) => ({
    move,
    sql: showAt(oursRef, join(MIGRATIONS_DIR, `${move.fromTag}.sql`)),
    snapshot: showAt(oursRef, join(META_DIR, move.fromSnapshot)),
  }));

  for (const { move } of forkFiles) {
    rmSync(join(MIGRATIONS_DIR, `${move.fromTag}.sql`), { force: true });
    rmSync(join(META_DIR, move.fromSnapshot), { force: true });
  }

  let newestUpstreamSnapshotId: string | null = null;
  for (const entry of theirs.entries) {
    writeFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), showAt(upstreamRef, join(MIGRATIONS_DIR, `${entry.tag}.sql`)));
    const snapshotPath = join(META_DIR, snapshotFileName(entry.idx));
    const snapshot = showAt(upstreamRef, snapshotPath);
    writeFileSync(snapshotPath, snapshot);
    newestUpstreamSnapshotId = snapshotId(snapshot);
  }

  forkFiles.forEach(({ move, sql, snapshot }, index) => {
    writeFileSync(join(MIGRATIONS_DIR, `${move.toTag}.sql`), sql);
    const linked = index === 0 && newestUpstreamSnapshotId ? relinkPrevId(snapshot, newestUpstreamSnapshotId) : snapshot;
    writeFileSync(join(META_DIR, move.toSnapshot), linked);
  });

  writeFileSync(JOURNAL_PATH, `${JSON.stringify(plan.journal, null, 2)}\n`);
  writeFileSync(FORK_LIST_PATH, rewriteForkMigrationList(readFileSync(FORK_LIST_PATH, 'utf8'), plan.forkTagsBeforeUpstreamTimes));

  const added = plan.moves.length > 0 && !process.argv.includes('--skip-snapshot-refresh') ? refreshNewestSnapshot(plan.journal) : null;

  const leftovers = readdirSync(MIGRATIONS_DIR).filter(
    (file) => file.endsWith('.sql') && !plan.journal.entries.some((entry) => `${entry.tag}.sql` === file),
  );
  if (leftovers.length > 0) throw new Error(`Migration files not in the journal: ${leftovers.join(', ')}`);
  if (!existsSync(join(META_DIR, snapshotFileName(plan.journal.entries.length - 1)))) throw new Error('Newest snapshot is missing');

  git(['add', '--all', '--', relative(SERVER_DIR, MIGRATIONS_DIR), relative(SERVER_DIR, FORK_LIST_PATH)]);

  const moved = plan.moves.filter((move) => move.fromTag !== move.toTag);
  console.log(`Upstream migrations: ${theirs.entries.length}. Fork migrations: ${plan.moves.length}, renumbered: ${moved.length}.`);
  for (const move of moved) console.log(`  ${move.fromTag} -> ${move.toTag}`);
  console.log(`Fork migrations dated before upstream's newest: ${plan.forkTagsBeforeUpstreamTimes.length}.`);
  if (added) console.log(`Newest snapshot brought up to date with these upstream changes:\n${added}`);
}

main();
