import { normalizeWorkToken } from '@bookorbit/types';

export type ReleaseSourceKey = 'hardcover' | 'audible' | 'google';
export type ReleaseMediaKind = 'ebook' | 'audiobook';

/** Earlier sources win where two disagree on anything but the date. */
export const SOURCE_PRIORITY: readonly ReleaseSourceKey[] = ['hardcover', 'audible', 'google'];

/** One book as one source reported it. `date` is whatever the source gave, checked later. */
export interface SourceRelease {
  source: ReleaseSourceKey;
  sourceId: string;
  mediaKind: ReleaseMediaKind;
  title: string;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  coverUrl: string | null;
  isbn13: string | null;
  asin: string | null;
  date: string | null;
}

export interface MergedRelease {
  workKey: string;
  title: string;
  authors: string[];
  authorKeys: string[];
  seriesName: string | null;
  seriesKey: string | null;
  seriesIndex: number | null;
  coverUrl: string | null;
  isbn13: string | null;
  asin: string | null;
  ebookDate: string | null;
  audiobookDate: string | null;
  releaseDate: string | null;
  sources: SourceRelease[];
}

/** How far ahead a real release date can sit. Further out is a placeholder. */
export const MAX_YEARS_AHEAD = 3;

/** Collections and reissues, which a series or author list carries but nobody is waiting for. */
const NOT_A_NEW_BOOK =
  /\b(box(ed)?[\s-]?set|boxset|omnibus|collection|books?\s+\d+\s*[-–&]\s*\d+|bundle|trilogy set|summary of|study guide|coloring book|calendar)\b/i;

export function nameKey(value: string): string {
  return normalizeWorkToken(value);
}

/** The title without a subtitle or a bracketed series note, which sources add differently. */
export function workKeyFor(title: string, authors: readonly string[]): string {
  const bare = title
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .split(/:|\s-\s/)[0]!
    .trim();
  return `${normalizeWorkToken(bare)}|${normalizeWorkToken(authors[0] ?? '')}`;
}

export function isNewBookTitle(title: string): boolean {
  return title.trim().length > 0 && !NOT_A_NEW_BOOK.test(title);
}

/** A full YYYY-MM-DD date, or null for anything vaguer, invalid, or a timestamp on another day. */
export function fullDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? '');
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function addYears(isoDate: string, years: number): string {
  return `${Number(isoDate.slice(0, 4)) + years}${isoDate.slice(4)}`;
}

/** The first and last days of a year are where unknown dates get parked, so they need a second source. */
function isParkingDate(isoDate: string): boolean {
  const monthDay = isoDate.slice(5);
  return monthDay === '01-01' || monthDay === '12-31';
}

/**
 * The confirmed date for one format, or null.
 *
 * Only dates after `today` and within `MAX_YEARS_AHEAD` years count. A date two sources agree on is
 * confirmed. Otherwise the highest-priority source's date stands alone, unless another source gave
 * a different date or it is a 1 January or 31 December date: those wait for a second source.
 */
export function confirmedDate(reports: readonly SourceRelease[], today: string): string | null {
  const latest = addYears(today, MAX_YEARS_AHEAD);
  const dated = reports
    .map((report) => ({ report, date: fullDate(report.date) }))
    .filter((entry): entry is { report: SourceRelease; date: string } => entry.date !== null && entry.date > today && entry.date <= latest);
  if (dated.length === 0) return null;

  const bySource = new Map<ReleaseSourceKey, string>();
  for (const entry of dated) if (!bySource.has(entry.report.source)) bySource.set(entry.report.source, entry.date);
  const distinct = [...new Set(bySource.values())];

  const agreed = distinct.find((date) => [...bySource.values()].filter((other) => other === date).length >= 2);
  if (agreed) return agreed;
  if (distinct.length > 1) return null;
  const only = distinct[0]!;
  return isParkingDate(only) ? null : only;
}

function bySourcePriority(a: SourceRelease, b: SourceRelease): number {
  return SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source);
}

/** Folds every source's reports into one row per work, keeping only proper new books. */
export function mergeReleases(reports: readonly SourceRelease[], today: string): MergedRelease[] {
  const groups = new Map<string, SourceRelease[]>();
  for (const report of reports) {
    if (!isNewBookTitle(report.title) || report.authors.length === 0) continue;
    const key = workKeyFor(report.title, report.authors);
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }

  const merged: MergedRelease[] = [];
  for (const [workKey, group] of groups) {
    const ordered = [...group].sort(bySourcePriority);
    const lead = ordered[0]!;
    const ebookDate = confirmedDate(
      ordered.filter((report) => report.mediaKind === 'ebook'),
      today,
    );
    const audiobookDate = confirmedDate(
      ordered.filter((report) => report.mediaKind === 'audiobook'),
      today,
    );
    const dates = [ebookDate, audiobookDate].filter((date): date is string => date !== null).sort();
    const seriesName = ordered.find((report) => report.seriesName)?.seriesName ?? null;
    merged.push({
      workKey,
      title: lead.title,
      authors: lead.authors,
      authorKeys: [...new Set(ordered.flatMap((report) => report.authors).map(nameKey))].filter(Boolean),
      seriesName,
      seriesKey: seriesName ? nameKey(seriesName) : null,
      seriesIndex: ordered.find((report) => report.seriesIndex !== null)?.seriesIndex ?? null,
      coverUrl: ordered.find((report) => report.coverUrl)?.coverUrl ?? null,
      isbn13: ordered.find((report) => report.isbn13)?.isbn13 ?? null,
      asin: ordered.find((report) => report.asin)?.asin ?? null,
      ebookDate,
      audiobookDate,
      releaseDate: dates[0] ?? null,
      sources: ordered,
    });
  }
  return merged;
}
