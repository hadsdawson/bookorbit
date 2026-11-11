import type { AudiobookChapter, CoverMedium, FolderCoverMedia } from '@bookorbit/types';

/** The fields Audiobookshelf reads from a book folder's metadata.json, in the order it writes them. */
export interface AbsMetadataJson {
  tags: string[];
  chapters: { id: number; start: number; end: number; title: string }[];
  title: string | null;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  series: string[];
  genres: string[];
  publishedYear: string | null;
  publishedDate: string | null;
  publisher: string | null;
  description: string | null;
  isbn: string | null;
  asin: string | null;
  language: string | null;
  explicit: boolean;
  abridged: boolean;
}

export interface AbsMetadataSource {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  language: string | null;
  seriesName: string | null;
  seriesIndex: number | string | null;
  isbn10: string | null;
  isbn13: string | null;
  audibleId: string | null;
  amazonId: string | null;
  authors: { name: string }[];
  narrators: string[];
  genres: string[];
  tags: string[];
  abridged: boolean;
  chapters: readonly AudiobookChapter[];
  durationSeconds: number | null;
}

export const METADATA_JSON_NAME = 'metadata.json';
export const PRIMARY_COVER_NAME = 'cover.jpg';
export const EBOOK_COVER_NAME = 'cover-ebook.jpg';

export function buildAbsMetadata(source: AbsMetadataSource): AbsMetadataJson {
  return {
    tags: [...source.tags],
    chapters: absChapters(source.chapters, source.durationSeconds),
    title: source.title,
    subtitle: source.subtitle,
    authors: source.authors.map((author) => author.name),
    narrators: [...source.narrators],
    series: source.seriesName ? [seriesEntry(source.seriesName, source.seriesIndex)] : [],
    genres: [...source.genres],
    publishedYear: source.publishedYear !== null ? String(source.publishedYear) : (source.publishedDate?.slice(0, 4) ?? null),
    publishedDate: source.publishedDate,
    publisher: source.publisher,
    description: source.description,
    isbn: source.isbn13 ?? source.isbn10,
    asin: source.audibleId ?? source.amazonId,
    language: source.language,
    explicit: false,
    abridged: source.abridged,
  };
}

/** Audiobookshelf's "Name #2" form, with the number written the way people write it (1, 1.5). */
function seriesEntry(name: string, index: number | string | null): string {
  if (index === null || index === '') return name;
  const number = Number(index);
  return `${name} #${Number.isFinite(number) ? String(number) : String(index)}`;
}

/** Seconds, each chapter ending where the next starts and the last at the book's end. */
function absChapters(chapters: readonly AudiobookChapter[], durationSeconds: number | null): AbsMetadataJson['chapters'] {
  const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);
  return sorted.map((chapter, index) => {
    const start = chapter.startMs / 1000;
    const next = sorted[index + 1];
    const end = next ? next.startMs / 1000 : Math.max(start, durationSeconds ?? start);
    return { id: index, start, end, title: chapter.title };
  });
}

/**
 * The cover files a folder gets: the slots the setting asks for that the book has, named so the
 * audiobook cover is the plain cover.jpg Audiobookshelf looks for, and an ebook cover is only
 * named apart when both are written.
 */
export function folderCoverFiles(setting: FolderCoverMedia, available: ReadonlySet<CoverMedium>): { medium: CoverMedium; name: string }[] {
  const wanted: CoverMedium[] = [];
  if ((setting === 'audiobook' || setting === 'both') && available.has('audio')) wanted.push('audio');
  if ((setting === 'ebook' || setting === 'both') && available.has('ebook')) wanted.push('ebook');
  if (wanted.length === 1) return [{ medium: wanted[0], name: PRIMARY_COVER_NAME }];
  return wanted.map((medium) => ({ medium, name: medium === 'audio' ? PRIMARY_COVER_NAME : EBOOK_COVER_NAME }));
}
