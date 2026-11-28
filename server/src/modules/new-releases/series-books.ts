import { fullDate, mergeReleases, type MergedRelease, type ReleaseMediaKind, type SourceRelease } from './release-merge';

/** Fork: the most books the series pop-up lists. Longer series are rare and the rest are cut. */
export const SERIES_BOOKS_LIMIT = 60;

/** One book of a series as the series pop-up needs it, before the user's library is checked. */
export interface SeriesBookRow extends MergedRelease {
  releasedOn: string | null;
  comingOn: string | null;
  comingSoon: boolean;
}

function earliestPast(reports: readonly SourceRelease[], today: string, kind?: ReleaseMediaKind): string | null {
  return (
    reports
      .filter((report) => !kind || report.mediaKind === kind)
      .map((report) => fullDate(report.date))
      .filter((date): date is string => date !== null && date <= today)
      .sort()[0] ?? null
  );
}

/** Mirrors the New Releases language filter: a source stating only other languages keeps a book off. */
export function matchesLanguage(reports: readonly SourceRelease[], language: string | null, strict: boolean): boolean {
  if (!language) return true;
  const states = (report: SourceRelease) => !!report.language || (report.languages?.length ?? 0) > 0;
  const matches = (report: SourceRelease) => report.language === language || (report.languages ?? []).includes(language);
  if (reports.some((report) => states(report) && !matches(report))) return false;
  return !strict || reports.some(matches);
}

function byReadingOrder(a: SeriesBookRow, b: SeriesBookRow): number {
  if (a.seriesIndex !== null && b.seriesIndex !== null && a.seriesIndex !== b.seriesIndex) return a.seriesIndex - b.seriesIndex;
  if (a.seriesIndex === null) return b.seriesIndex === null ? (a.releasedOn ?? a.comingOn ?? '').localeCompare(b.releasedOn ?? b.comingOn ?? '') : 1;
  if (b.seriesIndex === null) return -1;
  return (a.releasedOn ?? a.comingOn ?? '').localeCompare(b.releasedOn ?? b.comingOn ?? '');
}

/**
 * Every book of a series the sites reported, one row per work, in reading order. Unlike New
 * Releases, books already out are kept, with the date each format came out.
 */
export function toSeriesBooks(
  reports: readonly SourceRelease[],
  today: string,
  filter: { language: string | null; strict: boolean },
): SeriesBookRow[] {
  return mergeReleases(reports, today)
    .filter((merged) => matchesLanguage(merged.sources, filter.language, filter.strict))
    .map((merged) => {
      const releasedOn = earliestPast(merged.sources, today);
      const comingOn = releasedOn ? null : merged.releaseDate;
      return {
        ...merged,
        ebookDate: merged.ebookDate ?? earliestPast(merged.sources, today, 'ebook'),
        audiobookDate: merged.audiobookDate ?? earliestPast(merged.sources, today, 'audiobook'),
        releasedOn,
        comingOn,
        comingSoon: comingOn !== null,
      };
    })
    .sort(byReadingOrder)
    .slice(0, SERIES_BOOKS_LIMIT);
}
