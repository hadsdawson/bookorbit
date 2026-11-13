import { describe, expect, it } from 'vitest';

import { belongsToTarget, mapAudibleProduct, mapHardcoverBook } from './release-sources.service';

describe('mapHardcoverBook', () => {
  it('reports the ebook and, when it has an audio edition, the audiobook', () => {
    const releases = mapHardcoverBook({
      id: 7,
      title: 'Next',
      release_date: '2027-03-09',
      contributions: [{ author: { name: 'Jane Writer' } }],
      book_series: [{ position: 4, series: { name: 'The Saga' } }],
      editions: [
        { reading_format_id: 4, release_date: '2027-03-09', isbn_13: '9781234567897' },
        { reading_format_id: 2, release_date: '2027-03-16', asin: 'B0AUDIO' },
      ],
    });
    expect(releases).toHaveLength(2);
    expect(releases[0]).toMatchObject({ mediaKind: 'ebook', date: '2027-03-09', seriesName: 'The Saga', seriesIndex: 4, isbn13: '9781234567897' });
    expect(releases[1]).toMatchObject({ mediaKind: 'audiobook', date: '2027-03-16', asin: 'B0AUDIO' });
  });
});

describe('belongsToTarget', () => {
  const release = mapAudibleProduct({
    asin: 'B0',
    title: 'Next',
    authors: [{ name: 'Jane Writer' }],
    release_date: '2027-03-16',
    series: [{ title: 'The Saga', sequence: '4' }],
  });

  it('matches an author follow by name, ignoring case and accents', () => {
    expect(belongsToTarget(release, { kind: 'author', name: 'jane writer', nameKey: 'janewriter', authorHint: null })).toBe(true);
    expect(belongsToTarget(release, { kind: 'author', name: 'Other', nameKey: 'other', authorHint: null })).toBe(false);
  });

  it('matches a series follow only by that series and, when known, its author', () => {
    expect(belongsToTarget(release, { kind: 'series', name: 'The Saga', nameKey: 'thesaga', authorHint: 'Jane Writer' })).toBe(true);
    expect(belongsToTarget(release, { kind: 'series', name: 'The Saga', nameKey: 'thesaga', authorHint: 'Someone Else' })).toBe(false);
    expect(belongsToTarget(release, { kind: 'series', name: 'Another', nameKey: 'another', authorHint: null })).toBe(false);
  });
});
