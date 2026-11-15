import { BOOK_REQUEST_TRACKING_STATUSES } from '@bookorbit/types';
import type { BookRequestTrackingChoice } from '@bookorbit/types';
import { IsIn, ValidateIf } from 'class-validator';

export class UpdateBookRequestTrackingStatusDto {
  /** One of the tracking statuses, null to clear it, or (Fork) "auto" to follow the release date. */
  @ValidateIf((_object, value) => value !== null)
  @IsIn([...BOOK_REQUEST_TRACKING_STATUSES, 'auto'])
  trackingStatus!: BookRequestTrackingChoice;
}
