import type { NewReleaseFormat, NewReleaseRequestFormat } from '@bookorbit/types';

import type { CreateBookRequestDto } from '../book-request/dto/create-book-request.dto';
import type { UpcomingReleaseRow } from './new-releases.repository';
import type { SourceRelease } from './release-merge';

export const NEW_RELEASE_REQUEST_NOTE = 'Requested from New Releases';

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
export function requestFor(release: UpcomingReleaseRow, format: NewReleaseRequestFormat): CreateBookRequestDto {
  const date = formatDate(release, format);
  const sources = (release.sources as SourceRelease[] | null) ?? [];
  const audible = format === 'audiobook' ? sources.find((source) => source.source === 'audible' && source.asin) : undefined;
  const dto: Partial<CreateBookRequestDto> = {
    mediaKind: format,
    title: release.title,
    authors: release.authors,
    note: NEW_RELEASE_REQUEST_NOTE,
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
