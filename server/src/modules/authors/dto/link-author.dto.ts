import { IsInt, Min } from 'class-validator';

export class LinkAuthorDto {
  @IsInt()
  @Min(1)
  authorId: number;
}
