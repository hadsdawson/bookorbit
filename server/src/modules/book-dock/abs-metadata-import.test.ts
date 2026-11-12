import { isAbsMetadataFile, parseAbsMetadataJson, pickAbsCoverFile } from './abs-metadata-import';

const absJson = {
  tags: ['Owned', 'Favorites'],
  chapters: [
    { id: 1, start: 754.25, end: 1500, title: 'Chapter 2' },
    { id: 0, start: 0, end: 754.25, title: 'Chapter 1' },
  ],
  title: 'The Way of Kings',
  subtitle: 'Book One',
  authors: ['Brandon Sanderson'],
  narrators: ['Michael Kramer', 'Kate Reading'],
  series: ['The Stormlight Archive #1', 'Cosmere'],
  genres: ['Fantasy', 'Epic Fantasy'],
  publishedYear: '2010',
  publishedDate: '2010-08-31',
  publisher: 'Macmillan Audio',
  description: 'Roshar is a world of stone and storms.',
  isbn: '978-0-7653-2635-5',
  asin: 'B003ZWFO7E',
  language: 'English',
  explicit: false,
  abridged: false,
};

describe('parseAbsMetadataJson', () => {
  it('maps every Audiobookshelf field for an audiobook', () => {
    expect(parseAbsMetadataJson(JSON.stringify(absJson), { audio: true })).toEqual({
      title: 'The Way of Kings',
      subtitle: 'Book One',
      description: 'Roshar is a world of stone and storms.',
      publisher: 'Macmillan Audio',
      language: 'English',
      authors: ['Brandon Sanderson'],
      narrators: ['Michael Kramer', 'Kate Reading'],
      genres: ['Fantasy', 'Epic Fantasy'],
      tags: ['Owned', 'Favorites'],
      publishedDate: '2010-08-31',
      publishedYear: 2010,
      isbn13: '9780765326355',
      audibleId: 'B003ZWFO7E',
      seriesName: 'The Stormlight Archive',
      seriesIndex: '1',
      seriesMemberships: [
        { seriesName: 'The Stormlight Archive', seriesIndex: '1' },
        { seriesName: 'Cosmere', seriesIndex: null },
      ],
      abridged: false,
      chapters: [
        { title: 'Chapter 1', startMs: 0 },
        { title: 'Chapter 2', startMs: 754250 },
      ],
    });
  });

  it('treats the ASIN as an Amazon id and skips chapters for an ebook', () => {
    const meta = parseAbsMetadataJson(JSON.stringify(absJson), { audio: false });
    expect(meta?.amazonId).toBe('B003ZWFO7E');
    expect(meta?.audibleId).toBeUndefined();
    expect(meta?.chapters).toBeUndefined();
  });

  it('leaves out empty fields so they never blank another value', () => {
    const meta = parseAbsMetadataJson(
      JSON.stringify({ title: '  ', subtitle: null, authors: [], genres: ['', 'Mystery', 'mystery'], isbn: 'n/a', publishedYear: null }),
      { audio: true },
    );
    expect(meta).toEqual({ genres: ['Mystery'] });
  });

  it('reads older object shapes and a year with no date', () => {
    const meta = parseAbsMetadataJson(
      JSON.stringify({
        authors: [{ name: 'Ann Leckie' }],
        series: [{ name: 'Imperial Radch', sequence: 2 }],
        publishedYear: 2014,
        isbn: '0316246654',
      }),
      { audio: true },
    );
    expect(meta).toEqual({
      authors: ['Ann Leckie'],
      publishedYear: 2014,
      isbn10: '0316246654',
      seriesName: 'Imperial Radch',
      seriesIndex: '2',
      seriesMemberships: [{ seriesName: 'Imperial Radch', seriesIndex: '2' }],
    });
  });

  it('returns null for text that is not a JSON object', () => {
    expect(parseAbsMetadataJson('not json', { audio: true })).toBeNull();
    expect(parseAbsMetadataJson('[1,2]', { audio: true })).toBeNull();
  });
});

describe('isAbsMetadataFile', () => {
  it('matches the file name in any case and nothing else', () => {
    expect(isAbsMetadataFile('/books/Book/Metadata.JSON')).toBe(true);
    expect(isAbsMetadataFile('book.opf')).toBe(false);
    expect(isAbsMetadataFile('other-metadata.json')).toBe(false);
  });
});

describe('pickAbsCoverFile', () => {
  it('prefers cover.* over other images', () => {
    expect(pickAbsCoverFile([{ fileName: 'folder.jpg' }, { fileName: 'cover.png' }])).toEqual({ fileName: 'cover.png' });
    expect(pickAbsCoverFile([{ fileName: 'art.jpg' }])).toEqual({ fileName: 'art.jpg' });
    expect(pickAbsCoverFile([])).toBeNull();
  });
});
