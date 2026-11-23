import { AsyncLocalStorage } from 'node:async_hooks';

import type { LibraryScanChangeType, LibraryScanFieldChange } from '@bookorbit/types';

export const SCAN_CHANGE_CAP = 10_000;
const VALUE_MAX_LENGTH = 400;

export interface CollectedScanChange {
  bookId: number;
  changeType: LibraryScanChangeType;
  fieldChanges: LibraryScanFieldChange[];
  folderPath: string | null;
  occurredAt: Date;
}

function clip(value: string | null): string | null {
  if (value === null) return null;
  return value.length > VALUE_MAX_LENGTH ? `${value.slice(0, VALUE_MAX_LENGTH)}...` : value;
}

/**
 * Gathers what one scan did to each book. Rows are capped so a first scan of a huge library cannot
 * hold the whole library in memory; past the cap only the truncated flag is kept.
 */
export class ScanChangeCollector {
  private readonly byKey = new Map<string, CollectedScanChange>();
  truncated = false;

  constructor(private readonly cap = SCAN_CHANGE_CAP) {}

  get entries(): CollectedScanChange[] {
    return [...this.byKey.values()];
  }

  record(bookId: number, changeType: LibraryScanChangeType, fieldChanges: LibraryScanFieldChange[] = [], folderPath: string | null = null): void {
    const key = `${bookId}:${changeType}`;
    const existing = this.byKey.get(key);
    const clipped = fieldChanges.map((change) => ({ field: change.field, old: clip(change.old), new: clip(change.new) }));
    if (existing) {
      existing.fieldChanges.push(...clipped);
      if (folderPath) existing.folderPath = folderPath;
      return;
    }
    if (this.byKey.size >= this.cap) {
      this.truncated = true;
      return;
    }
    this.byKey.set(key, { bookId, changeType, fieldChanges: clipped, folderPath, occurredAt: new Date() });
  }
}

export const scanChangeStorage = new AsyncLocalStorage<ScanChangeCollector>();

export function recordScanChange(
  bookId: number,
  changeType: LibraryScanChangeType,
  fieldChanges: LibraryScanFieldChange[] = [],
  folderPath: string | null = null,
): void {
  scanChangeStorage.getStore()?.record(bookId, changeType, fieldChanges, folderPath);
}
