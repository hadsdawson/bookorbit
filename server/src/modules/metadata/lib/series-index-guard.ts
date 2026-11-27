/**
 * Fork. A series number means nothing without its series name. Calibre writes `series_index` on
 * every book, so files often carry a stray number with no series; drop it for every format.
 */
export function withoutLoneSeriesIndex<T extends { seriesName?: string | null; seriesIndex?: string | null } | null>(data: T): T {
  if (!data || data.seriesName?.trim() || data.seriesIndex == null) return data;
  return { ...data, seriesIndex: null };
}
