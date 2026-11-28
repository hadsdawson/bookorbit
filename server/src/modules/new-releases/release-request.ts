import type { NewReleaseFormat, NewReleaseRequestFormat } from '@bookorbit/types';

import type { PairHalfWork } from '../book-request/book-request.service';
import type { CreateBookRequestPairDto } from '../book-request/dto/create-book-request-pair.dto';
import type { CreateBookRequestDto } from '../book-request/dto/create-book-request.dto';
import type { UpcomingReleaseRow } from './new-releases.repository';
import type { SourceRelease } from './release-merge';

export const NEW_RELEASE_REQUEST_NOTE = 'Requested from New Releases';

/** Fork: what filing a request needs to know about a book, from New Releases or the series pop-up. */
export type RequestableRelease = Pick<
  UpcomingReleaseRow,
  'title' | 'authors' | 'seriesName' | 'seriesIndex' | 'isbn13' | 'coverUrl' | 'ebookDate' | 'audiobookDate' | 'sources'
>;

/** The confirmed date of one format of a release, or null when that format has none. */
export function formatDate(release: Pick<UpcomingReleaseRow, 'ebookDate' | 'audiobookDate'>, format: NewReleaseRequestFormat): string | null {
  return format === 'ebook' ? release.ebookDate : release.audiobookDate;
}

/**
 * The formats to request on someone's behalf: the server's default format. A format with no
 * confirmed date yet is still requested, since the book itself is listed and that format usually
 * follows; the request just carries no published date for it.
 */
export function formatsToRequest(defaultFormat: NewReleaseFormat): NewReleaseRequestFormat[] {
  return defaultFormat === 'both' ? ['ebook', 'audiobook'] : [defaultFormat];
}

/** One request, as the request form would have filed it for this book in this format. */
export function requestFor(
  release: RequestableRelease,
  format: NewReleaseRequestFormat,
  note: string = NEW_RELEASE_REQUEST_NOTE,
): CreateBookRequestDto {
  const date = formatDate(release, format);
  const sources = (release.sources as SourceRelease[] | null) ?? [];
  const audible = format === 'audiobook' ? sources.find((source) => source.source === 'audible' && source.asin) : undefined;
  const dto: Partial<CreateBookRequestDto> = {
    mediaKind: format,
    title: release.title,
    authors: release.authors,
    note,
  };
  if (release.seriesName) dto.seriesName = release.seriesName;
  if (release.seriesIndex !== null && Number.isInteger(release.seriesIndex) && release.seriesIndex >= 0) dto.seriesIndex = release.seriesIndex;
  if (release.isbn13 && format === 'ebook') dto.isbn13 = release.isbn13;
  if (release.coverUrl) dto.coverUrl = release.coverUrl;
  if (date) {
    dto.publishedDate = date;
    dto.publishedYear = Number(date.slice(0, 4));
  }
  if (audible?.asin) {
    dto.providerKey = 'audible';
    dto.providerId = audible.asin;
  }
  return dto as CreateBookRequestDto;
}

/**
 * Fork. Both formats of one book as a single paired request, as the request form files "both": the work
 * they share, and what each format sets for itself (its own date, the ebook's ISBN, the audiobook's
 * Audible id).
 */
export function pairRequestFor(
  release: RequestableRelease,
  note: string = NEW_RELEASE_REQUEST_NOTE,
): {
  work: CreateBookRequestPairDto;
  halves: Record<NewReleaseRequestFormat, PairHalfWork>;
} {
  const ebook = requestFor(release, 'ebook', note);
  const audiobook = requestFor(release, 'audiobook', note);
  const shared: Partial<CreateBookRequestPairDto> = { title: ebook.title, authors: ebook.authors, note: ebook.note };
  if (ebook.seriesName !== undefined) shared.seriesName = ebook.seriesName;
  if (ebook.seriesIndex !== undefined) shared.seriesIndex = ebook.seriesIndex;
  if (ebook.coverUrl !== undefined) shared.coverUrl = ebook.coverUrl;
  const ownWork = (dto: CreateBookRequestDto): PairHalfWork => ({
    isbn13: dto.isbn13,
    publishedDate: dto.publishedDate,
    publishedYear: dto.publishedYear,
    providerKey: dto.providerKey,
    providerId: dto.providerId,
  });
  return { work: shared as CreateBookRequestPairDto, halves: { ebook: ownWork(ebook), audiobook: ownWork(audiobook) } };
}
