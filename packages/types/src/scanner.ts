export type ScanJobStatus = "running" | "completed" | "failed";
export type ScanTriggeredBy = "manual" | "watcher" | "schedule";

/** The last recorded scan_jobs row for a library, or null when it has never been scanned. */
export interface LibraryLastScan {
  status: ScanJobStatus;
  triggeredBy: ScanTriggeredBy;
  startedAt: string;
  completedAt: string | null;
  addedCount: number;
  updatedCount: number;
  missingCount: number;
  errorMessage: string | null;
}

/** One row of a library's scan_jobs history, newest first. */
export interface LibraryScanHistoryEntry extends LibraryLastScan {
  id: number;
}

export type LibraryScanChangeType = "added" | "updated" | "missing" | "restored";

export interface LibraryScanFieldChange {
  field: string;
  old: string | null;
  new: string | null;
}

/** One book a scan touched, with what happened to it. */
export interface LibraryScanChange {
  id: number;
  bookId: number | null;
  title: string | null;
  authors: string | null;
  folderPath: string | null;
  changeType: LibraryScanChangeType;
  fieldChanges: LibraryScanFieldChange[];
  occurredAt: string;
}

export interface LibraryScanChangesPage {
  items: LibraryScanChange[];
  total: number;
  /** True when the scan touched more books than the per-scan cap, so the list is not complete. */
  truncated: boolean;
}

export interface ScanProgressEvent {
  jobId: number;
  libraryId: number;
  status: ScanJobStatus;
  processed: number;
  total: number;
  added: number;
  updated: number;
  missing: number;
  errorMessage?: string;
}

export interface CoverRefreshProgressEvent {
  libraryId: number;
  processed: number;
  total: number;
  status: "running" | "completed";
}

export interface CoverRefreshedEvent {
  bookIds: number[];
  libraryId?: number;
}

export interface BookMissingEvent {
  libraryId: number;
  bookIds: number[];
}

export interface BookRestoredEvent {
  libraryId: number;
  bookIds: number[];
}

export interface BookMovedEvent {
  libraryId: number;
  bookIds: number[];
}

export interface BookTransferredEvent {
  fromLibraryId: number;
  toLibraryId: number;
  bookIds: number[];
}

/** Sent to the person who saved the change, so their open listings can re-run their filters. */
export interface BookMetadataChangedEvent {
  bookIds: number[];
}

export interface BookProgressChangedEvent {
  bookId: number;
  progress: number;
  source: "koreader" | "kobo" | "web_reader";
}

export interface ScanBooksAddedEvent {
  libraryId: number;
  books: import("./book").BookCard[];
}
