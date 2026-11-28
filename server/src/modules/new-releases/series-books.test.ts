import { describe, expect, it } from 'vitest';

import type { SourceRelease } from './release-merge';
import { matchesLanguage, toSeriesBooks } from './series-books';
import { bookStatus } from './series-books.service';

const TODAY = '2026-11-28';
const ANY = { language: null, strict: false };

function report(overrides: Partial<SourceRelease> = {}): SourceRelease {
  return {
    source: 'hardcover',
    sourceId: '1:ebook',
    mediaKind: 'ebook',
    title: 'Book One',
    authors: ['Jessica Cage'],
    seriesName: 'Accidents Happen',
    seriesIndex: 1,
    coverUrl: null,
    isbn13: null,
    asin: null,
    date: '2024-02-01',
    ...overrides,
  };
}

describe('toSeriesBooks', () => {
  it('keeps books already out, with the date each came out, in reading order', () => {
    const rows = toSeriesBooks(
      [
        report({ sourceId: '3:ebook', title: 'Book Three', seriesIndex: 3, date: '2027-05-04' }),
        report({ sourceId: '1:ebook', title: 'Book One', seriesIndex: 1, date: '2024-02-01' }),
        report({ sourceId: '2:ebook', title: 'Book Two', seriesIndex: 2, date: '2025-06-10' }),
      ],
      TODAY,
      ANY,
    );

    expect(rows.map((row) => row.title)).toEqual(['Book One', 'Book Two', 'Book Three']);
    expect(rows[0]).toMatchObject({ releasedOn: '2024-02-01', comingOn: null, comingSoon: false, ebookDate: '2024-02-01' });
    expect(rows[2]).toMatchObject({ releasedOn: null, comingOn: '2027-05-04', comingSoon: true, ebookDate: '2027-05-04' });
  });

  it('folds the same book from two sites into one row and leaves box sets out', () => {
    const rows = toSeriesBooks(
      [
        report(),
        report({ source: 'audible', sourceId: 'B01', mediaKind: 'audiobook', asin: 'B01', date: '2024-03-01' }),
        report({ sourceId: '9:ebook', title: 'Accidents Happen Box Set', seriesIndex: null }),
      ],
      TODAY,
      ANY,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Book One', ebookDate: '2024-02-01', audiobookDate: '2024-03-01', asin: 'B01' });
  });

  it('puts books with no place in the series last', () => {
    const rows = toSeriesBooks(
      [report({ sourceId: '5:ebook', title: 'A Novella', seriesIndex: null }), report({ sourceId: '2:ebook', title: 'Book Two', seriesIndex: 2 })],
      TODAY,
      ANY,
    );
    expect(rows.map((row) => row.title)).toEqual(['Book Two', 'A Novella']);
  });
});

describe('matchesLanguage', () => {
  it('drops a book a source says is in another language, and keeps one no source names a language for', () => {
    expect(matchesLanguage([report({ language: 'de' })], 'en', false)).toBe(false);
    expect(matchesLanguage([report({ language: 'en' })], 'en', false)).toBe(true);
    expect(matchesLanguage([report()], 'en', false)).toBe(true);
    expect(matchesLanguage([report()], 'en', true)).toBe(false);
    expect(matchesLanguage([report({ language: 'de' })], null, false)).toBe(true);
  });
});

describe('bookStatus', () => {
  const none = { ownedBookId: null, existingRequestId: null, existingRequestStatus: null, alreadySubscribed: false };

  it('is owned when every format is in the library', () => {
    expect(
      bookStatus(
        ['ebook', 'audiobook'],
        [
          { ...none, ownedBookId: 4 },
          { ...none, ownedBookId: 4 },
        ],
      ),
    ).toMatchObject({
      status: 'owned',
      missingFormats: [],
      ownedBookId: 4,
    });
  });

  it('is requested when the formats not owned are requested', () => {
    expect(
      bookStatus(
        ['ebook', 'audiobook'],
        [
          { ...none, ownedBookId: 4 },
          { ...none, existingRequestId: 9 },
        ],
      ),
    ).toMatchObject({
      status: 'requested',
      requestId: 9,
    });
  });

  it('is missing, naming the formats still to request, otherwise', () => {
    expect(bookStatus(['ebook', 'audiobook'], [{ ...none, ownedBookId: 4 }, none])).toMatchObject({
      status: 'missing',
      missingFormats: ['audiobook'],
    });
    expect(bookStatus(['ebook'], [undefined])).toMatchObject({ status: 'missing', missingFormats: ['ebook'] });
  });
});
