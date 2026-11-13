import { AGE_RATING_FILTER_VALUES, type AgeRatingFilterValue } from '@bookorbit/types';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional } from 'class-validator';

export class SetContentFiltersDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  includeTagIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludeTagIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  includeGenreIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  excludeGenreIds?: number[];

  /** Fork: age ratings to show only (-1 is "Not rated"). */
  @IsOptional()
  @IsArray()
  @IsIn(AGE_RATING_FILTER_VALUES, { each: true })
  includeAgeRatings?: AgeRatingFilterValue[];

  @IsOptional()
  @IsArray()
  @IsIn(AGE_RATING_FILTER_VALUES, { each: true })
  excludeAgeRatings?: AgeRatingFilterValue[];

  /** Lets books this user requested through the rules above. Omitted leaves the current setting. */
  @IsOptional()
  @IsBoolean()
  seeOwnRequestedBooks?: boolean;
}
