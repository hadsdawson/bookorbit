import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ResolveWaitingSeriesDto {
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsInt()
  @Min(0)
  displayOrder!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  seriesId?: number;

  @IsOptional()
  @IsBoolean()
  newSeries?: boolean;
}
