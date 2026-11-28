import { Injectable, Logger } from '@nestjs/common';
import type {
  BookRequestAvailability,
  BookRequestAvailabilityQuery,
  NewReleaseRequestFormat,
  SeriesBookItem,
  SeriesBookStatus,
  SeriesBooksRequestResult,
  SeriesBooksResult,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookRequestService } from '../book-request/book-request.service';
import { LibraryService } from '../library/library.service';
import { NewReleasesRepository } from './new-releases.repository';
import { languageFilterOf, NewReleasesService } from './new-releases.service';
import { nameKey, type ReleaseSourceKey } from './release-merge';
import { formatsToRequest } from './release-request';
import { ReleaseSourcesService } from './release-sources.service';
import { toSeriesBooks, type SeriesBookRow } from './series-books';

const EVENT = 'series_books';
export const SERIES_REQUEST_NOTE = 'Requested from the series list';
/** A series looked up recently is answered from memory, so reopening the pop-up does not ask the sites again. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
/** The availability check takes at most this many items per call. */
const AVAILABILITY_BATCH = 50;

interface CachedLookup {
  at: number;
  rows: SeriesBookRow[];
  failedSources: ReleaseSourceKey[];
}

function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Where one book stands across the formats asked for: in the library, requested, or still missing. */
export function bookStatus(
  formats: NewReleaseRequestFormat[],
  answers: (BookRequestAvailability | undefined)[],
): Pick<SeriesBookItem, 'status' | 'missingFormats' | 'ownedBookId' | 'requestId'> {
  const missingFormats = formats.filter((_, index) => {
    const answer = answers[index];
    return !answer?.ownedBookId && !answer?.existingRequestId;
  });
  const allOwned = formats.every((_, index) => !!answers[index]?.ownedBookId);
  const status: SeriesBookStatus = allOwned ? 'owned' : missingFormats.length === 0 ? 'requested' : 'missing';
  return {
    status,
    missingFormats,
    ownedBookId: answers.find((answer) => answer?.ownedBookId)?.ownedBookId ?? null,
    requestId: answers.find((answer) => answer?.existingRequestId)?.existingRequestId ?? null,
  };
}

/**
 * Fork: the series pop-up on a request. Lists every book of a series from the book sites New
 * Releases uses, marks which this user has or has asked for, and requests the rest in the format
 * the New Releases settings name.
 */
@Injectable()
export class SeriesBooksService {
  private readonly logger = new Logger(SeriesBooksService.name);
  private readonly cache = new Map<string, CachedLookup>();

  constructor(
    private readonly repository: NewReleasesRepository,
    private readonly sources: ReleaseSourcesService,
    private readonly newReleases: NewReleasesService,
    private readonly libraryService: LibraryService,
    private readonly bookRequests: BookRequestService,
  ) {}

  async list(user: RequestUser, name: string, author?: string): Promise<SeriesBooksResult> {
    return (await this.resolve(user, name, author)).result;
  }

  private async resolve(user: RequestUser, name: string, author?: string): Promise<{ result: SeriesBooksResult; rows: SeriesBookRow[] }> {
    const seriesName = name.trim();
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const links = await this.repository.findLibraryLinks([], [seriesName], libraryIds);
    const seriesId = links.series.get(seriesName.toLowerCase()) ?? null;
    const authorHint = author?.trim() || (seriesId ? await this.repository.findSeriesAuthor(seriesId) : null);
    const server = await this.newReleases.serverSettings();
    const formats = formatsToRequest(server.defaultFormat);

    const lookup = await this.lookup(seriesName, authorHint, seriesId, libraryIds, server);
    const items = await this.withStatus(user, lookup.rows, formats);
    const result: SeriesBooksResult = {
      seriesName,
      seriesId,
      books: items,
      formats,
      sources: await this.sources.status(),
      failedSources: lookup.failedSources,
    };
    return { result, rows: lookup.rows };
  }

  async request(user: RequestUser, name: string, author: string | undefined, keys: string[]): Promise<SeriesBooksRequestResult> {
    const startedAt = Date.now();
    const { result: listed, rows } = await this.resolve(user, name, author);
    const wanted = new Set(keys);
    const byKey = new Map(rows.map((row) => [row.workKey, row]));
    this.logger.log(
      `[${EVENT}.request] [start] userId=${user.id} name="${sanitizeLogValue(listed.seriesName)}" asked=${wanted.size} - requesting series books`,
    );

    const requested: string[] = [];
    const failed: string[] = [];
    for (const item of listed.books) {
      if (!wanted.has(item.key)) continue;
      wanted.delete(item.key);
      // Already in the library: nothing to request. Already requested: counts as requested.
      if (item.status === 'owned') continue;
      if (item.status === 'requested') {
        requested.push(item.key);
        continue;
      }
      const row = byKey.get(item.key);
      if (!row) {
        failed.push(item.key);
        continue;
      }
      try {
        const filed = await this.newReleases.fileRequestsFor(user, row, item.missingFormats, { note: SERIES_REQUEST_NOTE });
        (filed.length > 0 ? requested : failed).push(item.key);
      } catch {
        failed.push(item.key);
      }
    }
    // A key no longer in the list (the sites changed their answer) cannot be requested.
    failed.push(...wanted);

    // Books also in the New Releases list show as requested there too.
    const releases = await this.repository.findReleasesByWorkKeys(requested);
    for (const release of releases) await this.repository.setRequested(user.id, release.id);

    this.logger.log(
      `[${EVENT}.request] [end] userId=${user.id} name="${sanitizeLogValue(listed.seriesName)}" durationMs=${Date.now() - startedAt} requested=${requested.length} failed=${failed.length} - series books requested`,
    );
    return { requested, failed };
  }

  private cacheKey(name: string, authorHint: string | null): string {
    return `${nameKey(name)}|${authorHint ? nameKey(authorHint) : ''}`;
  }

  private async lookup(
    name: string,
    authorHint: string | null,
    seriesId: number | null,
    libraryIds: number[],
    server: Awaited<ReturnType<NewReleasesService['serverSettings']>>,
  ): Promise<CachedLookup> {
    const key = this.cacheKey(name, authorHint);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

    const startedAt = Date.now();
    const audibleAsins = seriesId ? await this.repository.findLibrarySeriesAudibleAsins(seriesId, libraryIds) : [];
    const { releases, failedSources } = await this.sources.lookupSeries({
      kind: 'series',
      name,
      nameKey: nameKey(name),
      authorHint,
      audibleAsins,
    });
    const filter = languageFilterOf(server);
    const rows = toSeriesBooks(releases, todayIso(), { language: filter.language, strict: filter.strictLanguage });
    const entry: CachedLookup = { at: Date.now(), rows, failedSources };
    // A lookup where every site failed is not kept, so the next open tries again.
    if (rows.length > 0 || failedSources.length === 0) {
      this.cache.delete(key);
      this.cache.set(key, entry);
      if (this.cache.size > CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    }
    this.logger.log(
      `[${EVENT}.lookup] [end] name="${sanitizeLogValue(name)}" seriesId=${seriesId ?? 'none'} durationMs=${Date.now() - startedAt} reports=${releases.length} books=${rows.length} failedSources=${failedSources.join(',') || 'none'} - series looked up`,
    );
    return entry;
  }

  private async withStatus(user: RequestUser, rows: SeriesBookRow[], formats: NewReleaseRequestFormat[]): Promise<SeriesBookItem[]> {
    const queries: BookRequestAvailabilityQuery[] = rows.flatMap((row) =>
      formats.map((format) => {
        const audible = format === 'audiobook' ? row.sources.find((source) => source.source === 'audible' && source.asin)?.asin : undefined;
        return {
          title: row.title,
          author: row.authors[0] ?? null,
          isbn13: format === 'ebook' ? row.isbn13 : null,
          mediaKind: format,
          ...(audible ? { providerKey: 'audible', providerId: audible } : {}),
        };
      }),
    );
    const answers: BookRequestAvailability[] = [];
    for (let start = 0; start < queries.length; start += AVAILABILITY_BATCH) {
      answers.push(...(await this.bookRequests.checkAvailability(queries.slice(start, start + AVAILABILITY_BATCH), user)));
    }
    return rows.map((row, index) => ({
      key: row.workKey,
      title: row.title,
      authors: row.authors,
      seriesIndex: row.seriesIndex,
      coverUrl: row.coverUrl,
      releasedOn: row.releasedOn,
      comingOn: row.comingOn,
      comingSoon: row.comingSoon,
      ...bookStatus(
        formats,
        formats.map((_, offset) => answers[index * formats.length + offset]),
      ),
    }));
  }
}
