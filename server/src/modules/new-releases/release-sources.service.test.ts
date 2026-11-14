import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithThrottle } from '../metadata-fetch/fetch-with-throttle';
import type { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import {
  belongsToTarget,
  mapAudibleProduct,
  mapHardcoverBook,
  ReleaseSourcesService,
  seriesAsinOf,
  seriesMemberAsins,
} from './release-sources.service';

vi.mock('../metadata-fetch/fetch-with-throttle', () => ({ fetchWithThrottle: vi.fn() }));

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

describe('seriesAsinOf and seriesMemberAsins', () => {
  it('finds the series id from the series list or the parent relationship', () => {
    expect(seriesAsinOf({ series: [{ asin: 'BSERIES', title: 'The Saga' }] })).toBe('BSERIES');
    expect(seriesAsinOf({ relationships: [{ asin: 'BPARENT', relationship_to_product: 'parent', relationship_type: 'series' }] })).toBe('BPARENT');
    expect(seriesAsinOf({ relationships: [{ asin: 'BCHILD', relationship_to_product: 'child', relationship_type: 'series' }] })).toBeNull();
  });

  it('lists the books of a series, last in reading order first', () => {
    expect(
      seriesMemberAsins({
        relationships: [
          { asin: 'B1', relationship_to_product: 'child', sort: '1' },
          { asin: 'B3', relationship_to_product: 'child', sort: '3' },
          { asin: 'B2', relationship_to_product: 'child', sequence: '2' },
          { asin: 'BUP', relationship_to_product: 'parent' },
        ],
      }),
    ).toEqual(['B3', 'B2', 'B1']);
  });
});

describe('ReleaseSourcesService Audible series lookup', () => {
  const fetchMock = vi.mocked(fetchWithThrottle);
  const config = {
    hardcover: { enabled: false, apiKey: '' },
    audible: { enabled: true },
    google: { enabled: false, apiKey: '' },
  };

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  function service(): ReleaseSourcesService {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const sources = new ReleaseSourcesService({ getConfig: () => Promise.resolve(config) } as unknown as ProviderConfigService);
    sources.setPaceForTesting(0);
    return sources;
  }

  afterEach(() => fetchMock.mockReset());

  it('finds a series by the Audible id of a book in the library, whatever the series is called there', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ product: { asin: 'B0OWNED', series: [{ asin: 'BSERIES', title: 'Saga, The' }] } }))
      .mockResolvedValueOnce(json({ product: { relationships: [{ asin: 'B0NEXT', relationship_to_product: 'child', sort: '5' }] } }))
      .mockResolvedValueOnce(
        json({
          products: [
            {
              asin: 'B0NEXT',
              title: 'Next',
              authors: [{ name: 'Jane Writer' }],
              release_date: '2027-03-16',
              series: [
                { asin: 'BOTHER', title: 'Omnibus', sequence: '1' },
                { asin: 'BSERIES', title: 'Saga, The', sequence: '5' },
              ],
            },
          ],
        }),
      );

    const { releases } = await service().lookup(
      { kind: 'series', name: 'The Saga', nameKey: 'thesaga', authorHint: null, audibleAsins: ['B0OWNED'] },
      '2026-11-13',
    );

    expect(releases).toEqual([expect.objectContaining({ asin: 'B0NEXT', seriesName: 'The Saga', seriesIndex: 5, date: '2027-03-16' })]);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('asins=B0NEXT');
  });

  it('falls back to a search by name when Audible has no series for the library books', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ product: { asin: 'B0OWNED' } }))
      .mockResolvedValueOnce(
        json({ products: [{ asin: 'B0S', title: 'Found', authors: [{ name: 'Jane Writer' }], series: [{ title: 'The Saga', sequence: '2' }] }] }),
      );

    const { releases } = await service().lookup(
      { kind: 'series', name: 'The Saga', nameKey: 'thesaga', authorHint: null, audibleAsins: ['B0OWNED'] },
      '2026-11-13',
    );

    expect(releases).toEqual([expect.objectContaining({ asin: 'B0S' })]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('keywords=The+Saga');
  });
});
