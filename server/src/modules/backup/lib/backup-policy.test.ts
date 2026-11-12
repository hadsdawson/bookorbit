import { DEFAULT_BACKUP_SETTINGS, type BackupInfo, type BackupKind, type BackupSettings } from '@bookorbit/types';

import { isBackupFileName } from './backup-archive';
import { backupsToPrune, dueScheduleSlot, parseBackupSettings } from './backup-policy';
import { assertRestorable } from './backup-restore';

const CHICAGO: BackupSettings = { ...DEFAULT_BACKUP_SETTINGS, frequency: 'daily', time: '02:00', timeZone: 'America/Chicago' };

describe('parseBackupSettings', () => {
  it('falls back to the defaults for missing or broken settings', () => {
    expect(parseBackupSettings(null)).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(parseBackupSettings('not json')).toEqual(DEFAULT_BACKUP_SETTINGS);
  });

  it('keeps valid values and replaces only the bad ones', () => {
    const parsed = parseBackupSettings(
      JSON.stringify({ frequency: 'weekly', time: '25:00', keep: 0, timeZone: 'Mars/Base', dayOfWeek: 3, beforeUpdate: false }),
    );
    expect(parsed).toEqual({ ...DEFAULT_BACKUP_SETTINGS, frequency: 'weekly', dayOfWeek: 3, beforeUpdate: false });
  });
});

describe('dueScheduleSlot', () => {
  // 08:30 UTC is 02:30 in Chicago in November.
  const afterTwo = new Date('2026-11-12T08:30:00Z');
  const beforeTwo = new Date('2026-11-12T07:30:00Z');

  it('is due once the chosen time has passed in the chosen time zone', () => {
    expect(dueScheduleSlot(CHICAGO, beforeTwo, null)).toBeNull();
    expect(dueScheduleSlot(CHICAGO, afterTwo, null)).toBe('daily:2026-11-12');
  });

  it('runs only once per day, and again the next day', () => {
    expect(dueScheduleSlot(CHICAGO, afterTwo, 'daily:2026-11-12')).toBeNull();
    expect(dueScheduleSlot(CHICAGO, new Date('2026-11-13T09:00:00Z'), 'daily:2026-11-12')).toBe('daily:2026-11-13');
  });

  it('catches up later the same day when the server was off at the time', () => {
    expect(dueScheduleSlot(CHICAGO, new Date('2026-11-12T20:00:00Z'), 'daily:2026-11-11')).toBe('daily:2026-11-12');
  });

  it('runs weekly only on the chosen day', () => {
    const weekly = { ...CHICAGO, frequency: 'weekly' as const, dayOfWeek: 4 };
    expect(dueScheduleSlot(weekly, afterTwo, null)).toBe('weekly:2026-11-12');
    expect(dueScheduleSlot({ ...weekly, dayOfWeek: 5 }, afterTwo, null)).toBeNull();
  });

  it('never runs when the schedule is off', () => {
    expect(dueScheduleSlot({ ...CHICAGO, frequency: 'off' }, afterTwo, null)).toBeNull();
  });
});

describe('backupsToPrune', () => {
  const backup = (day: number, kind: BackupKind): BackupInfo => ({
    name: `bookorbit-backup-202611${String(day).padStart(2, '0')}T000000Z-${kind}.zip`,
    kind,
    createdAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    size: 1,
    appVersion: 'v1',
  });

  it('keeps the newest scheduled and manual backups up to the count', () => {
    const backups = [backup(1, 'scheduled'), backup(2, 'manual'), backup(3, 'scheduled'), backup(4, 'scheduled')];
    expect(backupsToPrune(backups, 2).map((entry) => entry.createdAt.slice(8, 10))).toEqual(['02', '01']);
  });

  it('keeps three safety copies and never deletes uploaded backups', () => {
    const backups = [1, 2, 3, 4].map((day) => backup(day, 'pre-update')).concat([backup(5, 'uploaded'), backup(6, 'uploaded')]);
    expect(backupsToPrune(backups, 1).map((entry) => entry.name)).toEqual([backup(1, 'pre-update').name]);
  });
});

describe('isBackupFileName', () => {
  it('accepts only our own backup names', () => {
    expect(isBackupFileName('bookorbit-backup-20261112T020000Z-scheduled.zip')).toBe(true);
    expect(isBackupFileName('../bookorbit-backup-x.zip')).toBe(false);
    expect(isBackupFileName('bookorbit-backup-x/../../etc.zip')).toBe(false);
    expect(isBackupFileName('photo.zip')).toBe(false);
    expect(isBackupFileName('bookorbit-backup-x.zip.partial')).toBe(false);
  });
});

describe('assertRestorable', () => {
  const manifest = {
    format: 'bookorbit-backup' as const,
    formatVersion: 1,
    createdAt: '',
    kind: 'manual' as const,
    appVersion: 'v9',
    migrationHashes: ['a', 'b'],
    dataDirs: [],
  };

  it('accepts a backup whose database changes this version knows', () => {
    expect(() => assertRestorable(manifest, new Set(['a', 'b', 'c']))).not.toThrow();
  });

  it('refuses a backup from a newer version', () => {
    expect(() => assertRestorable(manifest, new Set(['a']))).toThrow(/newer version of BookOrbit \(v9\)/);
  });
});
