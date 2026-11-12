import { existsSync } from 'fs';
import { join } from 'path';
import { readMigrationFiles } from 'drizzle-orm/migrator';

/** Hashes of every migration this build ships, from the same folders the migration script looks in. */
export function shippedMigrationHashes(): Set<string> {
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'migrations'),
    join(__dirname, '..', '..', '..', 'db', 'migrations'),
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'src', 'db', 'migrations'),
    join(process.cwd(), 'dist', 'db', 'migrations'),
  ];
  const folder = candidates.find((path) => existsSync(join(path, 'meta', '_journal.json')));
  if (!folder) throw new Error('Could not find the database migrations to check the backup against');
  return new Set(readMigrationFiles({ migrationsFolder: folder }).map((migration) => migration.hash));
}
