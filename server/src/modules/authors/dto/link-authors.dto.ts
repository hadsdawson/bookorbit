import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min } from 'class-validator';

export class LinkAuthorsDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  authorIds: number[];
}
