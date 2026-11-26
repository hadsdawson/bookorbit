import { DEFAULT_METADATA_SCORE_WEIGHTS, type MetadataScoreWeights } from '@bookorbit/types';

import { MetadataScoreScorer, type ScoreData } from './metadata-score.scorer';

function makeData(overrides: Partial<ScoreData> = {}): ScoreData {
  return {
    title: null,
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    editionName: null,
    originalPublishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    coverSource: null,
    googleBooksId: null,
    goodreadsId: null,
    amazonId: null,
    hardcoverId: null,
    openLibraryId: null,
    itunesId: null,
    koboId: null,
    aladinId: null,
    authorCount: 0,
    genreCount: 0,
    tagCount: 0,
    chapterCount: 0,
    numberedChapterCount: 0,
    chaptersSource: null,
    hasM4b: false,
    ...overrides,
  };
}

describe('MetadataScoreScorer', () => {
  const scorer = new MetadataScoreScorer();

  describe('edition name and first published', () => {
    const only = (fields: Partial<MetadataScoreWeights>): MetadataScoreWeights =>
      ({ ...Object.fromEntries(Object.keys(DEFAULT_METADATA_SCORE_WEIGHTS).map((key) => [key, 0])), ...fields }) as MetadataScoreWeights;

    it('are off by default, so existing scores do not change', () => {
      expect(DEFAULT_METADATA_SCORE_WEIGHTS.editionName).toBe(0);
      expect(DEFAULT_METADATA_SCORE_WEIGHTS.originalPublishedYear).toBe(0);
      expect(scorer.compute(makeData({ title: 'Infinite Wisdom' }), { ...DEFAULT_METADATA_SCORE_WEIGHTS, title: 10 })).toBe(
        scorer.compute(makeData({ title: 'Infinite Wisdom', editionName: 'Full Cast', originalPublishedYear: 1999 }), {
          ...DEFAULT_METADATA_SCORE_WEIGHTS,
          title: 10,
        }),
      );
    });

    it('count toward the score once given a weight', () => {
      const weights = only({ title: 10, editionName: 5, originalPublishedYear: 5 });
      expect(scorer.compute(makeData({ title: 'Infinite Wisdom' }), weights)).toBe(50);
      expect(scorer.compute(makeData({ title: 'Infinite Wisdom', editionName: 'Full Cast' }), weights)).toBe(75);
      expect(scorer.compute(makeData({ title: 'Infinite Wisdom', editionName: 'Full Cast', originalPublishedYear: 1999 }), weights)).toBe(100);
    });

    it('do not count a blank edition name or a zero year', () => {
      const weights = only({ editionName: 5, originalPublishedYear: 5 });
      expect(scorer.compute(makeData({ editionName: '   ', originalPublishedYear: 0 }), weights)).toBe(0);
    });
  });

  describe('audiobook chapters', () => {
    const weights = (chapters: number): MetadataScoreWeights =>
      ({
        ...Object.fromEntries(Object.keys(DEFAULT_METADATA_SCORE_WEIGHTS).map((key) => [key, 0])),
        title: 10,
        audiobookChapters: chapters,
      }) as MetadataScoreWeights;

    it('is off by default', () => {
      expect(DEFAULT_METADATA_SCORE_WEIGHTS.audiobookChapters).toBe(0);
    });

    it('never marks down a book without an M4B file', () => {
      expect(scorer.compute(makeData({ title: 'Dune', hasM4b: false }), weights(10))).toBe(100);
    });

    it('marks down an M4B book with no chapters, or only numbered tracks', () => {
      expect(scorer.compute(makeData({ title: 'Dune', hasM4b: true, chapterCount: 0 }), weights(10))).toBe(50);
      expect(scorer.compute(makeData({ title: 'Dune', hasM4b: true, chapterCount: 1 }), weights(10))).toBe(50);
      expect(scorer.compute(makeData({ title: 'Dune', hasM4b: true, chapterCount: 20, numberedChapterCount: 20 }), weights(10))).toBe(50);
    });

    it('counts real chapters on an M4B book', () => {
      expect(scorer.compute(makeData({ title: 'Dune', hasM4b: true, chapterCount: 20, numberedChapterCount: 2 }), weights(10))).toBe(100);
    });

    it('counts a numbered chapter list that a person edited, a provider supplied or an import brought in', () => {
      for (const chaptersSource of ['manual', 'provider', 'migration']) {
        expect(
          scorer.compute(makeData({ title: 'Dune', hasM4b: true, chapterCount: 41, numberedChapterCount: 39, chaptersSource }), weights(10)),
        ).toBe(100);
      }
      expect(
        scorer.compute(
          makeData({ title: 'Dune', hasM4b: true, chapterCount: 41, numberedChapterCount: 39, chaptersSource: 'embedded' }),
          weights(10),
        ),
      ).toBe(50);
      expect(scorer.compute(makeData({ title: 'Dune', hasM4b: true, chapterCount: 1, chaptersSource: 'manual' }), weights(10))).toBe(50);
    });
  });

  it('returns 0 when total weight is zero', () => {
    const zeroWeights = Object.fromEntries(Object.keys(DEFAULT_METADATA_SCORE_WEIGHTS).map((key) => [key, 0])) as MetadataScoreWeights;

    expect(scorer.compute(makeData({ title: 'Dune' }), zeroWeights)).toBe(0);
  });

  it('treats whitespace-only strings as missing values', () => {
    const data = makeData({ title: '   ' });

    expect(scorer.compute(data, DEFAULT_METADATA_SCORE_WEIGHTS)).toBe(0);
  });

  it('awards points for counts and positive numeric values only', () => {
    const data = makeData({
      authorCount: 1,
      genreCount: 2,
      tagCount: 3,
      publishedYear: 2020,
      pageCount: 450,
      rating: 4.5,
      seriesIndex: '1',
    });
    const weights: MetadataScoreWeights = {
      ...DEFAULT_METADATA_SCORE_WEIGHTS,
      authors: 10,
      genres: 10,
      tags: 10,
      publishedYear: 10,
      pageCount: 10,
      rating: 10,
      seriesIndex: 10,
      title: 0,
      subtitle: 0,
      description: 0,
      coverSource: 0,
      isbn13: 0,
      publisher: 0,
      language: 0,
      isbn10: 0,
      seriesName: 0,
      googleBooksId: 0,
      goodreadsId: 0,
      amazonId: 0,
      hardcoverId: 0,
      openLibraryId: 0,
      itunesId: 0,
      koboId: 0,
      aladinId: 0,
    };

    expect(scorer.compute(data, weights)).toBe(100);
    expect(scorer.compute(makeData({ publishedYear: 0, pageCount: -1, rating: 0 }), weights)).toBe(0);
  });

  it('ignores non-finite and non-positive weights while computing total', () => {
    const weights: MetadataScoreWeights = {
      ...DEFAULT_METADATA_SCORE_WEIGHTS,
      title: Number.NaN,
      authors: -5,
      coverSource: 10,
      description: 0,
      subtitle: 0,
      genres: 0,
      isbn13: 0,
      publisher: 0,
      publishedYear: 0,
      language: 0,
      isbn10: 0,
      pageCount: 0,
      rating: 0,
      seriesName: 0,
      seriesIndex: 0,
      tags: 0,
      googleBooksId: 0,
      goodreadsId: 0,
      amazonId: 0,
      hardcoverId: 0,
      openLibraryId: 0,
      itunesId: 0,
      koboId: 0,
      aladinId: 0,
    };

    expect(scorer.compute(makeData({ title: 'Dune', coverSource: 'extracted', authorCount: 10 }), weights)).toBe(100);
  });
});
