import type { AgeRatingFilterValue } from "./age-rating";

export interface ContentFilterRules {
  includeTagIds: number[];
  excludeTagIds: number[];
  includeGenreIds: number[];
  excludeGenreIds: number[];
  /**
   * Fork: age ratings the user may see (include) or may not see (exclude). A book's rating is its
   * series' rating when the series has one. Optional so the many places that build rules for
   * tags and genres alone need no change; absent means no age rule.
   */
  includeAgeRatings?: AgeRatingFilterValue[];
  excludeAgeRatings?: AgeRatingFilterValue[];
  /**
   * When set, a book that fulfilled a request this user made or joined is exempt from every rule
   * above.
   * Carried on the rules rather than passed alongside them so the ~30 call sites that already
   * thread a `ContentFilterRules` through need no change; absent means today's behaviour.
   */
  exemptRequestsFromUserId?: number;
}

export interface ContentFilterNamedItem {
  id: number;
  name: string;
}

export interface ContentFilterRulesWithNames {
  includeTags: ContentFilterNamedItem[];
  excludeTags: ContentFilterNamedItem[];
  includeGenres: ContentFilterNamedItem[];
  excludeGenres: ContentFilterNamedItem[];
  includeAgeRatings: AgeRatingFilterValue[];
  excludeAgeRatings: AgeRatingFilterValue[];
  seeOwnRequestedBooks: boolean;
}

export const EMPTY_CONTENT_FILTER_RULES: ContentFilterRules = {
  includeTagIds: [],
  excludeTagIds: [],
  includeGenreIds: [],
  excludeGenreIds: [],
};

export function isContentFilterEmpty(filters: ContentFilterRules): boolean {
  return (
    filters.includeTagIds.length === 0 &&
    filters.excludeTagIds.length === 0 &&
    filters.includeGenreIds.length === 0 &&
    filters.excludeGenreIds.length === 0 &&
    (filters.includeAgeRatings?.length ?? 0) === 0 &&
    (filters.excludeAgeRatings?.length ?? 0) === 0
  );
}
