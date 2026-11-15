import { SYSTEM_TIME_ZONE, toDateKeyInTimeZone } from '../../common/utils/timezone.utils';

/** Fork: today's date where the server runs, the day a request's release date is compared with. */
export function trackingToday(): string {
  return toDateKeyInTimeZone(new Date(), SYSTEM_TIME_ZONE);
}
