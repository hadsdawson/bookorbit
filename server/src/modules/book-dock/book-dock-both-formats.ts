import type { BookDockMetadata } from '@bookorbit/types';

import { mainTitlePart, symmetricTitleSimilarity } from '../../common/text-match/title-match';

/** One medium's lookup, as Book Dock stores it: its details, and which source gave each field. */
export interface MediumLookup {
  metadata: BookDockMetadata;
  sources: Record<string, string>;
}

/** Only an audiobook has these, so they always come from the audiobook lookup. */
const AUDIO_FIELDS = ['narrators', 'durationSeconds', 'abridged', 'audibleId', 'librofmId'] as const satisfies readonly (keyof BookDockMetadata)[];
/** How alike the two lookups' main titles must be for them to count as the same book. */
const SAME_BOOK_SIMILARITY = 0.8;

/**
 * Joins the ebook and audiobook lookups for one Book Dock file. The ebook's details win wherever
 * both have a value, the audiobook supplies the audiobook-only fields, and either fills what the
 * other lacks. `coverUrl` stays the cover for the file's own format, and `otherFormatCoverUrl`
 * carries the other format's, so both slots can be filled when the book is filed. When the two
 * lookups found different books, the other format's answer is dropped rather than mixed in.
 */
export function mergeFormatLookups(ebook: MediumLookup, audio: MediumLookup, ownFormat: 'ebook' | 'audio'): MediumLookup {
  const own = ownFormat === 'audio' ? audio : ebook;
  const other = ownFormat === 'audio' ? ebook : audio;
  if (isEmpty(own.metadata) && isEmpty(other.metadata)) return { metadata: {}, sources: {} };
  if (!sameBook(ebook.metadata.title, audio.metadata.title)) return own;

  const base = isEmpty(ebook.metadata) ? audio : ebook;
  const extra = base === ebook ? audio : ebook;
  const metadata: BookDockMetadata = { ...base.metadata };
  const sources: Record<string, string> = { ...base.sources };
  const take = (field: keyof BookDockMetadata) => {
    (metadata as Record<string, unknown>)[field] = extra.metadata[field];
    if (extra.sources[field]) sources[field] = extra.sources[field];
    else delete sources[field];
  };

  for (const [field, value] of Object.entries(extra.metadata) as [keyof BookDockMetadata, unknown][]) {
    if (field === 'coverUrl' || field === 'chapters') continue;
    const audioOnly = (AUDIO_FIELDS as readonly string[]).includes(field);
    if (hasValue(value) && ((audioOnly && extra === audio) || !hasValue(metadata[field]))) take(field);
  }
  // Chapters only mean something next to the audio they were timed against.
  if (ownFormat === 'audio' && hasValue(audio.metadata.chapters)) {
    metadata.chapters = audio.metadata.chapters;
    if (audio.sources.chapters) sources.chapters = audio.sources.chapters;
  } else {
    delete metadata.chapters;
    delete sources.chapters;
  }

  metadata.coverUrl = own.metadata.coverUrl ?? null;
  if (own.sources.coverUrl) sources.coverUrl = own.sources.coverUrl;
  else delete sources.coverUrl;
  if (other.metadata.coverUrl) {
    metadata.otherFormatCoverUrl = other.metadata.coverUrl;
    if (other.sources.coverUrl) sources.otherFormatCoverUrl = other.sources.coverUrl;
  }
  if (metadata.coverUrl === null) delete metadata.coverUrl;
  return { metadata, sources };
}

function sameBook(ebookTitle: string | null | undefined, audioTitle: string | null | undefined): boolean {
  if (!ebookTitle || !audioTitle) return true;
  return symmetricTitleSimilarity(mainTitlePart(ebookTitle), mainTitlePart(audioTitle)) >= SAME_BOOK_SIMILARITY;
}

function isEmpty(metadata: BookDockMetadata): boolean {
  return !Object.values(metadata).some(hasValue);
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
