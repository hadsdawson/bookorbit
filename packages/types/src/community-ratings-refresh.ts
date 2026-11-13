export const COMMUNITY_RATINGS_REFRESH_SCHEDULES = ["off", "monthly"] as const;
export type CommunityRatingsRefreshSchedule = (typeof COMMUNITY_RATINGS_REFRESH_SCHEDULES)[number];

export type CommunityRatingsRefreshTrigger = "manual" | "scheduled";

/** One pass over every book that has community ratings. `finishedAt` is null while it runs. */
export interface CommunityRatingsRefreshRun {
  trigger: CommunityRatingsRefreshTrigger;
  startedAt: string;
  finishedAt: string | null;
  cancelled: boolean;
  total: number;
  processed: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface CommunityRatingsRefreshStatus {
  schedule: CommunityRatingsRefreshSchedule;
  running: boolean;
  /** The pass in progress, or the last one that ran. */
  run: CommunityRatingsRefreshRun | null;
  booksWithRatings: number;
  /** When the monthly schedule will next start a pass; null when it is off or one is running. */
  nextScheduledAt: string | null;
}
