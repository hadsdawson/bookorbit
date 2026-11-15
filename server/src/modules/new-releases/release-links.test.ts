import { describe, expect, it } from 'vitest';

import { providerIdsOf } from './new-releases.service';
import { mapAudibleProduct, mapGoogleVolume, mapHardcoverBook } from './release-sources.service';

describe('release languages and links (fork)', () => {
  it('reads the language each source states', () => {
    expect(mapAudibleProduct({ asin: 'B0F', title: 'Le masque de la peur', language: 'french' }).language).toBe('fr');
    expect(mapGoogleVolume({ id: 'g1', volumeInfo: { title: 'Book', language: 'en' } }, null).language).toBe('en');
    const [ebook] = mapHardcoverBook({
      id: 7,
      slug: 'the-book',
      title: 'The Book',
      editions: [{ reading_format_id: 4, release_date: '2026-12-01', language: { code2: 'en' } }],
    });
    expect(ebook).toEqual(expect.objectContaining({ language: 'en', slug: 'the-book' }));
  });

  it('gathers the page ids of the sites that reported a release', () => {
    expect(
      providerIdsOf([
        { source: 'hardcover', sourceId: '7:ebook', mediaKind: 'ebook', slug: 'the-book', asin: 'B0EBOOK' },
        { source: 'audible', sourceId: 'B0AUDIO', mediaKind: 'audiobook' },
        { source: 'google', sourceId: 'gid', mediaKind: 'ebook' },
      ]),
    ).toEqual({ hardcover: 'the-book', amazon: 'B0EBOOK', audible: 'B0AUDIO', google: 'gid' });
    expect(providerIdsOf(null)).toEqual({});
  });
});
