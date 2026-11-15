import { AUTHOR_NAME_KINDS, type AuthorNameKind } from '@bookorbit/types';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddAuthorAliasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name: string;

  /** Fork: how the name is added. Defaults to a spelling, which is what older clients sent. */
  @IsOptional()
  @IsIn(AUTHOR_NAME_KINDS)
  kind?: AuthorNameKind;
}
