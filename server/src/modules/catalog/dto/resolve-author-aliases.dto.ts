import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class ResolveAuthorAliasesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  names: string[];
}
