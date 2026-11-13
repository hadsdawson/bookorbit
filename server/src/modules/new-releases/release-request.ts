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
 * The formats to request on someone's behalf: the server's default format, narrowed to the formats
 * that have a confirmed date. A book only known as an ebook is not requested as an audiobook.
 */
export function formatsToRequest(
  release: Pick<UpcomingReleaseRow, 'ebookDate' | 'audiobookDate'>,
  defaultFormat: NewReleaseFormat,
): NewReleaseRequestFormat[] {
  const wanted: NewReleaseRequestFormat[] = defaultFormat === 'both' ? ['ebook', 'audiobook'] : [defaultFormat];
  return wanted.filter((format) => formatDate(release, format) !== null);
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
