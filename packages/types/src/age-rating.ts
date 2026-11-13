/** Youngest age a book suits, as stored: 0 means all ages. Fork-only. */
export const AGE_RATINGS = [0, 10, 13, 16, 18] as const;
export type AgeRating = (typeof AGE_RATINGS)[number];

/** Stands for "no rating set" in a user's age rating filter. */
export const NOT_RATED = -1;

/** What an administrator can include or exclude for a user: each rating, plus books with none. */
export const AGE_RATING_FILTER_VALUES = [...AGE_RATINGS, NOT_RATED] as const;
export type AgeRatingFilterValue = (typeof AGE_RATING_FILTER_VALUES)[number];

export function isAgeRating(value: unknown): value is AgeRating {
  return typeof value === "number" && (AGE_RATINGS as readonly number[]).includes(value);
}

export function isAgeRatingFilterValue(value: unknown): value is AgeRatingFilterValue {
  return typeof value === "number" && (AGE_RATING_FILTER_VALUES as readonly number[]).includes(value);
}
