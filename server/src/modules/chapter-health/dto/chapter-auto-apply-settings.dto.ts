import { IsNumber, Max, Min } from 'class-validator';
import { CHAPTER_RUNTIME_TOLERANCE } from '@bookorbit/types';

export class UpdateChapterAutoApplySettingsDto {
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(CHAPTER_RUNTIME_TOLERANCE.minSeconds)
  @Max(CHAPTER_RUNTIME_TOLERANCE.maxSeconds)
  runtimeToleranceSeconds!: number;
}
