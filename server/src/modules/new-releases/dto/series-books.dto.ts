import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { SERIES_BOOKS_LIMIT } from '../series-books';

export class SeriesBooksQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  author?: string;
}

export class RequestSeriesBooksDto extends SeriesBooksQueryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SERIES_BOOKS_LIMIT)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(600, { each: true })
  keys!: string[];
}
