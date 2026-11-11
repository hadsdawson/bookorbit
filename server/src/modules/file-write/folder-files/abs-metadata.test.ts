import { buildAbsMetadata, folderCoverFiles, type AbsMetadataSource } from './abs-metadata';

const SOURCE: AbsMetadataSource = {
  title: 'The Ocean at the End of the Lane',
  subtitle: null,
  description: '<p>A novel.</p>',
  publisher: 'William Morrow',
  publishedDate: '2013-06-18',
  publishedYear: 2013,
  language: 'en',
  seriesName: 'Discworld',
  seriesIndex: '1.0',
  isbn10: '0062255657',
  isbn13: '9780062255655',
  audibleId: 'B00C5QGQ7A',
  amazonId: 'B00B7NPRY8',
  authors: [{ name: 'Neil Gaiman' }],
  narrators: ['Neil Gaiman'],
  genres: ['Fantasy'],
  tags: ['Favourites'],
  abridged: false,
  chapters: [
    { title: 'Two', startMs: 60_000 },
    { title: 'One', startMs: 0 },
  ],
  durationSeconds: 180,
};

describe('buildAbsMetadata', () => {
  it('writes the Audiobookshelf layout with chapters in seconds', () => {
    expect(buildAbsMetadata(SOURCE)).toEqual({
      tags: ['Favourites'],
      chapters: [
        { id: 0, start: 0, end: 60, title: 'One' },
        { id: 1, start: 60, end: 180, title: 'Two' },
      ],
      title: 'The Ocean at the End of the Lane',
      subtitle: null,
      authors: ['Neil Gaiman'],
      narrators: ['Neil Gaiman'],
      series: ['Discworld #1'],
      genres: ['Fantasy'],
      publishedYear: '2013',
      publishedDate: '2013-06-18',
      publisher: 'William Morrow',
      description: '<p>A novel.</p>',
      isbn: '9780062255655',
      asin: 'B00C5QGQ7A',
      language: 'en',
      explicit: false,
      abridged: false,
    });
  });

  it('keeps the field order Audiobookshelf writes', () => {
    expect(Object.keys(buildAbsMetadata(SOURCE))).toEqual([
      'tags',
      'chapters',
      'title',
      'subtitle',
      'authors',
      'narrators',
      'series',
      'genres',
      'publishedYear',
      'publishedDate',
      'publisher',
      'description',
      'isbn',
      'asin',
      'language',
      'explicit',
      'abridged',
    ]);
  });

  it('handles a book with no series, chapters or year', () => {
    const json = buildAbsMetadata({ ...SOURCE, seriesName: null, chapters: [], publishedYear: null, publishedDate: null, audibleId: null });
    expect(json.series).toEqual([]);
    expect(json.chapters).toEqual([]);
    expect(json.publishedYear).toBeNull();
    expect(json.asin).toBe('B00B7NPRY8');
  });

  it('keeps a half-numbered series entry and ends the last chapter at its start without a duration', () => {
    const json = buildAbsMetadata({ ...SOURCE, seriesIndex: '2.5', durationSeconds: null });
    expect(json.series).toEqual(['Discworld #2.5']);
    expect(json.chapters[1]).toEqual({ id: 1, start: 60, end: 60, title: 'Two' });
  });
});

describe('folderCoverFiles', () => {
  const both = new Set(['ebook', 'audio'] as const);

  it('names the audiobook cover cover.jpg and the ebook one apart when both are written', () => {
    expect(folderCoverFiles('both', both)).toEqual([
      { medium: 'audio', name: 'cover.jpg' },
      { medium: 'ebook', name: 'cover-ebook.jpg' },
    ]);
  });

  it('uses cover.jpg for a single cover, whichever it is', () => {
    expect(folderCoverFiles('ebook', both)).toEqual([{ medium: 'ebook', name: 'cover.jpg' }]);
    expect(folderCoverFiles('audiobook', both)).toEqual([{ medium: 'audio', name: 'cover.jpg' }]);
    expect(folderCoverFiles('both', new Set(['ebook'] as const))).toEqual([{ medium: 'ebook', name: 'cover.jpg' }]);
  });

  it('writes nothing when the book lacks the cover asked for, or covers are off', () => {
    expect(folderCoverFiles('audiobook', new Set(['ebook'] as const))).toEqual([]);
    expect(folderCoverFiles('off', both)).toEqual([]);
  });
});
