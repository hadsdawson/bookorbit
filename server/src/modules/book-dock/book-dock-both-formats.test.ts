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
});
