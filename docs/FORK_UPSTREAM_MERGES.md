# Merging official BookOrbit updates into this fork

This fork adds its own database migrations next to upstream's. Both sides number them the same way,
so a merge usually conflicts in `server/src/db/migrations/meta/_journal.json`, and sometimes in the
`meta/*_snapshot.json` files. This page is how to settle those conflicts safely.

## The journal

`_journal.json` is the list Drizzle follows. After a merge it must hold every migration from both
sides, exactly once, with upstream's first:

1. Keep upstream's entries exactly as upstream has them: same numbers, tags and order.
2. Put the fork's own migrations after upstream's newest one, renumbered to follow it (since the
   2026-11-18 sync they are 0162 to 0174). Rename only the `.sql` file, the matching
   `meta/NNNN_snapshot.json` file and the entry's `idx` and `tag`. Never change a fork migration's SQL
   or its `when`: databases record migrations by both, so a changed one would look new and run again.
3. Renumber `idx` from 0 with no gaps.
4. List every fork migration whose `when` is older than an upstream one in
   `server/src/db/fork-migrations.ts`. The journal tests then check those in order among themselves
   instead of against upstream's.

`server/src/db/migration-journal.test.ts` (upstream's) and
`server/src/scripts/migration-journal.test.ts` (the fork's) check all of this with the unit tests.

## Snapshots

Keep upstream's snapshot files at upstream's numbers and move the fork's with their migrations. Point
the first fork snapshot's `prevId` at upstream's newest snapshot `id`, so the chain stays unbroken.
Snapshots are only read when a new migration is generated, never
when BookOrbit starts, so a snapshot that is out of step cannot harm a running database. It does
matter for the next schema change: the newest snapshot has to describe the schema with both sides'
changes, or the next generated migration will repeat changes that were already made.

To check after a merge, run `cd server && pnpm db:generate check`. It should report that there is
nothing to migrate. If it writes a migration instead, do not commit what it wrote: the statements in
it show what the newest snapshot is missing. Bring that snapshot up to date, then run the check again.

## What happens on the NAS

Drizzle only applies migrations newer than the newest one a database has run. An upstream migration
written before a fork one, but merged after the fork one was deployed, would be skipped for good.
`server/src/scripts/skipped-migration-compatibility.ts` applies those at startup, in order, and
records them. Nothing needs doing by hand.

A backup is taken before any update that changes the database (Settings > Backups), so a bad merge
can be undone by restoring it.

## Before merging the sync pull request

- The unit tests pass, including `migration-journal.test.ts`.
- `cd server && pnpm db:migrate` works on a copy of a database from before the merge, when one is
  to hand.
- New upstream migrations touch nothing the fork's own migrations changed: `book_requests`
  (`tracking_status`, `published_date`), `user_book_status` (the status check) and `libraries`
  (the `file_write_*` columns). If they do, read both before deploying.
