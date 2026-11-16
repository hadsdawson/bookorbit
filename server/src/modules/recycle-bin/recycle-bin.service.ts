import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DEFAULT_RECYCLE_BIN_SETTINGS,
  RECYCLE_BIN_KEEP_DAYS_MAX,
  RECYCLE_BIN_KEEP_DAYS_MIN,
  type RecycleBinEmptyResult,
  type RecycleBinEntry,
  type RecycleBinOverview,
  type RecycleBinRestoreResult,
  type RecycleBinSettings,
} from '@bookorbit/types';

import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import {
  deleteEntry,
  entryDeletedAtMs,
  entryExists,
  listEntryIds,
  moveToBin,
  readManifest,
  restoreEntry,
  type RecycleInput,
} from './lib/recycle-bin-store';
import { RecycleBinRepository, type RecycleBinFolder } from './recycle-bin.repository';

export const RECYCLE_BIN_SETTINGS_KEY = 'recycle_bin_settings';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
const IO_CONCURRENCY = 8;

interface LocatedEntry {
  id: string;
  folder: RecycleBinFolder;
}

export function parseRecycleBinSettings(raw: string | null | undefined): RecycleBinSettings {
  let value: Partial<RecycleBinSettings>;
  try {
    value = raw ? (JSON.parse(raw) as Partial<RecycleBinSettings>) : {};
  } catch {
    value = {};
  }
  const defaults = DEFAULT_RECYCLE_BIN_SETTINGS;
  const keepDays = value?.keepDays;
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaults.enabled,
    keepDays:
      Number.isInteger(keepDays) && keepDays! >= RECYCLE_BIN_KEEP_DAYS_MIN && keepDays! <= RECYCLE_BIN_KEEP_DAYS_MAX ? keepDays! : defaults.keepDays,
  };
}

@Injectable()
export class RecycleBinService {
  private readonly logger = new Logger(RecycleBinService.name);
  private purging = false;
  /** Folders outside the libraries that keep a bin too, such as the Convert folder. */
  private readonly extraFolders = new Map<string, RecycleBinFolder>();

  constructor(
    private readonly repo: RecycleBinRepository,
    private readonly appSettings: AppSettingsService,
  ) {}

  async getSettings(): Promise<RecycleBinSettings> {
    return parseRecycleBinSettings(await this.appSettings.getValue(RECYCLE_BIN_SETTINGS_KEY));
  }

  async updateSettings(settings: RecycleBinSettings): Promise<RecycleBinSettings> {
    const next: RecycleBinSettings = { enabled: settings.enabled, keepDays: settings.keepDays };
    await this.appSettings.setValue(RECYCLE_BIN_SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  /** Lists, restores and expires the bin kept in a folder that is not a library folder. */
  registerFolder(folder: RecycleBinFolder): void {
    this.extraFolders.set(folder.path, folder);
  }

  async isEnabled(): Promise<boolean> {
    return (await this.getSettings()).enabled;
  }

  /** Moves deleted files into their library folder's bin. Throws when a file could not be moved, so nothing is lost. */
  async recycle(libraryFolderPath: string, input: RecycleInput): Promise<void> {
    const event = 'recycle_bin.recycle';
    const startedAt = Date.now();
    try {
      const { id, moved } = await moveToBin(libraryFolderPath, input);
      this.logger.log(
        `[${event}] [end] entryId=${id} kind=${input.kind} durationMs=${Date.now() - startedAt} files=${input.absolutePaths.length} moved=${moved} - files moved to recycle bin`,
      );
    } catch (err) {
      this.logFail(event, startedAt, err, `kind=${input.kind} files=${input.absolutePaths.length}`, 'move to recycle bin failed');
      throw err;
    }
  }

  async overview(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<RecycleBinOverview> {
    const settings = await this.getSettings();
    const located = await this.locateAll();
    const slice = located.slice((page - 1) * pageSize, page * pageSize);
    const entries = await mapWithConcurrency(slice, IO_CONCURRENCY, (entry) => this.toEntry(entry, settings));
    return { settings, entries, total: located.length, page, pageSize };
  }

  async restore(id: string): Promise<RecycleBinRestoreResult> {
    const event = 'recycle_bin.restore';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] entryId=${sanitizeLogValue(id)} - restore started`);
    try {
      const entry = await this.locate(id);
      const outcome = await restoreEntry(entry.folder.path, entry.id);
      this.logger.log(
        `[${event}] [end] entryId=${entry.id} durationMs=${Date.now() - startedAt} restored=${outcome.restored} conflicts=${outcome.conflicts.length} missing=${outcome.missing.length} - restore completed`,
      );
      return outcome;
    } catch (err) {
      this.logFail(event, startedAt, err, `entryId=${sanitizeLogValue(id)}`, 'restore failed');
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const event = 'recycle_bin.delete';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] entryId=${sanitizeLogValue(id)} - permanent delete started`);
    try {
      const entry = await this.locate(id);
      await deleteEntry(entry.folder.path, entry.id);
      this.logger.log(`[${event}] [end] entryId=${entry.id} durationMs=${Date.now() - startedAt} - permanent delete completed`);
    } catch (err) {
      this.logFail(event, startedAt, err, `entryId=${sanitizeLogValue(id)}`, 'permanent delete failed');
      throw err;
    }
  }

  async empty(): Promise<RecycleBinEmptyResult> {
    const event = 'recycle_bin.empty';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] - empty recycle bin started`);
    const result = await this.removeEntries(await this.locateAll(), event);
    this.logger.log(
      `[${event}] [end] durationMs=${Date.now() - startedAt} removed=${result.removed} failed=${result.failed} - empty recycle bin completed`,
    );
    return result;
  }

  @Cron('0 23 * * * *')
  async purgeExpired(now: Date = new Date()): Promise<RecycleBinEmptyResult> {
    if (this.purging) return { removed: 0, failed: 0 };
    this.purging = true;
    const event = 'recycle_bin.purge';
    const startedAt = Date.now();
    try {
      const { keepDays } = await this.getSettings();
      const cutoff = now.getTime() - keepDays * DAY_MS;
      const expired = (await this.locateAll()).filter((entry) => (entryDeletedAtMs(entry.id) ?? Number.POSITIVE_INFINITY) < cutoff);
      if (expired.length === 0) return { removed: 0, failed: 0 };
      this.logger.log(`[${event}] [start] keepDays=${keepDays} expired=${expired.length} - purge of expired entries started`);
      const result = await this.removeEntries(expired, event);
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} removed=${result.removed} failed=${result.failed} - purge completed`);
      return result;
    } catch (err) {
      this.logFail(event, startedAt, err, '', 'purge failed');
      return { removed: 0, failed: 0 };
    } finally {
      this.purging = false;
    }
  }

  private async removeEntries(entries: LocatedEntry[], event: string): Promise<RecycleBinEmptyResult> {
    const results = await mapWithConcurrency(entries, IO_CONCURRENCY, async (entry) => {
      const startedAt = Date.now();
      try {
        await deleteEntry(entry.folder.path, entry.id);
        return true;
      } catch (err) {
        this.logFail(event, startedAt, err, `entryId=${entry.id}`, 'entry could not be deleted');
        return false;
      }
    });
    const removed = results.filter(Boolean).length;
    return { removed, failed: results.length - removed };
  }

  /** Each library folder once, even when two libraries share it, then any registered extra folder. */
  private async folders(): Promise<RecycleBinFolder[]> {
    const byPath = new Map<string, RecycleBinFolder>();
    for (const folder of [...(await this.repo.findLibraryFolders()), ...this.extraFolders.values()]) {
      if (!byPath.has(folder.path)) byPath.set(folder.path, folder);
    }
    return [...byPath.values()];
  }

  /** Every entry on the server, newest first. A folder that cannot be read is skipped. */
  private async locateAll(): Promise<LocatedEntry[]> {
    const perFolder = await mapWithConcurrency(await this.folders(), IO_CONCURRENCY, async (folder) => {
      const startedAt = Date.now();
      try {
        return (await listEntryIds(folder.path)).map((id) => ({ id, folder }));
      } catch (err) {
        this.logFail('recycle_bin.list', startedAt, err, `path="${sanitizeLogValue(folder.path)}"`, 'recycle bin folder could not be read');
        return [];
      }
    });
    return perFolder.flat().sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  private async locate(id: string): Promise<LocatedEntry> {
    for (const folder of await this.folders()) {
      if (await entryExists(folder.path, id).catch(() => false)) return { id, folder };
    }
    throw new NotFoundException('That item is no longer in the recycle bin');
  }

  private async toEntry(entry: LocatedEntry, settings: RecycleBinSettings): Promise<RecycleBinEntry> {
    const manifest = await readManifest(entry.folder.path, entry.id);
    const deletedAtMs = entryDeletedAtMs(entry.id) ?? Date.parse(manifest.deletedAt);
    return {
      id: entry.id,
      kind: manifest.kind,
      title: manifest.title,
      libraryName: entry.folder.libraryName,
      libraryFolderPath: entry.folder.path,
      deletedAt: new Date(deletedAtMs).toISOString(),
      deletedBy: manifest.deletedBy,
      expiresAt: new Date(deletedAtMs + settings.keepDays * DAY_MS).toISOString(),
      files: manifest.files,
      sizeBytes: manifest.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
    };
  }

  private logFail(event: string, startedAt: number, err: unknown, ids: string, message: string): void {
    const errorClass = err instanceof Error ? err.name : 'Error';
    const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    this.logger.warn(
      `[${event}] [fail] ${ids ? `${ids} ` : ''}durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - ${message}`,
    );
  }
}
