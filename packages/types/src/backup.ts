/** Why a backup was made: on the schedule, by hand, before an update or a restore, or uploaded from elsewhere. */
export const BACKUP_KINDS = ["scheduled", "manual", "pre-update", "pre-restore", "uploaded"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  createdAt: string;
  size: number;
  appVersion: string;
}

export const BACKUP_FREQUENCIES = ["off", "daily", "weekly"] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

export interface BackupSettings {
  frequency: BackupFrequency;
  /** 24-hour "HH:MM" in `timeZone`. */
  time: string;
  /** 0 is Sunday; used when weekly. */
  dayOfWeek: number;
  /** IANA zone the time is read in, normally the browser's when the settings were saved. */
  timeZone: string;
  /** How many scheduled and manual backups to keep; older ones are deleted. */
  keep: number;
  /** Take a backup automatically before an update changes the database. */
  beforeUpdate: boolean;
  /** Refuse to start an update when that backup could not be made, instead of updating without one. */
  requireBeforeUpdate: boolean;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  frequency: "daily",
  time: "02:00",
  dayOfWeek: 0,
  timeZone: "UTC",
  keep: 7,
  beforeUpdate: true,
  requireBeforeUpdate: false,
};

export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 100;

export interface BackupOverview {
  settings: BackupSettings;
  backups: BackupInfo[];
  /** Folder backups are written to, as the server sees it. */
  location: string;
  /** True when that folder is inside the app's own data folder rather than a separate mapping. */
  locationInsideAppData: boolean;
  /** A backup currently being written, if any. */
  running: BackupKind | null;
  /** A restore waiting for the next restart, if any. */
  pendingRestore: string | null;
  /** The last scheduled or manual backup that failed, if the most recent attempt failed. */
  lastError: string | null;
  /** How the most recent restore went, shown once BookOrbit is back up. */
  lastRestore: BackupRestoreResult | null;
}

export interface BackupRestoreResult {
  name: string;
  ok: boolean;
  finishedAt: string;
  error?: string;
  safetyBackup?: string;
}
