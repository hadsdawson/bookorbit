import { describe, expect, it } from 'vitest';

import { computeConfidenceBreakdown } from './book-dock-ingest.service';

describe('computeConfidenceBreakdown', () => {
  it('lets a matching ISBN-13 decide the score outright', () => {
    expect(computeConfidenceBreakdown({ isbn13: '9780441013593' }, { isbn13: '978-0-441-01359-3' })).toEqual({
      kind: 'isbn',
      match: 'isbn13',
      score: 95,
    });
  });

  it('scores conflicting ISBNs as almost certainly the wrong book', () => {
    expect(computeConfidenceBreakdown({ isbn13: '9780441013593' }, { isbn13: '9780000000002' })).toMatchObject({
      kind: 'isbn',
      match: 'conflict',
      score: 10,
    });
  });

  it('shows the points per field and which fields had nothing to compare', () => {
    const breakdown = computeConfidenceBreakdown(
      { title: 'Dune', authors: ['Herbert, Frank'] },
      { title: 'Dune', authors: ['Frank Herbert'], publishedYear: 1965, seriesName: 'Dune' },
    );

    expect(breakdown).toEqual({
      kind: 'fields',
      score: 85,
      parts: [
        { field: 'title', points: 55, max: 55, compared: true },
        { field: 'authors', points: 30, max: 30, compared: true },
        { field: 'year', points: 0, max: 10, compared: false },
        { field: 'series', points: 0, max: 5, compared: false },
      ],
    });
  });

  it('adds up to the score for a partial match', () => {
    const breakdown = computeConfidenceBreakdown(
      { title: 'The Way of Kings', authors: ['Brandon Sanderson'], publishedYear: 2010, seriesName: 'Stormlight Archive' },
      { title: 'Way of Kings Prime', authors: ['Brandon Sanderson'], publishedYear: 2016, seriesName: 'The Stormlight Archive' },
    );

    expect(breakdown.kind).toBe('fields');
    if (breakdown.kind !== 'fields') return;
    expect(breakdown.parts.reduce((total, part) => total + part.points, 0)).toBe(breakdown.score);
    expect(breakdown.parts.find((part) => part.field === 'year')).toEqual({ field: 'year', points: 0, max: 10, compared: true });
  });
});
