import {
  BOOK_REQUEST_MEDIA_KINDS,
  BOOK_REQUEST_SAVED_VIEW_NAME_MAX_LENGTH,
  BOOK_REQUEST_SORT_DIRECTIONS,
  BOOK_REQUEST_SORT_FIELDS,
  BOOK_REQUEST_STATUSES,
  BOOK_REQUEST_TRACKING_STATUS_NONE,
  BOOK_REQUEST_TRACKING_STATUSES,
} from '@bookorbit/types';
import type {
  BookRequestMediaKind,
  BookRequestSavedViewFilters,
  BookRequestSortDirection,
  BookRequestSortField,
  BookRequestStatus,
  BookRequestTrackingStatusFilter,
} from '@bookorbit/types';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class BookRequestSavedViewFiltersDto implements BookRequestSavedViewFilters {
  @IsOptional()
  @IsIn(BOOK_REQUEST_STATUSES)
  status?: BookRequestStatus;

  @IsOptional()
  @IsIn(BOOK_REQUEST_MEDIA_KINDS)
  format?: BookRequestMediaKind;

  @IsOptional()
  @IsInt()
  @Min(1)
  requester?: number;

  @IsOptional()
  @IsIn(['needed', 'skipped'])
  approval?: 'needed' | 'skipped';

  @IsOptional()
  @IsIn([...BOOK_REQUEST_TRACKING_STATUSES, BOOK_REQUEST_TRACKING_STATUS_NONE])
  tracking?: BookRequestTrackingStatusFilter;

  @IsOptional()
  @IsIn(BOOK_REQUEST_SORT_FIELDS)
  sort?: BookRequestSortField;

  @IsOptional()
  @IsIn(BOOK_REQUEST_SORT_DIRECTIONS)
  dir?: BookRequestSortDirection;
}

export class SaveBookRequestViewDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(BOOK_REQUEST_SAVED_VIEW_NAME_MAX_LENGTH)
  name!: string;

  @ValidateNested()
  @Type(() => BookRequestSavedViewFiltersDto)
  filters!: BookRequestSavedViewFiltersDto;
}
