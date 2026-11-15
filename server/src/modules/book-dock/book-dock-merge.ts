import type { BookDockFileRow } from '../../db/schema';

/** Fork: the main file of a group merged in Book Dock points at itself; the others point at it. */
export function isMergePrimary(row: Pick<BookDockFileRow, 'id' | 'mergedIntoId'>): boolean {
  return row.mergedIntoId === row.id;
}

/** Fork: whether a file is part of a group merged in Book Dock, main file or not. */
export function isMerged(row: Pick<BookDockFileRow, 'mergedIntoId'>): boolean {
  return typeof row.mergedIntoId === 'number';
}
