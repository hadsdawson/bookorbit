import type {
  AudiobookChapter,
  BookOrbitFolderMetadata,
  ComicMetadataFields,
  CoverMedium,
  FolderCoverMedia,
  MetadataProviderKey,
} from '@bookorbit/types';

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
  /** Fork: other names each credited author goes by. Only written when an author has any. */
  authorsAlsoKnownAs?: Record<string, string[]>;
  /** Fork: everything else BookOrbit keeps for the book, which Audiobookshelf has no field for. */
  bookorbit?: BookOrbitFolderMetadata;
}

/** Fork: the provider ids BookOrbit stores on the book itself, written under `bookorbit` by these names. */
const IDENTIFIER_FIELDS = [
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'hardcoverEditionId',
  'openLibraryId',
  'itunesId',
  'audibleId',
  'librofmId',
  'koboId',
  'comicvineId',
  'ranobedbId',
  'lubimyczytacId',
  'aladinId',
] as const;

type IdentifierField = (typeof IDENTIFIER_FIELDS)[number];

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
  /** BookOrbit keeps no such flag of its own, so it is carried over from the folder's existing file. */
  explicit?: boolean;
  /** Fork: other names each credited author goes by. */
  authorsAlsoKnownAs?: Record<string, string[]>;
  /** Fork: the details below go in the `bookorbit` section. */
  editionName?: string | null;
  originalPublishedYear?: number | null;
  pageCount?: number | null;
  seriesMemberships?: { seriesName: string; seriesIndex: string | null }[];
  communityRatings?: { provider: string; rating: number; ratingCount: number | null }[];
  externalProviderIds?: Record<string, string>;
  comicMetadata?: ComicMetadataFields | null;
}

type AbsIdentifierSource = Partial<Record<IdentifierField, string | null>>;

export const METADATA_JSON_NAME = 'metadata.json';
export const PRIMARY_COVER_NAME = 'cover.jpg';
export const EBOOK_COVER_NAME = 'cover-ebook.jpg';

export function buildAbsMetadata(source: AbsMetadataSource & AbsIdentifierSource): AbsMetadataJson {
  const extras = buildBookOrbitExtras(source);
  return {
    tags: [...source.tags],
    chapters: absChapters(source.chapters, source.durationSeconds),
    title: source.title,
    subtitle: source.subtitle,
    authors: source.authors.map((author) => author.name),
    narrators: [...source.narrators],
    series: seriesEntries(source),
    genres: [...source.genres],
    publishedYear: source.publishedYear !== null ? String(source.publishedYear) : (source.publishedDate?.slice(0, 4) ?? null),
    publishedDate: source.publishedDate,
    publisher: source.publisher,
    description: source.description,
    isbn: source.isbn13 ?? source.isbn10,
    asin: source.audibleId ?? source.amazonId,
    language: source.language,
    explicit: source.explicit === true,
    abridged: source.abridged,
    ...(source.authorsAlsoKnownAs && Object.keys(source.authorsAlsoKnownAs).length > 0 ? { authorsAlsoKnownAs: source.authorsAlsoKnownAs } : {}),
    ...(extras ? { bookorbit: extras } : {}),
  };
}

/** Every series the book is in, main one first, falling back to the main series alone. */
function seriesEntries(source: AbsMetadataSource): string[] {
  const memberships = source.seriesMemberships ?? [];
  if (memberships.length > 0) return memberships.map((membership) => seriesEntry(membership.seriesName, membership.seriesIndex));
  return source.seriesName ? [seriesEntry(source.seriesName, source.seriesIndex)] : [];
}

/**
 * Fork. The `bookorbit` section: what the Audiobookshelf fields cannot hold, or hold only in part
 * (one ISBN, one ASIN). Empty values are left out, and so is the section when nothing is left.
 */
function buildBookOrbitExtras(source: AbsMetadataSource & AbsIdentifierSource): BookOrbitFolderMetadata | null {
  const extras: BookOrbitFolderMetadata = { formatVersion: 1 };
  const editionName = source.editionName?.trim();
  if (editionName) extras.editionName = editionName;
  if (isPositive(source.originalPublishedYear)) extras.originalPublishedYear = source.originalPublishedYear;
  if (isPositive(source.pageCount)) extras.pageCount = source.pageCount;
  if (source.isbn10?.trim()) extras.isbn10 = source.isbn10.trim();
  if (source.isbn13?.trim()) extras.isbn13 = source.isbn13.trim();
  for (const field of IDENTIFIER_FIELDS) {
    const id = source[field]?.trim();
    if (id) extras[field] = id;
  }
  if (source.seriesMemberships && source.seriesMemberships.length > 0) {
    extras.seriesMemberships = source.seriesMemberships.map((membership) => ({
      seriesName: membership.seriesName,
      seriesIndex: membership.seriesIndex,
    }));
  }
  if (source.communityRatings && source.communityRatings.length > 0) {
    extras.communityRatings = source.communityRatings.map((rating) => ({
      provider: rating.provider as MetadataProviderKey,
      rating: rating.rating,
      ratingCount: rating.ratingCount,
    }));
  }
  if (source.externalProviderIds && Object.keys(source.externalProviderIds).length > 0)
    extras.externalProviderIds = { ...source.externalProviderIds };
  const comic = compactComicMetadata(source.comicMetadata);
  if (comic) extras.comicMetadata = comic;
  return Object.keys(extras).length > 1 ? extras : null;
}

function compactComicMetadata(comic: ComicMetadataFields | null | undefined): ComicMetadataFields | null {
  if (!comic) return null;
  const out: ComicMetadataFields = {};
  for (const [key, value] of Object.entries(comic) as [keyof ComicMetadataFields, string | string[] | undefined][]) {
    if (typeof value === 'string' && value.trim()) (out as Record<string, unknown>)[key] = value.trim();
    else if (Array.isArray(value) && value.length > 0) (out as Record<string, unknown>)[key] = [...value];
  }
  return Object.keys(out).length > 0 ? out : null;
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

/** The `explicit` flag of a metadata.json already in the folder, so rewriting the file never clears it. */
export function readExplicitFlag(text: string | null): boolean {
  if (!text) return false;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && (value as { explicit?: unknown }).explicit === true;
  } catch {
    return false;
  }
}
