import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const archive = vi.hoisted(() => ({
  createBackup: vi.fn(),
  listBackups: vi.fn(),
  readManifest: vi.fn(),
}));
vi.mock('./lib/backup-archive', async (importOriginal) => ({ ...(await importOriginal<object>()), ...archive }));
vi.mock('./lib/backup-migrations', () => ({ shippedMigrationHashes: () => new Set(['a', 'b']) }));

import { BackupService } from './backup.service';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'backup-service-'));
  archive.createBackup
    .mockReset()
    .mockResolvedValue({ name: 'bookorbit-backup-1-manual.zip', kind: 'manual', createdAt: '', size: 10, appVersion: 'v1' });
  archive.listBackups.mockReset().mockResolvedValue([]);
  archive.readManifest.mockReset().mockResolvedValue({ migrationHashes: ['a'], createdAt: '2026-11-01T00:00:00Z', appVersion: 'v1' });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(dataDir, { recursive: true, force: true });
});

function makeService(settings: Record<string, string> = {}) {
  const values = new Map(Object.entries(settings));
  const appSettings = {
    getValue: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setValue: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
  };
  const repo = { migrationLedgerHashes: vi.fn().mockResolvedValue(['a']) };
  const service = new BackupService(
    repo as never,
    appSettings as never,
    { appDataPath: dataDir } as never,
    { url: 'postgres://x' } as never,
    { version: 'v1' } as never,
  );
  return { service, appSettings, values };
}

describe('BackupService', () => {
  it('makes a manual backup with the database ledger and the app version', async () => {
    const { service } = makeService();
    await service.create('manual');
    expect(archive.createBackup).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual', appVersion: 'v1', migrationHashes: ['a'], databaseUrl: 'postgres://x', appDataPath: dataDir }),
    );
  });

  it('reports a failed backup on the overview until the next one works', async () => {
    const { service } = makeService();
    archive.createBackup.mockRejectedValueOnce(new Error('pg_dump could not start'));
    await expect(service.create('manual')).rejects.toThrow(/pg_dump could not start/);
    expect((await service.overview()).lastError).toBe('pg_dump could not start');
    await service.create('manual');
    expect((await service.overview()).lastError).toBeNull();
  });

  it('runs the schedule once per slot', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T08:30:00Z'), toFake: ['Date'] });
    const { service } = makeService({ backup_settings: JSON.stringify({ frequency: 'daily', time: '02:00', timeZone: 'America/Chicago', keep: 7 }) });
    await service.runScheduled();
    await service.runScheduled();
    expect(archive.createBackup).toHaveBeenCalledTimes(1);
    expect(archive.createBackup).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scheduled' }));
  });

  it('keeps the failure message across a restart', async () => {
    const first = makeService();
    archive.createBackup.mockRejectedValueOnce(new Error('disk full'));
    await expect(first.service.create('manual')).rejects.toThrow(/disk full/);
    const restarted = makeService(Object.fromEntries(first.values));
    expect((await restarted.service.overview()).lastError).toBe('disk full');
  });

  it('tries a failed scheduled backup again after a wait, and gives up after three attempts', async () => {
    const { service } = makeService({ backup_settings: JSON.stringify({ frequency: 'daily', time: '02:00', timeZone: 'America/Chicago', keep: 7 }) });
    archive.createBackup.mockRejectedValue(new Error('disk full'));
    const at = (minutes: number) => new Date(Date.parse('2026-11-12T08:30:00Z') + minutes * 60_000);
    await service.runScheduled(at(0));
    await service.runScheduled(at(5));
    expect(archive.createBackup).toHaveBeenCalledTimes(1);
    await service.runScheduled(at(31));
    await service.runScheduled(at(62));
    await service.runScheduled(at(93));
    expect(archive.createBackup).toHaveBeenCalledTimes(3);
  });

  it('marks the slot done only when a retried backup works', async () => {
    const { service, values } = makeService({
      backup_settings: JSON.stringify({ frequency: 'daily', time: '02:00', timeZone: 'America/Chicago', keep: 7 }),
    });
    archive.createBackup.mockRejectedValueOnce(new Error('disk full'));
    const at = (minutes: number) => new Date(Date.parse('2026-11-12T08:30:00Z') + minutes * 60_000);
    await service.runScheduled(at(0));
    expect(values.get('backup_last_scheduled_slot')).toBeUndefined();
    await service.runScheduled(at(31));
    await service.runScheduled(at(62));
    expect(archive.createBackup).toHaveBeenCalledTimes(2);
    expect(values.get('backup_last_scheduled_slot')).toBe('daily:2026-11-12');
  });

  it('saves only valid settings', async () => {
    const { service, values } = makeService();
    const saved = await service.saveSettings({
      frequency: 'weekly',
      time: '03:15',
      dayOfWeek: 1,
      timeZone: 'America/Chicago',
      keep: 5,
      beforeUpdate: false,
      requireBeforeUpdate: true,
    });
    expect(saved).toMatchObject({ frequency: 'weekly', time: '03:15', keep: 5 });
    expect(JSON.parse(values.get('backup_settings')!)).toEqual(saved);
  });

  it('leaves a restore note and stops BookOrbit so it restarts into the restore', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { service } = makeService();
    const name = 'bookorbit-backup-20261101T000000Z-manual.zip';
    await import('fs/promises').then(({ mkdir, writeFile }) =>
      mkdir(join(dataDir, 'backups'), { recursive: true }).then(() => writeFile(join(dataDir, 'backups', name), 'zip')),
    );

    await expect(service.restore(name)).resolves.toEqual({ restarting: true });
    expect(JSON.parse(await readFile(join(dataDir, 'backups', '.restore-pending.json'), 'utf8')).name).toBe(name);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('refuses to restore a backup from a newer version, without restarting', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    archive.readManifest.mockResolvedValue({ migrationHashes: ['a', 'z'], createdAt: '', appVersion: 'v9' });
    const { service } = makeService();
    const name = 'bookorbit-backup-20261101T000000Z-manual.zip';
    await import('fs/promises').then(({ mkdir, writeFile }) =>
      mkdir(join(dataDir, 'backups'), { recursive: true }).then(() => writeFile(join(dataDir, 'backups', name), 'zip')),
    );

    await expect(service.restore(name)).rejects.toThrow(/newer version/);
    await expect(readFile(join(dataDir, 'backups', '.restore-pending.json'))).rejects.toThrow();
    expect(kill).not.toHaveBeenCalled();
  });

  it('refuses names that are not backups', async () => {
    const { service } = makeService();
    await expect(service.pathFor('../../etc/passwd')).rejects.toThrow('Backup not found');
  });
});
