import { NEW_RELEASE_RETENTION_DAYS, type NewReleaseRetentionDays } from '@bookorbit/types';
import { IsIn } from 'class-validator';

export class UpdateNewReleasesSettingsDto {
  /** How long a book stays listed after it comes out. */
  @IsIn(NEW_RELEASE_RETENTION_DAYS)
  retentionDays!: NewReleaseRetentionDays;
}
