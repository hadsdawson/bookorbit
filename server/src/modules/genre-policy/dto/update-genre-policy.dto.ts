import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_ALLOWED_GENRE_LENGTH, MAX_ALLOWED_GENRES } from '@bookorbit/types';

export class UpdateGenrePolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_GENRES)
  @IsString({ each: true })
  @MaxLength(MAX_ALLOWED_GENRE_LENGTH, { each: true })
  genres?: string[];
}
