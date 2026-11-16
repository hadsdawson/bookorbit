/** How many audiobooks may convert at once. Each conversion uses one processor core. */
export const CONVERSION_CONCURRENCY_MIN = 1;
export const CONVERSION_CONCURRENCY_MAX = 3;

export interface ConversionSettings {
  enabled: boolean;
  concurrency: number;
}

export const DEFAULT_CONVERSION_SETTINGS: ConversionSettings = {
  enabled: false,
  concurrency: 1,
};

/**
 * `waiting`: in the Convert folder but not converted (a folder with more tracks than can be joined).
 * `skipped`: nothing to convert (no audio file in it).
 */
export type ConversionJobStatus = "queued" | "converting" | "done" | "failed" | "waiting" | "skipped";

/** What the conversion does to the audio: copied as-is, re-encoded, or already an M4B and only moved. */
export type ConversionMethod = "copy" | "encode" | "move";

/**
 * `no_audio`: nothing to convert. `too_many_files`: more tracks than one book can be joined from.
 * `stopped`: conversions were turned off mid-way. `original_kept`: converted, but the original could
 * not be removed. `failed`: anything else, with `detail` saying what.
 */
export type ConversionReason = "no_audio" | "too_many_files" | "stopped" | "original_kept" | "failed";

export interface ConversionJob {
  id: string;
  /** The file or folder name as it sits in the Convert folder. */
  name: string;
  status: ConversionJobStatus;
  method: ConversionMethod | null;
  /** 0 to 100 while converting. */
  progress: number | null;
  /** While converting: how many times faster than real time the audio is being processed. */
  speed: number | null;
  /** While converting: roughly how many seconds are left. */
  etaSeconds: number | null;
  /** Bits per second of the audio written, when it was re-encoded. */
  bitrate: number | null;
  /** How many tracks were joined into one M4B; null for a single file. */
  trackCount: number | null;
  /** Why an item failed, waits, was skipped, or finished with a caveat. */
  reason: ConversionReason | null;
  /** The technical cause of a failure, in English, for troubleshooting. */
  detail: string | null;
  /** Where the M4B landed, relative to the Book Dock folder. */
  outputName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ConversionOverview {
  settings: ConversionSettings;
  convertPath: string;
  jobs: ConversionJob[];
}

export interface ConversionStatus {
  enabled: boolean;
  /** Items waiting or converting, for the sidebar count. */
  active: number;
}
