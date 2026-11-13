import { chmod, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBackup } from './backup-archive';
import { type BackupProgress, formatBackupProgress, formatBytes } from './backup-progress';

describe('formatBackupProgress', () => {
  it('formats each step as a single log line', () => {
    expect(formatBackupProgress('backup.pre_update', { step: 'database', phase: 'start' })).toBe(
      '[backup.pre_update] [start] step=database - saving the database',
    );
    expect(formatBackupProgress('backup.pre_update', { step: 'database', phase: 'end', durationMs: 12, bytes: 2048 })).toBe(
      '[backup.pre_update] [end] step=database durationMs=12 bytes=2048 - database saved (2.0 KB)',
    );
    expect(
      formatBackupProgress('backup.pre_update', {
        step: 'files',
        phase: 'progress',
        durationMs: 15000,
        filesDone: 1200,
        filesFound: 5400,
        bytesDone: 1024 * 1024 * 300,
        bytesFound: 1024 * 1024 * 1024 * 2,
      }),
    ).toBe(
      '[backup.pre_update] [progress] step=files durationMs=15000 filesDone=1200 filesFound=5400 bytesDone=314572800 bytesFound=2147483648 - copied 1,200 of 5,400 files so far (300.0 MB of 2.0 GB), still working',
    );
  });

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('createBackup progress', () => {
  let root: string;
  const previousPgDump = process.env.PG_DUMP_PATH;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'backup-progress-'));
    const fakePgDump = join(root, 'pg_dump');
    await writeFile(fakePgDump, '#!/bin/sh\nfor arg in "$@"; do case "$arg" in --file=*) printf "fake dump" > "${arg#--file=}";; esac; done\n');
    await chmod(fakePgDump, 0o755);
    process.env.PG_DUMP_PATH = fakePgDump;
    await mkdir(join(root, 'data', 'covers', '1'), { recursive: true });
    await writeFile(join(root, 'data', 'covers', '1', 'cover.jpg'), 'abc');
    await writeFile(join(root, 'data', 'covers', '1', 'thumb.jpg'), 'de');
  });

  afterEach(async () => {
    if (previousPgDump === undefined) delete process.env.PG_DUMP_PATH;
    else process.env.PG_DUMP_PATH = previousPgDump;
    await rm(root, { recursive: true, force: true });
  });

  it('reports the database step and the files step in order', async () => {
    const onProgress = vi.fn<(progress: BackupProgress) => void>();
    await createBackup({
      databaseUrl: 'postgres://localhost/test',
      appDataPath: join(root, 'data'),
      backupDir: join(root, 'backups'),
      kind: 'manual',
      appVersion: 'test',
      migrationHashes: [],
      onProgress,
      progressIntervalMs: 0,
    });

    const events = onProgress.mock.calls.map(([progress]) => progress);
    expect(events.map((event) => `${event.step}:${event.phase}`)).toEqual([
      'database:start',
      'database:end',
      'files:start',
      ...events.filter((event) => event.phase === 'progress').map(() => 'files:progress'),
      'files:end',
    ]);
    expect(events[1]).toMatchObject({ step: 'database', phase: 'end', bytes: 9 });
    expect(events[2]).toMatchObject({ step: 'files', phase: 'start', dirs: ['covers'] });
    expect(events.at(-1)).toMatchObject({ step: 'files', phase: 'end', files: 2, bytes: 5 });
  });
});
