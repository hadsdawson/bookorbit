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
  /** Why it is listed: the follows of this user it matched. */
  matchedFollows: { kind: ReleaseFollowKind; name: string }[];
  state: NewReleaseUserState;
}

export interface NewReleasesServerSettings {
  defaultFormat: NewReleaseFormat;
  defaultDelivery: NewReleaseDelivery;
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
