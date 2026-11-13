import type { AgeRatingFilterValue } from '@bookorbit/types'

/** Fork: the i18n key naming each age rating, and "Not rated" (-1) for user filters. */
export const AGE_RATING_LABEL_KEYS: Record<AgeRatingFilterValue, string> = {
  0: 'ageRating.allAges',
  10: 'ageRating.age10',
  13: 'ageRating.age13',
  16: 'ageRating.age16',
  18: 'ageRating.age18',
  [-1]: 'ageRating.notRated',
}
