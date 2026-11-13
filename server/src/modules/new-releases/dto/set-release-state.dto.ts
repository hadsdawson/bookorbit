import { IsIn, ValidateIf } from 'class-validator';

export class SetReleaseStateDto {
  /** Null brings a hidden book back. */
  @ValidateIf((_, value) => value !== null)
  @IsIn(['dismissed'])
  state!: 'dismissed' | null;
}
