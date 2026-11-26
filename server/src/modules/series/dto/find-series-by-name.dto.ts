import { IsString, MaxLength, MinLength } from 'class-validator';

/** Fork. */
export class FindSeriesByNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;
}
