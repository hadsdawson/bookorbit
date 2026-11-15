/** How a recycle bin entry came to be: a whole book was deleted, or one file was removed from a book. */
export const RECYCLE_BIN_ENTRY_KINDS = ["book", "file"] as const;
export type RecycleBinEntryKind = (typeof RECYCLE_BIN_ENTRY_KINDS)[number];

export interface RecycleBinFile {
  /** Where the file was, relative to its library folder. */
  relPath: string;
  sizeBytes: number | null;
}

export interface RecycleBinEntry {
  id: string;
  kind: RecycleBinEntryKind;
  title: string | null;
  libraryName: string | null;
  /** The library folder the files were deleted from and will be restored to. */
  libraryFolderPath: string;
  deletedAt: string;
  deletedBy: string | null;
  /** When the entry is deleted for good. */
  expiresAt: string;
  files: RecycleBinFile[];
  sizeBytes: number;
}

export interface RecycleBinSettings {
  /** When off, deleting a book or file removes it from disk straight away. */
  enabled: boolean;
  /** Days an entry is kept before it is deleted for good. */
  keepDays: number;
}

export const RECYCLE_BIN_KEEP_DAYS_MIN = 1;
export const RECYCLE_BIN_KEEP_DAYS_MAX = 365;
export const RECYCLE_BIN_PAGE_SIZE_MAX = 100;

export const DEFAULT_RECYCLE_BIN_SETTINGS: RecycleBinSettings = {
  enabled: true,
  keepDays: 30,
};

export interface RecycleBinOverview {
  settings: RecycleBinSettings;
  entries: RecycleBinEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecycleBinRestoreResult {
  restored: number;
  /** Files left in the bin because something already sits at their old path. */
  conflicts: string[];
  /** Files the entry listed that were no longer in the bin. */
  missing: string[];
}

export interface RecycleBinEmptyResult {
  removed: number;
  failed: number;
}
