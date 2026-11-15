import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RECYCLE_BIN_KEEP_DAYS_MAX, RECYCLE_BIN_KEEP_DAYS_MIN, RECYCLE_BIN_PAGE_SIZE_MAX, type RecycleBinSettings } from '@bookorbit/types';

export class UpdateRecycleBinSettingsDto implements RecycleBinSettings {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(RECYCLE_BIN_KEEP_DAYS_MIN)
  @Max(RECYCLE_BIN_KEEP_DAYS_MAX)
  keepDays!: number;
}

export class ListRecycleBinDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECYCLE_BIN_PAGE_SIZE_MAX)
  pageSize?: number;
}
