import type { BooksPage } from "./book";
import type { SeriesIndex } from "./series-index";

export type SeriesVolumeStatus = "read" | "reading" | "unread" | "missing";

/**
 * One position on a series' volume ladder. A `missing` slot is a number the series should
 * have and the library does not; every other slot has a book behind it. Slots with no usable
 * index sit at the end with `index: null`.
 */
export type SeriesVolumeSlot = {
  index: number | null;
  bookId: number | null;
  title: string | null;
  status: SeriesVolumeStatus;
};

/**
 * Upper bound on the ladder a list row carries. A longer series still reports its true counts;
 * only the per-slot detail is cut, flagged by `volumesTruncated`.
 */
export const SERIES_VOLUME_SLOT_LIMIT = 60;

/** Missing numbers named in a list row before the rest collapse into `gapCount`. */
export const SERIES_GAP_PREVIEW_LIMIT = 8;

export type SeriesSummary = {
  id: number;
  name: string;
  bookCount: number;
  /** Books counted once per work: linked editions count as one. Absent from servers without `book-editions`. */
  workCount?: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
  /** Books the user has in progress. */
  readingCount: number;
  /** Libraries the series spans, in name order. Usually one. */
  libraryNames: string[];
  /** Total a metadata provider reports for the series, or null when no provider has said. */
  expectedBookCount: number | null;
  /**
   * Logical volumes owned across the whole series, collapsing book records that share a
   * whole-numbered position. Unlike `volumes`, never capped; falls back to `bookCount` when the
   * members could not all be read.
   */
  ownedVolumeCount: number;
  /** Owned logical volumes whose furthest status is read. */
  readVolumeCount: number;
  /** Owned logical volumes whose furthest status is reading. */
  readingVolumeCount: number;
  volumes: SeriesVolumeSlot[];
  volumesTruncated: boolean;
  /** Missing numbers, capped at {@link SERIES_GAP_PREVIEW_LIMIT}. */
  gaps: number[];
  gapCount: number;
  /** The volume to open next: the one in progress, else the first unread. */
  nextBookId: number | null;
  nextIndex: SeriesIndex | null;
  nextTitle: string | null;
};

/** Counts for the whole result set, ignoring the active completion filter. */
export type SeriesFacets = {
  all: number;
  notStarted: number;
  inProgress: number;
  complete: number;
  hasGaps: number;
};

export type SeriesPage = {
  items: SeriesSummary[];
  total: number;
  page: number;
  size: number;
  facets: SeriesFacets;
};

export type SeriesDetail = {
  id: number;
  name: string;
  bookCount: number;
  /** Books counted once per work: linked editions count as one. Absent from servers without `book-editions`. */
  workCount?: number;
  readCount: number;
  /** Logical volumes owned, collapsing book records that share a whole-numbered series position. */
  ownedVolumeCount?: number;
  /** Owned logical volumes whose furthest status is read. */
  readVolumeCount?: number;
  authors: string[];
  possibleGaps: number[];
  /** Total books a metadata provider reports for the series, or null when no provider has told us. */
  expectedBookCount: number | null;
};

export type SeriesBooksPage = BooksPage & {
  seriesInfo: SeriesDetail;
};

/** A series book the reader can open next, already resolved down to the file it should open. */
export type SeriesNextBook = {
  bookId: number;
  fileId: number;
  format: string;
  title: string | null;
  seriesIndex: SeriesIndex | null;
};

export type SeriesNextBookResponse = {
  next: SeriesNextBook | null;
};

/**
 * Fork: one of the series that share a name, as offered when a book's series is picked. Counts,
 * authors and covers only cover books the viewer can see.
 */
export type SeriesNameMatch = {
  id: number;
  name: string;
  bookCount: number;
  /** Up to three author names, most books first. */
  authors: string[];
  /** How many more authors the series has beyond `authors`. */
  moreAuthorCount: number;
  /** The first books in series order that have a cover, at most three. */
  coverBookIds: number[];
  /** Fork: the lowest and highest numbers its books have, to tell same-named series apart. */
  firstIndex?: string | null;
  lastIndex?: string | null;
  /** Fork: the title of its first book in series order. */
  firstTitle?: string | null;
};

/** Fork. Why a series is on the Series check list. */
export type SeriesReviewReason = "repeatedNumber" | "unrelatedAuthors";

/** Fork. A series that may hold books from more than one real series. */
export type SeriesReviewItem = {
  id: number;
  name: string;
  bookCount: number;
  authors: string[];
  moreAuthorCount: number;
  coverBookIds: number[];
  reasons: SeriesReviewReason[];
  /** Numbers used by books with no author in common, at most five. */
  repeatedNumbers: string[];
  /** Someone marked it as fine; it shows only under Marked fine. */
  markedFine: boolean;
};

export type SeriesReviewView = "open" | "fine";

export type SeriesReviewPage = {
  items: SeriesReviewItem[];
  total: number;
  page: number;
  size: number;
  /** How many series each view holds. */
  counts: { open: number; fine: number };
};

/** Fork. A book whose series name matches several series and waits for a pick. */
export type SeriesWaitingBook = {
  bookId: number;
  title: string;
  authors: string[];
  seriesName: string;
  seriesIndex: string | null;
  displayOrder: number;
};

export type SeriesWaitingPage = {
  items: SeriesWaitingBook[];
  total: number;
  page: number;
  size: number;
};

export type ResolveWaitingSeriesRequest = {
  bookId: number;
  displayOrder: number;
  seriesId?: number;
  newSeries?: boolean;
};

export type SplitSeriesBooksRequest = {
  seriesId: number;
  bookIds: number[];
  /** Name for the new series; the current name when left out. */
  name?: string;
  writeFiles?: boolean;
};

export type SplitSeriesBooksResult = {
  seriesId: number;
  name: string;
  movedBookCount: number;
};
