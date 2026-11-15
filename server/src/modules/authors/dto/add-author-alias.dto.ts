import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddAuthorAliasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name: string;
}
