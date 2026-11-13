export type BackupProgress =
  | { step: 'database'; phase: 'start' }
  | { step: 'database'; phase: 'end'; durationMs: number; bytes: number }
  | { step: 'files'; phase: 'start'; dirs: string[] }
  | { step: 'files'; phase: 'progress'; durationMs: number; filesDone: number; filesFound: number; bytesDone: number; bytesFound: number }
  | { step: 'files'; phase: 'end'; durationMs: number; files: number; bytes: number };

export const BACKUP_PROGRESS_INTERVAL_MS = 15_000;

export function formatBackupProgress(event: string, progress: BackupProgress): string {
  const prefix = `[${event}] [${progress.phase}] step=${progress.step}`;
  if (progress.step === 'database') {
    if (progress.phase === 'start') return `${prefix} - saving the database`;
    return `${prefix} durationMs=${progress.durationMs} bytes=${progress.bytes} - database saved (${formatBytes(progress.bytes)})`;
  }
  if (progress.phase === 'start') {
    return `${prefix} dirs=${progress.dirs.join(',') || 'none'} - copying covers, photos and other files`;
  }
  if (progress.phase === 'progress') {
    return (
      `${prefix} durationMs=${progress.durationMs} filesDone=${progress.filesDone} filesFound=${progress.filesFound} ` +
      `bytesDone=${progress.bytesDone} bytesFound=${progress.bytesFound} - copied ${progress.filesDone.toLocaleString('en-US')} of ` +
      `${progress.filesFound.toLocaleString('en-US')} files so far (${formatBytes(progress.bytesDone)} of ${formatBytes(progress.bytesFound)}), still working`
    );
  }
  return `${prefix} durationMs=${progress.durationMs} files=${progress.files} bytes=${progress.bytes} - files copied (${progress.files.toLocaleString('en-US')} files, ${formatBytes(progress.bytes)})`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
