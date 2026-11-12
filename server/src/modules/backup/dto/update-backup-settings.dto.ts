import { IsBoolean, IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { BACKUP_FREQUENCIES, BACKUP_KEEP_MAX, BACKUP_KEEP_MIN, type BackupFrequency, type BackupSettings } from '@bookorbit/types';

export class UpdateBackupSettingsDto implements BackupSettings {
  @IsIn(BACKUP_FREQUENCIES)
  frequency!: BackupFrequency;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  time!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsString()
  timeZone!: string;

  @IsInt()
  @Min(BACKUP_KEEP_MIN)
  @Max(BACKUP_KEEP_MAX)
  keep!: number;

  @IsBoolean()
  beforeUpdate!: boolean;
}
