import { BOOK_REQUEST_TRACKING_STATUSES } from '@bookorbit/types';
import type { BookRequestTrackingStatus } from '@bookorbit/types';
import { IsIn, ValidateIf } from 'class-validator';

export class UpdateBookRequestTrackingStatusDto {
  /** One of the tracking statuses, or null to clear it. */
  @ValidateIf((_object, value) => value !== null)
  @IsIn(BOOK_REQUEST_TRACKING_STATUSES as readonly string[] as string[])
  trackingStatus!: BookRequestTrackingStatus | null;
}
