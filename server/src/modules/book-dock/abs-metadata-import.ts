import { basename } from 'path';

import type { BookDockMetadata, MetadataSeriesMembership } from '@bookorbit/types';

/** Audiobookshelf keeps a book's details in this file inside the book's folder. */
export const ABS_METADATA_FILE_NAME = 'metadata.json';
/** Larger than any real metadata.json by far, so a stray huge file is never read into memory. */
export const ABS_METADATA_MAX_BYTES = 2 * 1024 * 1024;

/** True for Audiobookshelf's metadata file, whatever case its name was written in. */
export function isAbsMetadataFile(fileName: string): boolean {
  return basename(fileName).toLowerCase() === ABS_METADATA_FILE_NAME;
}

/**
 * Prefers the image Audiobookshelf itself names cover.*, then any other folder image, so the cover
 * a person picked there comes along rather than one embedded in the file.
 */
export function pickAbsCoverFile<T extends { fileName: string }>(images: readonly T[]): T | null {
  if (images.length === 0) return null;
  return images.find((image) => /^cover\.[a-z0-9]+$/i.test(basename(image.fileName))) ?? images[0]!;
}

/**
 * Reads an Audiobookshelf metadata.json into Book Dock details. Only what the file states is
 * returned: a missing or empty field is left out, so it never blanks a value from elsewhere.
 * Returns null when the text is not a JSON object.
 */
export function parseAbsMetadataJson(text: string, options: { audio: boolean }): BookDockMetadata | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  const meta: BookDockMetadata = {};
  const title = cleanString(raw.title);
  if (title) meta.title = title;
  const subtitle = cleanString(raw.subtitle);
  if (subtitle) meta.subtitle = subtitle;
  const description = cleanString(raw.description);
  if (description) meta.description = description;
  const publisher = cleanString(raw.publisher);
  if (publisher) meta.publisher = publisher;
  const language = cleanString(raw.language);
  if (language) meta.language = language;

  const authors = nameList(raw.authors);
  if (authors.length > 0) meta.authors = authors;
  const narrators = nameList(raw.narrators);
  if (narrators.length > 0) meta.narrators = narrators;
  const genres = nameList(raw.genres);
  if (genres.length > 0) meta.genres = genres;
  const tags = nameList(raw.tags);
  if (tags.length > 0) meta.tags = tags;

  applyDates(raw, meta);
  applyIsbn(cleanString(raw.isbn), meta);

  const asin = cleanString(raw.asin);
  if (asin) {
    if (options.audio) meta.audibleId = asin;
    else meta.amazonId = asin;
  }

  const series = seriesList(raw.series);
  if (series.length > 0) {
    meta.seriesName = series[0]!.seriesName;
    meta.seriesIndex = series[0]!.seriesIndex ?? null;
    meta.seriesMemberships = series;
  }

  if (typeof raw.abridged === 'boolean') meta.abridged = raw.abridged;

  if (options.audio) {
    const chapters = chapterList(raw.chapters);
    if (chapters.length > 0) meta.chapters = chapters;
  }

  return meta;
}

function applyDates(raw: Record<string, unknown>, meta: BookDockMetadata): void {
  const date = cleanString(raw.publishedDate);
  const yearText = cleanString(raw.publishedYear) ?? (typeof raw.publishedYear === 'number' ? String(raw.publishedYear) : null);
  if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) meta.publishedDate = date.slice(0, 10);
  const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : meta.publishedDate ? Number(meta.publishedDate.slice(0, 4)) : null;
  if (year !== null) meta.publishedYear = year;
}

function applyIsbn(isbn: string | null, meta: BookDockMetadata): void {
  if (!isbn) return;
  const digits = isbn.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(digits)) meta.isbn13 = digits;
  else if (/^\d{9}[\dX]$/.test(digits)) meta.isbn10 = digits;
}

/** Strings, or the `{ name }` objects older exports used. Blank and repeated names are dropped. */
function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of value) {
    const name = cleanString(isRecord(entry) ? entry.name : entry);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

/** "Name #2" strings as Audiobookshelf writes them, or `{ name, sequence }` objects. */
function seriesList(value: unknown): MetadataSeriesMembership[] {
  if (!Array.isArray(value)) return [];
  const memberships: MetadataSeriesMembership[] = [];
  for (const entry of value) {
    let name: string | null;
    let sequence: string | null;
    if (isRecord(entry)) {
      name = cleanString(entry.name);
      sequence = cleanString(entry.sequence) ?? (typeof entry.sequence === 'number' ? String(entry.sequence) : null);
    } else {
      const text = cleanString(entry);
      const match = text?.match(/^(.*?)\s+#\s*([^#\s]+)$/);
      name = match ? match[1]!.trim() : text;
      sequence = match ? match[2]! : null;
    }
    if (!name || memberships.some((member) => member.seriesName.toLowerCase() === name.toLowerCase())) continue;
    memberships.push({ seriesName: name, seriesIndex: sequence });
  }
  return memberships;
}

/** Seconds in the file, milliseconds in BookOrbit, in playing order. */
function chapterList(value: unknown): NonNullable<BookDockMetadata['chapters']> {
  if (!Array.isArray(value)) return [];
  const chapters: NonNullable<BookDockMetadata['chapters']> = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const start = typeof entry.start === 'number' ? entry.start : typeof entry.start === 'string' ? Number.parseFloat(entry.start) : NaN;
    if (!Number.isFinite(start) || start < 0) continue;
    chapters.push({ title: cleanString(entry.title) ?? '', startMs: Math.round(start * 1000) });
  }
  return chapters.sort((a, b) => a.startMs - b.startMs);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
