import type { BookDetail, BookMetadataLockField, CoverAspectRatio, CoverMedium, MetadataCandidate, MetadataCoverShape } from '@bookorbit/types'

type SlotBook = Pick<BookDetail, 'coverMedia' | 'covers' | 'coverSource' | 'coverVersion'>

export function otherMedium(medium: CoverMedium): CoverMedium {
  return medium === 'ebook' ? 'audio' : 'ebook'
}

export type CoverFit = 'match' | 'unknown' | 'mismatch'

const SLOT_SHAPE: Record<CoverMedium, Exclude<MetadataCoverShape, 'unknown'>> = { ebook: 'portrait', audio: 'square' }

/** Slot-shaped art ranks first and art of the other shape last, as in the server's cover choices. */
export const COVER_FIT_RANK: Record<CoverFit, number> = { match: 0, unknown: 1, mismatch: 2 }

export function coverFit(shape: MetadataCoverShape, medium: CoverMedium): CoverFit {
  if (shape === 'unknown') return 'unknown'
  return shape === SLOT_SHAPE[medium] ? 'match' : 'mismatch'
}

export function statedCoverShape(candidate: MetadataCandidate): MetadataCoverShape {
  return candidate.coverShape ?? 'unknown'
}

export function coverLockField(medium: CoverMedium | null): Extract<BookMetadataLockField, 'cover' | 'audioCover'> {
  return medium === 'audio' ? 'audioCover' : 'cover'
}

/**
 * The slot a frame of this shape shows. Given the book's own `coverAspectRatio`, which the server
 * derives from the slot it serves, this is the server's face.
 */
export function faceMedium(book: Pick<SlotBook, 'covers'>, aspectRatio: CoverAspectRatio | string): CoverMedium {
  const preferred: CoverMedium = aspectRatio === '1/1' ? 'audio' : 'ebook'
  if (book.covers[preferred]) return preferred
  const alternate = otherMedium(preferred)
  return book.covers[alternate] ? alternate : preferred
}

/**
 * Fork. Every book gets an ebook and an audiobook tile, whichever files it has: a chosen cover is kept for a format
 * with no files, and an empty tile shows the placeholder style.
 */
export function editorTiles(_book?: Pick<SlotBook, 'coverMedia'>): CoverMedium[] {
  return ['ebook', 'audio']
}

/** The slot a metadata result's `cover` field fills: the ebook slot, unless the book has no ebook. */
export function coverFieldMedium(book: Pick<SlotBook, 'coverMedia'>): CoverMedium | null {
  if (book.coverMedia.includes('ebook')) return 'ebook'
  if (book.coverMedia.includes('audio')) return 'audio'
  return null
}

/** A cover the upgrade has not moved into a slot yet: the summary says there is one, but no slot holds it. */
export function isLegacyCover(book: Pick<SlotBook, 'covers' | 'coverSource'>): boolean {
  return book.coverSource !== null && book.covers.ebook === null && book.covers.audio === null
}

export type CoverTileState = {
  hasImage: boolean
  source: 'extracted' | 'custom' | null
  version: string
}

/**
 * What a tile shows. Until the upgrade converts a legacy cover, it has no slot, so the tile the face
 * would resolve to shows it rather than an empty placeholder.
 */
export function coverTileState(book: SlotBook, medium: CoverMedium | null, aspectRatio: CoverAspectRatio | string): CoverTileState {
  const slot = medium ? book.covers[medium] : null
  if (slot) return { hasImage: true, source: slot.source, version: slot.updatedAt }
  if (!isLegacyCover(book)) return { hasImage: false, source: null, version: book.coverVersion }
  // The book's only medium holds a legacy cover; with both or neither, the face the server serves does.
  const legacyTile = book.coverMedia.length === 1 ? book.coverMedia[0] : faceMedium(book, aspectRatio)
  if (medium !== null && medium !== legacyTile) return { hasImage: false, source: null, version: book.coverVersion }
  return { hasImage: true, source: book.coverSource, version: book.coverVersion }
}
