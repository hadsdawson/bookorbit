import { describe, expect, it } from 'vitest';

import type { UpcomingReleaseRow } from './new-releases.repository';
import { formatsToRequest, requestFor } from './release-request';

function release(overrides: Partial<UpcomingReleaseRow> = {}): UpcomingReleaseRow {
  return {
    id: 1,
    workKey: 'next|janewriter',
    title: 'Next',
    authors: ['Jane Writer'],
    authorKeys: ['janewriter'],
    seriesName: 'The Saga',
    seriesKey: 'thesaga',
    seriesIndex: 4,
    coverUrl: 'https://img.example/next.jpg',
    isbn13: '9781234567897',
    asin: null,
    ebookDate: '2027-03-09',
    audiobookDate: '2027-03-16',
    releaseDate: '2027-03-09',
    sources: [{ source: 'audible', sourceId: 'B0', mediaKind: 'audiobook', asin: 'B0AUDIO' }],
    ownedBookId: null,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

describe('formatsToRequest', () => {
  it('requests the server default format', () => {
    expect(formatsToRequest('both')).toEqual(['ebook', 'audiobook']);
    expect(formatsToRequest('audiobook')).toEqual(['audiobook']);
    expect(formatsToRequest('ebook')).toEqual(['ebook']);
  });
});

describe('requestFor', () => {
  it('fills a request the way the request form does, with the format date', () => {
    expect(requestFor(release(), 'ebook')).toMatchObject({
      mediaKind: 'ebook',
      title: 'Next',
      authors: ['Jane Writer'],
      seriesName: 'The Saga',
      seriesIndex: 4,
      isbn13: '9781234567897',
      publishedDate: '2027-03-09',
      publishedYear: 2027,
      note: 'Requested from New Releases',
    });
  });

  it('names the Audible edition for an audiobook and leaves out a fractional series number', () => {
    const dto = requestFor(release({ seriesIndex: 4.5 }), 'audiobook');
    expect(dto).toMatchObject({ mediaKind: 'audiobook', publishedDate: '2027-03-16', providerKey: 'audible', providerId: 'B0AUDIO' });
    expect(dto.seriesIndex).toBeUndefined();
    expect(dto.isbn13).toBeUndefined();
  });
});
