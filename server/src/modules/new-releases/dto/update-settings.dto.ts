import {
  NEW_RELEASE_DELIVERIES,
  NEW_RELEASE_FORMATS,
  NEW_RELEASE_RETENTION_DAYS,
  type NewReleaseDelivery,
  type NewReleaseFormat,
  type NewReleaseRetentionDays,
} from '@bookorbit/types';
import { IsBoolean, IsIn, IsOptional, Matches, ValidateIf } from 'class-validator';

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

  /** Fork: a two-letter language code, or "any". Optional so older clients still save. */
  @IsOptional()
  @Matches(/^([a-z]{2}|any)$/)
  language!: string;

  /** Fork: hide books no source states a language for. Optional so older clients still save. */
  @IsOptional()
  @IsBoolean()
  languageStrict!: boolean;
}

/** Fork: `hidden=true` lists hidden books too, within the same listing window. */
export class NewReleasesOverviewQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  hidden?: string;
}
