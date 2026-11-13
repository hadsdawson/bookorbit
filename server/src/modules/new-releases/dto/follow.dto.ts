import { RELEASE_FOLLOW_KINDS, type ReleaseFollowKind } from '@bookorbit/types';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateReleaseFollowDto {
  @IsIn(RELEASE_FOLLOW_KINDS)
  kind!: ReleaseFollowKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  authorId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  seriesId?: number;
}

export class FollowAllDto {
  @IsIn(RELEASE_FOLLOW_KINDS)
  kind!: ReleaseFollowKind;
}

export class FindReleaseFollowQueryDto {
  @IsIn(RELEASE_FOLLOW_KINDS)
  kind!: ReleaseFollowKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;
}

export class ListReleaseFollowsQueryDto {
  @IsOptional()
  @IsIn(RELEASE_FOLLOW_KINDS)
  kind?: ReleaseFollowKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
