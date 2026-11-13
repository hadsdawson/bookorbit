import { Injectable, Logger } from '@nestjs/common';
import type { NewReleaseSourceStatus, ReleaseFollowKind } from '@bookorbit/types';

import { toBearerAuthorization } from '../../common/utils/bearer-token.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { fetchWithThrottle } from '../metadata-fetch/fetch-with-throttle';
import { buildRequestSignal, sanitizeLogError, sleep } from '../metadata-fetch/providers/provider-utils';
import { PROVIDER_TIMEOUT_MS } from '../metadata-fetch/providers/provider-constants';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { nameKey, type ReleaseSourceKey, type SourceRelease } from './release-merge';

/** One followed name to look up. Shared by everyone who follows it. */
export interface ReleaseTarget {
  kind: ReleaseFollowKind;
  name: string;
  nameKey: string;
  /** For a series, the author it was followed under. */
  authorHint: string | null;
}

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
/** New Releases is US only, whatever store the metadata settings point Audible at. */
const AUDIBLE_US_PRODUCTS = 'https://api.audible.com/1.0/catalog/products';
const GOOGLE_VOLUMES = 'https://www.googleapis.com/books/v1/volumes';

// Hardcover reading_format_id: 1 = physical, 2 = audiobook, 4 = ebook.
const HARDCOVER_AUDIOBOOK_FORMAT = 2;
const HARDCOVER_EBOOK_FORMAT = 4;

/** Waited between two calls to book sites, so following many names never floods one. */
export const SOURCE_PACE_MS = 3_000;

const HARDCOVER_UPCOMING_QUERY = `
  query UpcomingBooks($where: books_bool_exp!) {
    books(where: $where, order_by: { release_date: asc }, limit: 40) {
      id
      title
      release_date
      image { url }
      contributions { author { name } }
      book_series { position series { name } }
      editions(limit: 25) { isbn_13 asin release_date reading_format_id }
    }
  }
`;

interface HardcoverUpcomingBook {
  id: number;
  title: string;
  release_date?: string | null;
  image?: { url?: string | null } | null;
  contributions?: { author?: { name?: string | null } | null }[];
  book_series?: { position?: number | null; series?: { name?: string | null } | null }[];
  editions?: { isbn_13?: string | null; asin?: string | null; release_date?: string | null; reading_format_id?: number | null }[];
}

interface AudibleUpcomingProduct {
  asin: string;
  title: string;
  authors?: { name: string }[];
  release_date?: string;
  product_images?: { 500?: string };
  series?: { title: string; sequence?: string }[];
}

interface GoogleUpcomingVolume {
  id: string;
  volumeInfo: {
    title: string;
    authors?: string[];
    publishedDate?: string;
    imageLinks?: { thumbnail?: string };
    industryIdentifiers?: { type: string; identifier: string }[];
  };
}

function numberOrNull(value: string | number | null | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function earliest(dates: (string | null | undefined)[]): string | null {
  return dates.filter((date): date is string => typeof date === 'string' && date.length >= 10).sort()[0] ?? null;
}

function httpsCover(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^http:\/\//, 'https://');
}

/** Whether a name a source gave is the followed one, ignoring case, accents and punctuation. */
function sameName(candidate: string | null | undefined, key: string): boolean {
  return !!candidate && nameKey(candidate) === key;
}

export function mapHardcoverBook(book: HardcoverUpcomingBook): SourceRelease[] {
  const authors = (book.contributions ?? []).map((entry) => entry.author?.name?.trim() ?? '').filter(Boolean);
  const series = (book.book_series ?? []).find((entry) => entry.series?.name);
  const editions = book.editions ?? [];
  const isbn13 = editions.find((edition) => edition.isbn_13)?.isbn_13 ?? null;
  const base = {
    source: 'hardcover' as const,
    title: book.title,
    authors: [...new Set(authors)],
    seriesName: series?.series?.name ?? null,
    seriesIndex: numberOrNull(series?.position),
    coverUrl: httpsCover(book.image?.url),
    isbn13,
  };

  const audio = editions.filter((edition) => edition.reading_format_id === HARDCOVER_AUDIOBOOK_FORMAT);
  const ebook = editions.filter((edition) => edition.reading_format_id === HARDCOVER_EBOOK_FORMAT);
  const releases: SourceRelease[] = [
    {
      ...base,
      sourceId: `${book.id}:ebook`,
      mediaKind: 'ebook',
      asin: ebook.find((edition) => edition.asin)?.asin ?? null,
      // The book's own date is its first edition's, which for a new book is the ebook or print one.
      date: earliest(ebook.map((edition) => edition.release_date)) ?? book.release_date ?? null,
    },
  ];
  const audioDate = earliest(audio.map((edition) => edition.release_date));
  if (audioDate) {
    releases.push({
      ...base,
      sourceId: `${book.id}:audiobook`,
      mediaKind: 'audiobook',
      asin: audio.find((edition) => edition.asin)?.asin ?? null,
      date: audioDate,
    });
  }
  return releases;
}

export function mapAudibleProduct(product: AudibleUpcomingProduct): SourceRelease {
  const series = product.series?.[0];
  return {
    source: 'audible',
    sourceId: product.asin,
    mediaKind: 'audiobook',
    title: product.title,
    authors: (product.authors ?? []).map((author) => author.name.trim()).filter(Boolean),
    seriesName: series?.title ?? null,
    seriesIndex: numberOrNull(series?.sequence),
    coverUrl: httpsCover(product.product_images?.[500]),
    isbn13: null,
    asin: product.asin,
    date: product.release_date ?? null,
  };
}

export function mapGoogleVolume(volume: GoogleUpcomingVolume, seriesName: string | null): SourceRelease {
  const info = volume.volumeInfo;
  return {
    source: 'google',
    sourceId: volume.id,
    mediaKind: 'ebook',
    title: info.title,
    authors: (info.authors ?? []).map((author) => author.trim()).filter(Boolean),
    seriesName,
    seriesIndex: null,
    coverUrl: httpsCover(info.imageLinks?.thumbnail),
    isbn13: info.industryIdentifiers?.find((identifier) => identifier.type === 'ISBN_13')?.identifier ?? null,
    asin: null,
    date: info.publishedDate ?? null,
  };
}

/** Keeps a source's answer to the followed name: its author, or its series (by its author, when known). */
export function belongsToTarget(release: SourceRelease, target: ReleaseTarget): boolean {
  if (target.kind === 'author') return release.authors.some((author) => sameName(author, target.nameKey));
  if (!sameName(release.seriesName, target.nameKey)) return false;
  if (!target.authorHint) return true;
  const hint = nameKey(target.authorHint);
  return release.authors.some((author) => nameKey(author) === hint);
}

/**
 * Asks the book sites what a followed author or series has coming out: Hardcover first, then
 * Audible's US store, then Google Books. A site that is turned off, has no key, or fails is
 * skipped for this check; the others still count.
 */
@Injectable()
export class ReleaseSourcesService {
  private readonly logger = new Logger(ReleaseSourcesService.name);
  private paceMs = SOURCE_PACE_MS;

  constructor(private readonly providerConfig: ProviderConfigService) {}

  setPaceForTesting(paceMs: number): void {
    this.paceMs = paceMs;
  }

  async status(): Promise<NewReleaseSourceStatus> {
    const config = await this.providerConfig.getConfig();
    return {
      hardcover: config.hardcover.enabled && config.hardcover.apiKey.trim().length > 0,
      audible: config.audible.enabled,
      google: config.google.enabled && config.google.apiKey.trim().length > 0,
    };
  }

  /** Every upcoming book the enabled sites report for one followed name, in source priority order. */
  async lookup(target: ReleaseTarget, today: string): Promise<{ releases: SourceRelease[]; failedSources: ReleaseSourceKey[]; attempted: number }> {
    const config = await this.providerConfig.getConfig();
    const releases: SourceRelease[] = [];
    const failedSources: ReleaseSourceKey[] = [];
    const steps: { source: ReleaseSourceKey; run: () => Promise<SourceRelease[]> }[] = [];
    if (config.hardcover.enabled && config.hardcover.apiKey.trim()) {
      steps.push({ source: 'hardcover', run: () => this.fromHardcover(target, today, config.hardcover.apiKey) });
    }
    if (config.audible.enabled) steps.push({ source: 'audible', run: () => this.fromAudible(target) });
    if (config.google.enabled && config.google.apiKey.trim()) {
      steps.push({ source: 'google', run: () => this.fromGoogle(target, config.google.apiKey) });
    }

    for (const [index, step] of steps.entries()) {
      if (index > 0 && this.paceMs > 0) await sleep(this.paceMs);
      try {
        const found = await step.run();
        releases.push(...found.filter((release) => belongsToTarget(release, target)));
      } catch (error) {
        failedSources.push(step.source);
        this.logger.warn(
          `[new_releases.source] [fail] source=${step.source} kind=${target.kind} name="${sanitizeLogValue(target.name)}" error="${sanitizeLogError(error)}" - lookup failed, other sources still count`,
        );
      }
    }
    return { releases, failedSources, attempted: steps.length };
  }

  private async fromHardcover(target: ReleaseTarget, today: string, apiKey: string): Promise<SourceRelease[]> {
    const where: Record<string, unknown> = { release_date: { _gt: today }, canonical_id: { _is_null: true } };
    if (target.kind === 'author') {
      where.contributions = { author: { name: { _eq: target.name } } };
    } else {
      where.book_series = { series: { name: { _eq: target.name } }, compilation: { _eq: false } };
      if (target.authorHint) where.contributions = { author: { name: { _eq: target.authorHint } } };
    }
    const res = await fetchWithThrottle(HARDCOVER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: toBearerAuthorization(apiKey) },
      body: JSON.stringify({ query: HARDCOVER_UPCOMING_QUERY, variables: { where } }),
      signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT),
    });
    if (!res.ok) throw new Error(`hardcover responded ${res.status}`);
    const body = (await res.json()) as { data?: { books?: HardcoverUpcomingBook[] }; errors?: { message?: string }[] };
    if (body.errors?.length) throw new Error(`hardcover: ${body.errors[0]?.message ?? 'query error'}`);
    return (body.data?.books ?? []).flatMap(mapHardcoverBook);
  }

  private async fromAudible(target: ReleaseTarget): Promise<SourceRelease[]> {
    const url = new URL(AUDIBLE_US_PRODUCTS);
    url.searchParams.set('num_results', '50');
    url.searchParams.set('products_sort_by', '-ReleaseDate');
    url.searchParams.set('response_groups', 'product_desc,product_attrs,media,series');
    url.searchParams.set('image_sizes', '500');
    if (target.kind === 'author') {
      url.searchParams.set('author', target.name);
    } else {
      url.searchParams.set('keywords', target.name);
      if (target.authorHint) url.searchParams.set('author', target.authorHint);
    }
    const res = await fetchWithThrottle(url, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT) });
    if (!res.ok) throw new Error(`audible responded ${res.status}`);
    const body = (await res.json()) as { products?: AudibleUpcomingProduct[] };
    return (body.products ?? []).map(mapAudibleProduct);
  }

  private async fromGoogle(target: ReleaseTarget, apiKey: string): Promise<SourceRelease[]> {
    const author = target.kind === 'author' ? target.name : target.authorHint;
    // Google Books knows nothing of series, so a series is looked up by its author and title words.
    if (!author) return [];
    const query = target.kind === 'author' ? `inauthor:"${author}"` : `"${target.name}" inauthor:"${author}"`;
    const url = new URL(GOOGLE_VOLUMES);
    url.searchParams.set('q', query);
    url.searchParams.set('orderBy', 'newest');
    url.searchParams.set('maxResults', '40');
    url.searchParams.set('printType', 'books');
    url.searchParams.set('country', 'US');
    url.searchParams.set('key', apiKey);
    const res = await fetchWithThrottle(url, { signal: buildRequestSignal(PROVIDER_TIMEOUT_MS.DEFAULT) });
    if (!res.ok) throw new Error(`google books responded ${res.status}`);
    const body = (await res.json()) as { items?: GoogleUpcomingVolume[] };
    return (body.items ?? []).map((volume) => {
      const title = volume.volumeInfo.title ?? '';
      // A title naming the series is the only series link Google gives.
      const seriesName = target.kind === 'series' && nameKey(title).includes(target.nameKey) ? target.name : null;
      return mapGoogleVolume(volume, seriesName);
    });
  }
}
