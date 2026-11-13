import {
  NEW_RELEASE_DELIVERIES,
  NEW_RELEASE_FORMATS,
  NEW_RELEASE_RETENTION_DAYS,
  type NewReleaseDelivery,
  type NewReleaseFormat,
  type NewReleaseRetentionDays,
} from '@bookorbit/types';
import { IsIn, IsOptional, ValidateIf } from 'class-validator';

export class UpdateNewReleasesSettingsDto {
  /** How long a book stays listed after it comes out. */
  @IsOptional()
  @IsIn(NEW_RELEASE_RETENTION_DAYS)
  retentionDays?: NewReleaseRetentionDays;

  /** Null goes back to following the server default. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsIn(NEW_RELEASE_DELIVERIES)
  delivery?: NewReleaseDelivery | null;
}

export class UpdateNewReleasesServerSettingsDto {
  @IsIn(NEW_RELEASE_FORMATS)
  defaultFormat!: NewReleaseFormat;

  @IsIn(NEW_RELEASE_DELIVERIES)
  defaultDelivery!: NewReleaseDelivery;
}
