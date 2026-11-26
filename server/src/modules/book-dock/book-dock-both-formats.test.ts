import { mergeFormatLookups } from './book-dock-both-formats';

const ebook = {
  metadata: { title: 'Dune', publisher: 'Ace', pageCount: 604, coverUrl: 'https://google/dune.jpg' },
  sources: { title: 'google', publisher: 'google', pageCount: 'google', coverUrl: 'google' },
};
const audio = {
  metadata: {
    title: 'Dune (Unabridged)',
    publisher: 'Macmillan Audio',
    narrators: ['Scott Brick'],
    durationSeconds: 75600,
    chapters: [{ title: 'One', startMs: 0 }],
    coverUrl: 'https://audible/dune.jpg',
  },
  sources: { title: 'audible', publisher: 'audible', narrators: 'audible', durationSeconds: 'audible', chapters: 'audible', coverUrl: 'audible' },
};

describe('mergeFormatLookups', () => {
  it('keeps the ebook for shared fields and the audiobook cover and chapters for an audio file', () => {
    const { metadata, sources } = mergeFormatLookups(ebook, audio, 'audio');

    expect(metadata).toEqual({
      title: 'Dune',
      publisher: 'Ace',
      pageCount: 604,
      narrators: ['Scott Brick'],
      durationSeconds: 75600,
      chapters: [{ title: 'One', startMs: 0 }],
      coverUrl: 'https://audible/dune.jpg',
      otherFormatCoverUrl: 'https://google/dune.jpg',
    });
    expect(sources).toMatchObject({ title: 'google', narrators: 'audible', coverUrl: 'audible', otherFormatCoverUrl: 'google' });
  });

  it('leaves chapters out for an ebook file', () => {
    expect(mergeFormatLookups(ebook, audio, 'ebook').metadata.chapters).toBeUndefined();
  });

  it('uses the audiobook answer whole when the ebook lookup found nothing', () => {
    const { metadata } = mergeFormatLookups({ metadata: {}, sources: {} }, audio, 'audio');
    expect(metadata).toMatchObject({ title: 'Dune (Unabridged)', publisher: 'Macmillan Audio', coverUrl: 'https://audible/dune.jpg' });
    expect(metadata.otherFormatCoverUrl).toBeUndefined();
  });

  it('returns nothing when neither lookup found anything', () => {
    expect(mergeFormatLookups({ metadata: {}, sources: {} }, { metadata: {}, sources: {} }, 'ebook')).toEqual({ metadata: {}, sources: {} });
  });

  it('takes the series name and number together from the other format when the ebook has no series', () => {
    const withIndexOnly = { metadata: { ...ebook.metadata, seriesIndex: '4' }, sources: { ...ebook.sources, seriesIndex: 'goodreads' } };
    const withSeries = {
      metadata: { ...audio.metadata, seriesName: 'Dune Chronicles', seriesIndex: '1' },
      sources: { ...audio.sources, seriesName: 'audible', seriesIndex: 'audible' },
    };

    const { metadata, sources } = mergeFormatLookups(withIndexOnly, withSeries, 'audio');

    expect(metadata.seriesName).toBe('Dune Chronicles');
    expect(metadata.seriesIndex).toBe('1');
    expect(sources.seriesIndex).toBe('audible');
  });

  it('does not borrow a number from a different series', () => {
    const named = { metadata: { ...ebook.metadata, seriesName: 'Dune Chronicles' }, sources: { ...ebook.sources, seriesName: 'goodreads' } };
    const other = { metadata: { ...audio.metadata, seriesName: 'Great Sci-Fi', seriesIndex: '7' }, sources: audio.sources };

    const { metadata } = mergeFormatLookups(named, other, 'audio');

    expect(metadata.seriesName).toBe('Dune Chronicles');
    expect(metadata.seriesIndex).toBeUndefined();
  });

  it('drops a series number that has no series name', () => {
    const indexOnly = { metadata: { ...ebook.metadata, seriesIndex: '4' }, sources: { ...ebook.sources, seriesIndex: 'goodreads' } };

    const { metadata, sources } = mergeFormatLookups(indexOnly, audio, 'audio');

    expect(metadata.seriesIndex).toBeUndefined();
    expect(sources.seriesIndex).toBeUndefined();
  });
});
