import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createWriteStream } from 'fs';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { BackupInfo, BackupKind, BackupOverview, BackupSettings } from '@bookorbit/types';

import { appConfig, dbConfig, storageConfig } from '../../config/config';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { backupFileName, createBackup, isBackupFileName, listBackups, readManifest, resolveBackupDir } from './lib/backup-archive';
import { shippedMigrationHashes } from './lib/backup-migrations';
import { BACKUP_LAST_SLOT_KEY, BACKUP_SETTINGS_KEY, dueScheduleSlot, parseBackupSettings, pruneBackups } from './lib/backup-policy';
import { assertRestorable, cancelPendingRestore, readPendingRestore, readRestoreResult, requestRestore } from './lib/backup-restore';

/** Long enough for the restore response to reach the browser before BookOrbit stops to restart. */
const RESTART_DELAY_MS = 1_500;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir: string;
  private running: BackupKind | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly appSettings: AppSettingsService,
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
    @Inject(dbConfig.KEY) private readonly database: ConfigType<typeof dbConfig>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {
    this.backupDir = resolveBackupDir(storage.appDataPath);
  }

  async overview(): Promise<BackupOverview> {
    const location = relative(this.storage.appDataPath, this.backupDir);
    return {
      settings: await this.getSettings(),
      backups: await listBackups(this.backupDir),
      location: this.backupDir,
      locationInsideAppData: !location.startsWith('..') && !location.startsWith('/'),
      running: this.running,
      pendingRestore: await readPendingRestore(this.backupDir),
      lastError: this.lastError,
      lastRestore: await readRestoreResult(this.backupDir),
    };
  }

  async getSettings(): Promise<BackupSettings> {
    return parseBackupSettings(await this.appSettings.getValue(BACKUP_SETTINGS_KEY));
  }

  async saveSettings(input: BackupSettings): Promise<BackupSettings> {
    const settings = parseBackupSettings(JSON.stringify(input));
    await this.appSettings.setValue(BACKUP_SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  /** Checked every minute; a backup runs once per slot after the chosen time, in the chosen time zone. */
  @Cron('0 * * * * *')
  async runScheduled(): Promise<void> {
    const settings = await this.getSettings();
    const slot = dueScheduleSlot(settings, new Date(), await this.appSettings.getValue(BACKUP_LAST_SLOT_KEY));
    if (!slot || this.running) return;
    await this.appSettings.setValue(BACKUP_LAST_SLOT_KEY, slot);
    await this.create('scheduled').catch(() => undefined);
  }

  async create(kind: 'scheduled' | 'manual'): Promise<BackupInfo> {
    if (this.running) throw new ConflictException('A backup is already being made');
    this.running = kind;
    const startedAt = Date.now();
    this.logger.log(`[backup.create] [start] kind=${kind} - backing up`);
    try {
      const backup = await createBackup({
        databaseUrl: this.database.url,
        appDataPath: this.storage.appDataPath,
        backupDir: this.backupDir,
        kind,
        appVersion: this.app.version,
        migrationHashes: await this.ledgerHashes(),
      });
      const settings = await this.getSettings();
      const removed = await pruneBackups(this.backupDir, await listBackups(this.backupDir), settings.keep);
      this.lastError = null;
      this.logger.log(
        `[backup.create] [end] kind=${kind} durationMs=${Date.now() - startedAt} backup=${backup.name} size=${backup.size} removed=${removed.length} - backed up`,
      );
      return backup;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.logger.error(
        `[backup.create] [fail] kind=${kind} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.constructor.name : 'UnknownError'} error="${sanitizeLogValue(message)}" - backup failed`,
      );
      throw new BadRequestException(`Backup failed: ${message}`);
    } finally {
      this.running = null;
    }
  }

  async pathFor(name: string): Promise<{ path: string; size: number }> {
    if (!isBackupFileName(name)) throw new NotFoundException('Backup not found');
    const path = join(this.backupDir, name);
    try {
      return { path, size: (await stat(path)).size };
    } catch {
      throw new NotFoundException('Backup not found');
    }
  }

  async remove(name: string): Promise<void> {
    const { path } = await this.pathFor(name);
    if ((await readPendingRestore(this.backupDir)) === name) await cancelPendingRestore(this.backupDir);
    await rm(path, { force: true });
    this.logger.log(`[backup.delete] [end] backup=${name} - backup deleted`);
  }

  /** Saves an uploaded backup after checking it really is one; it is kept until deleted by hand. */
  async upload(file: Readable, truncated: () => boolean): Promise<BackupInfo> {
    await mkdir(this.backupDir, { recursive: true });
    const partial = join(this.backupDir, `.upload-${Date.now()}.partial`);
    try {
      await pipeline(file, createWriteStream(partial));
      if (truncated()) throw new BadRequestException('The backup file is larger than the upload limit');
      const manifest = await readManifest(partial).catch((error: unknown) => {
        throw new BadRequestException(error instanceof Error ? error.message : 'Not a BookOrbit backup');
      });
      let name = backupFileName(new Date(manifest.createdAt), 'uploaded');
      for (let n = 2; await exists(join(this.backupDir, name)); n++) name = name.replace(/(-\d+)?\.zip$/, `-${n}.zip`);
      await rename(partial, join(this.backupDir, name));
      const size = (await stat(join(this.backupDir, name))).size;
      this.logger.log(`[backup.upload] [end] backup=${name} size=${size} - backup uploaded`);
      return { name, kind: 'uploaded', createdAt: manifest.createdAt, size, appVersion: manifest.appVersion };
    } finally {
      await rm(partial, { force: true });
    }
  }

  /** Checks the backup can be restored, leaves a note for the next start, and stops BookOrbit so Docker restarts it. */
  async restore(name: string): Promise<{ restarting: true }> {
    const { path } = await this.pathFor(name);
    if (this.running) throw new ConflictException('Wait for the current backup to finish first');
    let manifest;
    try {
      manifest = await readManifest(path);
      assertRestorable(manifest, shippedMigrationHashes());
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'This backup cannot be restored');
    }
    await requestRestore(this.backupDir, name);
    this.logger.warn(`[backup.restore] [start] backup=${name} createdAt=${manifest.createdAt} - restarting to restore`);
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), RESTART_DELAY_MS).unref();
    return { restarting: true };
  }

  async cancelRestore(): Promise<void> {
    await cancelPendingRestore(this.backupDir);
  }

  private async ledgerHashes(): Promise<string[]> {
    const result = await this.db.execute<{ hash: string }>(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`);
    return result.rows.map((row) => row.hash);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
