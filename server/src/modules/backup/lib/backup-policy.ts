import { rm } from 'fs/promises';
import { join } from 'path';
import {
  BACKUP_FREQUENCIES,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  DEFAULT_BACKUP_SETTINGS,
  type BackupInfo,
  type BackupKind,
  type BackupSettings,
} from '@bookorbit/types';

export const BACKUP_SETTINGS_KEY = 'backup_settings';
export const BACKUP_LAST_SLOT_KEY = 'backup_last_scheduled_slot';
export const BACKUP_LAST_ERROR_KEY = 'backup_last_error';
export const BACKUP_FAILED_SLOT_KEY = 'backup_failed_scheduled_slot';
/** A scheduled backup that fails is tried again this many times in all, this far apart. */
export const SCHEDULED_ATTEMPTS = 3;
export const SCHEDULED_RETRY_MS = 30 * 60 * 1000;

export interface FailedSlot {
  slot: string;
  attempts: number;
  lastAttemptAt: string;
}

export function parseFailedSlot(raw: string | null | undefined): FailedSlot | null {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<FailedSlot>) : null;
    if (!value || typeof value.slot !== 'string' || !Number.isInteger(value.attempts) || typeof value.lastAttemptAt !== 'string') return null;
    return { slot: value.slot, attempts: value.attempts!, lastAttemptAt: value.lastAttemptAt };
  } catch {
    return null;
  }
}

/** Whether a due slot should be attempted now, given how its earlier attempts went. */
export function shouldAttemptSlot(slot: string, failed: FailedSlot | null, now: Date): boolean {
  if (!failed || failed.slot !== slot) return true;
  if (failed.attempts >= SCHEDULED_ATTEMPTS) return false;
  const last = Date.parse(failed.lastAttemptAt);
  return !Number.isFinite(last) || now.getTime() - last >= SCHEDULED_RETRY_MS;
}
/** Safety copies made before an update or a restore; the newest few are kept whatever the main count. */
const SAFETY_KINDS: readonly BackupKind[] = ['pre-update', 'pre-restore'];
const SAFETY_KEEP = 3;
/** Backups the count applies to. Uploaded files are someone's own copy and are never deleted for them. */
const COUNTED_KINDS: readonly BackupKind[] = ['scheduled', 'manual'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Stored settings, with anything missing or malformed replaced by the default. */
export function parseBackupSettings(raw: string | null | undefined): BackupSettings {
  let value: Partial<BackupSettings>;
  try {
    value = raw ? (JSON.parse(raw) as Partial<BackupSettings>) : {};
  } catch {
    value = {};
  }
  const defaults = DEFAULT_BACKUP_SETTINGS;
  return {
    frequency: (BACKUP_FREQUENCIES as readonly string[]).includes(value.frequency as string) ? value.frequency! : defaults.frequency,
    time: typeof value.time === 'string' && TIME_RE.test(value.time) ? value.time : defaults.time,
    dayOfWeek: Number.isInteger(value.dayOfWeek) && value.dayOfWeek! >= 0 && value.dayOfWeek! <= 6 ? value.dayOfWeek! : defaults.dayOfWeek,
    timeZone: typeof value.timeZone === 'string' && isValidTimeZone(value.timeZone) ? value.timeZone : defaults.timeZone,
    keep: Number.isInteger(value.keep) && value.keep! >= BACKUP_KEEP_MIN && value.keep! <= BACKUP_KEEP_MAX ? value.keep! : defaults.keep,
    beforeUpdate: typeof value.beforeUpdate === 'boolean' ? value.beforeUpdate : defaults.beforeUpdate,
    requireBeforeUpdate: typeof value.requireBeforeUpdate === 'boolean' ? value.requireBeforeUpdate : defaults.requireBeforeUpdate,
  };
}

/**
 * The slot a scheduled backup is due for, or null. A slot is the local day (or week day) once the
 * chosen time has passed, so a server that was off at 2am still backs up when it comes back that day,
 * and never twice for the same slot.
 */
export function dueScheduleSlot(settings: BackupSettings, now: Date, lastSlot: string | null): string | null {
  if (settings.frequency === 'off') return null;
  const local = localParts(now, settings.timeZone);
  if (local.time < settings.time) return null;
  if (settings.frequency === 'weekly' && local.weekday !== settings.dayOfWeek) return null;
  const slot = `${settings.frequency}:${local.date}`;
  return slot === lastSlot ? null : slot;
}

/** The backups to delete so only the newest `keep` scheduled and manual ones, and a few safety copies, remain. */
export function backupsToPrune(backups: readonly BackupInfo[], keep: number): BackupInfo[] {
  const newestFirst = [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counted = newestFirst.filter((backup) => COUNTED_KINDS.includes(backup.kind)).slice(keep);
  const safety = newestFirst.filter((backup) => SAFETY_KINDS.includes(backup.kind)).slice(SAFETY_KEEP);
  return [...counted, ...safety];
}

export async function pruneBackups(backupDir: string, backups: readonly BackupInfo[], keep: number): Promise<string[]> {
  const removed: string[] = [];
  for (const backup of backupsToPrune(backups, keep)) {
    await rm(join(backupDir, backup.name), { force: true });
    removed.push(backup.name);
  }
  return removed;
}

function localParts(date: Date, timeZone: string): { date: string; time: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, weekday: weekdays.indexOf(get('weekday')) };
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
