/** Fork only: following authors and series for books that are not out yet. */
export const RELEASE_FOLLOW_KINDS = ["author", "series"] as const;
export type ReleaseFollowKind = (typeof RELEASE_FOLLOW_KINDS)[number];

export const NEW_RELEASE_FORMATS = ["ebook", "audiobook", "both"] as const;
export type NewReleaseFormat = (typeof NEW_RELEASE_FORMATS)[number];

/** "suggest" lists a new book for the user to request; "request" files the request for them. */
export const NEW_RELEASE_DELIVERIES = ["suggest", "request"] as const;
export type NewReleaseDelivery = (typeof NEW_RELEASE_DELIVERIES)[number];

/** How long a book stays listed after it comes out. */
export const NEW_RELEASE_RETENTION_DAYS = [15, 30, 60, 90] as const;
export type NewReleaseRetentionDays = (typeof NEW_RELEASE_RETENTION_DAYS)[number];
export const DEFAULT_NEW_RELEASE_RETENTION_DAYS: NewReleaseRetentionDays = 30;

export interface ReleaseFollow {
  id: number;
  kind: ReleaseFollowKind;
  name: string;
  /** For a series, the author it was followed under. */
  authorHint: string | null;
  authorId: number | null;
  seriesId: number | null;
  createdAt: string;
}

export interface NewReleaseMatchedFollow {
  id: number;
  kind: ReleaseFollowKind;
  name: string;
}

export type NewReleaseUserState = "requested" | "dismissed" | null;

export interface NewReleaseItem {
  id: number;
  title: string;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  coverUrl: string | null;
  /** Full dates only, YYYY-MM-DD. Null when that format has no confirmed date. */
  ebookDate: string | null;
  audiobookDate: string | null;
  /** The earlier of the two confirmed dates. */
  releaseDate: string;
  /** Why it is listed: the follows of this user it matched. Fork: with each follow's id, for Unfollow. */
  matchedFollows: NewReleaseMatchedFollow[];
  state: NewReleaseUserState;
  /** Fork: each author, with their id when they are in the user's libraries (by name or alternate name). */
  authorLinks: { name: string; authorId: number | null }[];
  /** Fork: the series' id when it is in the user's libraries. */
  seriesId: number | null;
  /** Fork: ids for the book's pages on the sites that reported it, for link badges. */
  providerIds: NewReleaseProviderIds;
  isbn13: string | null;
}

/** Fork: Hardcover's slug, the Audible and Amazon ASINs, and the Google Books id. */
export type NewReleaseProviderIds = Partial<Record<"hardcover" | "audible" | "amazon" | "google", string>>;

export interface NewReleasesServerSettings {
  defaultFormat: NewReleaseFormat;
  defaultDelivery: NewReleaseDelivery;
  /** Fork: only list books in this language (two-letter code), or "any". */
  language: string;
  /** Fork: also leave off books no source states a language for. */
  languageStrict: boolean;
}

export interface NewReleasesUserSettings {
  /** Null follows the server default. */
  delivery: NewReleaseDelivery | null;
  retentionDays: NewReleaseRetentionDays;
}

export interface ReleaseFollowCounts {
  author: number;
  series: number;
}

/** Which book sites the weekly check can use; false when the admin has it off or it has no key. */
export interface NewReleaseSourceStatus {
  hardcover: boolean;
  audible: boolean;
  google: boolean;
}

export interface ReleaseFollowPage {
  items: ReleaseFollow[];
  total: number;
}

export interface NewReleasesOverview {
  items: NewReleaseItem[];
  followCounts: ReleaseFollowCounts;
  sources: NewReleaseSourceStatus;
  server: NewReleasesServerSettings;
  user: NewReleasesUserSettings;
  /** The delivery in effect for this user after the server default is applied. */
  effectiveDelivery: NewReleaseDelivery;
  lastCheckedAt: string | null;
  checking: boolean;
  /** Followed names not looked up yet, so the page can say results are still coming. */
  pendingChecks: number;
}

export const NEW_RELEASE_REQUEST_FORMATS = ["ebook", "audiobook"] as const;
export type NewReleaseRequestFormat = (typeof NEW_RELEASE_REQUEST_FORMATS)[number];

/** Which formats to request a listed book in. */
export interface NewReleaseRequestPayload {
  formats: NewReleaseRequestFormat[];
}

export interface NewReleaseRequestResult {
  /** The formats a request now exists for, new or one the user joined. */
  requested: NewReleaseRequestFormat[];
}

/** A user's own settings; a field left out is unchanged, and a null delivery follows the server default. */
export interface UpdateNewReleasesUserSettingsPayload {
  retentionDays?: NewReleaseRetentionDays;
  delivery?: NewReleaseDelivery | null;
}

/** Fork. What Follow all did: names the user once unfollowed are skipped unless asked for. */
export interface FollowAllResult {
  added: number;
  /** Names skipped because the user unfollowed them before. */
  skipped: number;
  /** Up to 20 of the skipped names, for the page to list. */
  skippedNames: string[];
}
