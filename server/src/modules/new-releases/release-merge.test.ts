import { describe, expect, it } from 'vitest';

import { confirmedDate, fullDate, isNewBookTitle, mergeReleases, workKeyFor, type SourceRelease } from './release-merge';

const TODAY = '2026-11-13';

function report(overrides: Partial<SourceRelease> = {}): SourceRelease {
  return {
    source: 'hardcover',
    sourceId: '1',
    mediaKind: 'ebook',
    title: 'The Next Book',
    authors: ['Jane Writer'],
    seriesName: null,
    seriesIndex: null,
    coverUrl: null,
    isbn13: null,
    asin: null,
    date: '2027-03-09',
    ...overrides,
  };
}

describe('fullDate', () => {
  it('keeps a real full date and drops vaguer or impossible ones', () => {
    expect(fullDate('2027-03-09')).toBe('2027-03-09');
    expect(fullDate('2027-03-09T00:00:00Z')).toBe('2027-03-09');
    expect(fullDate('2027')).toBeNull();
    expect(fullDate('2027-03')).toBeNull();
    expect(fullDate('2027-02-30')).toBeNull();
    expect(fullDate(null)).toBeNull();
  });
});

describe('confirmedDate', () => {
  it('accepts one source date that is ahead and ordinary', () => {
    expect(confirmedDate([report()], TODAY)).toBe('2027-03-09');
  });

  it('drops dates already past, today, or more than three years out', () => {
    expect(confirmedDate([report({ date: '2026-11-13' })], TODAY)).toBeNull();
    expect(confirmedDate([report({ date: '2026-01-05' })], TODAY)).toBeNull();
    expect(confirmedDate([report({ date: '2900-01-01' })], TODAY)).toBeNull();
    expect(confirmedDate([report({ date: '2029-11-14' })], TODAY)).toBeNull();
  });

  it('holds a 1 January or 31 December date until a second source agrees', () => {
    expect(confirmedDate([report({ date: '2027-01-01' })], TODAY)).toBeNull();
    expect(confirmedDate([report({ date: '2027-12-31' })], TODAY)).toBeNull();
    expect(confirmedDate([report({ date: '2027-01-01' }), report({ source: 'audible', sourceId: 'B0', date: '2027-01-01' })], TODAY)).toBe(
      '2027-01-01',
    );
  });

  it('holds a date two sources disagree on', () => {
    expect(confirmedDate([report(), report({ source: 'google', sourceId: 'g', date: '2027-04-01' })], TODAY)).toBeNull();
  });

  it('confirms the date two sources share even when a third differs', () => {
    expect(
      confirmedDate(
        [report(), report({ source: 'audible', sourceId: 'a', date: '2027-03-09' }), report({ source: 'google', sourceId: 'g', date: '2027-05-01' })],
        TODAY,
      ),
    ).toBe('2027-03-09');
  });
});

describe('mergeReleases', () => {
  it('folds the ebook and audiobook of one book into one row with both dates', () => {
    const [merged] = mergeReleases(
      [
        report({ title: 'The Next Book: A Novel' }),
        report({ source: 'audible', sourceId: 'B0', mediaKind: 'audiobook', title: 'The Next Book', date: '2027-03-16', asin: 'B0' }),
      ],
      TODAY,
    );
    expect(merged).toMatchObject({ ebookDate: '2027-03-09', audiobookDate: '2027-03-16', releaseDate: '2027-03-09', asin: 'B0' });
  });

  it('leaves out box sets and collections', () => {
    expect(mergeReleases([report({ title: 'The Saga Box Set' }), report({ title: 'Books 1-3' })], TODAY)).toEqual([]);
    expect(isNewBookTitle('The Next Book')).toBe(true);
  });

  it('keys a work by bare title and first author', () => {
    expect(workKeyFor('The Next Book (Saga, #4): A Novel', ['Jane Writer'])).toBe(workKeyFor('The Next Book', ['Jane Writer']));
  });
});
