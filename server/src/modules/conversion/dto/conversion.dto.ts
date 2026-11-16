import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { CONVERSION_CONCURRENCY_MAX, CONVERSION_CONCURRENCY_MIN, type ConversionSettings } from '@bookorbit/types';

export class UpdateConversionSettingsDto implements ConversionSettings {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(CONVERSION_CONCURRENCY_MIN)
  @Max(CONVERSION_CONCURRENCY_MAX)
  concurrency!: number;
}
