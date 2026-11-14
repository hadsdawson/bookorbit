export type MetadataScoreField =
  | "title"
  | "subtitle"
  | "description"
  | "coverSource"
  | "genres"
  | "isbn13"
  | "publisher"
  | "publishedYear"
  | "language"
  | "isbn10"
  | "pageCount"
  | "rating"
  | "seriesName"
  | "seriesIndex"
  | "tags"
  | "authors"
  | "googleBooksId"
  | "goodreadsId"
  | "amazonId"
  | "hardcoverId"
  | "openLibraryId"
  | "itunesId"
  | "koboId"
  | "aladinId"
  | "audiobookChapters";

export type MetadataScoreGroup = "core" | "publishing" | "classification" | "enrichment" | "providers";

/**
 * How the scorer decides a field is present. The client shows this to explain a row; the server
 * keeps the matching behaviour in SCORE_RULES. The two must stay in step.
 */
export type MetadataScoreRule = "text" | "positive" | "count" | "cover" | "providerId" | "seriesIndex" | "audiobookChapters";

export interface MetadataScoreFieldMeta {
  group: MetadataScoreGroup;
  rule: MetadataScoreRule;
  defaultWeight: number;
}

export const METADATA_SCORE_FIELDS: Record<MetadataScoreField, MetadataScoreFieldMeta> = {
  title: { group: "core", rule: "text", defaultWeight: 10 },
  authors: { group: "core", rule: "count", defaultWeight: 10 },
  coverSource: { group: "core", rule: "cover", defaultWeight: 10 },
  description: { group: "core", rule: "text", defaultWeight: 8 },
  genres: { group: "core", rule: "count", defaultWeight: 6 },
  subtitle: { group: "core", rule: "text", defaultWeight: 0 },
  publisher: { group: "publishing", rule: "text", defaultWeight: 4 },
  publishedYear: { group: "publishing", rule: "positive", defaultWeight: 4 },
  language: { group: "publishing", rule: "text", defaultWeight: 4 },
  pageCount: { group: "publishing", rule: "positive", defaultWeight: 2 },
  isbn13: { group: "classification", rule: "text", defaultWeight: 7 },
  isbn10: { group: "classification", rule: "text", defaultWeight: 2 },
  seriesName: { group: "classification", rule: "text", defaultWeight: 0 },
  seriesIndex: { group: "classification", rule: "seriesIndex", defaultWeight: 0 },
  tags: { group: "enrichment", rule: "count", defaultWeight: 2 },
  rating: { group: "enrichment", rule: "positive", defaultWeight: 1 },
  // Fork. Off until given a weight. Only scored for a book with an M4B file, so an ebook alone is never marked down.
  audiobookChapters: { group: "enrichment", rule: "audiobookChapters", defaultWeight: 0 },
  googleBooksId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  goodreadsId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  amazonId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  hardcoverId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  openLibraryId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  itunesId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  koboId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  aladinId: { group: "providers", rule: "providerId", defaultWeight: 1 },
};

/** Display order for the groups. Not alphabetical: it runs from most to least weight by default. */
export const METADATA_SCORE_GROUPS: readonly MetadataScoreGroup[] = [
  "core",
  "publishing",
  "classification",
  "enrichment",
  "providers",
];

export type MetadataScoreWeights = Record<MetadataScoreField, number>;

/**
 * Fork. Audiobook chapters count only for a book with an M4B file; for any other book the field is left out of the
 * score, denominator included.
 */
export function audiobookChaptersApply(fileFormats: readonly (string | null | undefined)[]): boolean {
  return fileFormats.some((format) => format?.toLowerCase() === "m4b");
}

/** A chapter title that is only a track number ("Track 3", "03", "Part 2 of 9"). Mirrors book_metadata.numbered_chapter_count. */
const NUMBERED_CHAPTER_TITLE = /^\s*((track|disc|cd|part)\s*)?[#._-]*\s*[0-9]+(\s*(of|\/)\s*[0-9]+)?\s*$/i;

export function isNumberedChapterTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && NUMBERED_CHAPTER_TITLE.test(title);
}

/**
 * Fork. Whether an audiobook has real chapters: at least two, and not mostly bare track numbers. The same line the
 * chapter health page draws between "no chapters" or "numbered tracks" and a usable list.
 */
export function hasRealAudiobookChapters(chapterCount: number, numberedChapterCount: number): boolean {
  return chapterCount >= 2 && numberedChapterCount < chapterCount * 0.8;
}

export const DEFAULT_METADATA_SCORE_WEIGHTS: MetadataScoreWeights = Object.fromEntries(
  Object.entries(METADATA_SCORE_FIELDS).map(([field, meta]) => [field, meta.defaultWeight]),
) as MetadataScoreWeights;

/**
 * A weight at or below zero removes the field from the score entirely, denominator included, so a
 * book missing it is not marked down. Mirrors the guard in MetadataScoreScorer.compute.
 */
export function isMetadataScoreFieldScoring(weight: number | null | undefined): boolean {
  return typeof weight === "number" && Number.isFinite(weight) && weight > 0;
}

/** Sum of every scoring weight. This is the denominator the server divides by. */
export function totalMetadataScoreWeight(weights: MetadataScoreWeights): number {
  return Object.values(weights).reduce((sum, weight) => (isMetadataScoreFieldScoring(weight) ? sum + weight : sum), 0);
}

export type MetadataScoreRecalculationState = "idle" | "running" | "completed" | "failed";

export type MetadataScoreRecalculationTrigger = "manual" | "weights_update";

/**
 * Wire shape of GET /metadata-score/recalculate/status. Timestamps are ISO strings here; the
 * service holds them as Date instances before serialization.
 */
export interface MetadataScoreRecalculationStatus {
  state: MetadataScoreRecalculationState;
  trigger: MetadataScoreRecalculationTrigger | null;
  startedAt: string | null;
  endedAt: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  error: string | null;
}
