import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { lastValueFrom, timeout, toArray } from 'rxjs';
import { MetadataProviderKey } from '@bookorbit/types';
import type { MetadataCandidate } from '@bookorbit/types';

import { foldTextForComparison, mainTitlePart, symmetricTitleSimilarity } from '../../../common/text-match/title-match';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { parsePublishedDateKey, publishedYearFromDateKey } from '../../../common/utils/published-date.utils';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { MetadataFetchService } from '../../metadata-fetch/metadata-fetch.service';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestRepository } from '../book-request.repository';

type DatedKind = 'ebook' | 'audiobook';

/** Audible first: it lists the release date for audiobooks most reliably, then Libro.fm. */
const AUDIO_DATE_PROVIDERS: MetadataProviderKey[] = [MetadataProviderKey.AUDIBLE, MetadataProviderKey.LIBROFM];
/** Amazon lists the Kindle edition's own date, Kobo and Google Books cover what it misses. */
const EBOOK_DATE_PROVIDERS: MetadataProviderKey[] = [MetadataProviderKey.AMAZON, MetadataProviderKey.KOBO, MetadataProviderKey.GOOGLE];
const SEARCH_TIMEOUT_MS = 20_000;
/** Below this the result is likely another book with a similar name. */
const MIN_TITLE_SIMILARITY = 0.85;
const AUDIOBOOK_BACKFILL_KEY = 'book_request_audiobook_dates_backfilled_v1';
const EBOOK_BACKFILL_KEY = 'book_request_ebook_dates_backfilled_v1';
/** Spacing between catch-up lookups, so a long backlog does not hammer any one site. */
const BACKFILL_DELAY_MS = 3_000;

interface RequestForDate {
  id: number;
  title: string;
  authors: string[];
  mediaKind: string;
  publishedDate: string | null;
}

/**
 * Fills in the release date a request shows. An audiobook comes out on its own date, often weeks
 * after the print edition, while the request form takes its date from whichever result was picked,
 * usually an ebook one: so an audiobook is always looked up, on Audible then Libro.fm. An ebook's
 * picked date is normally right, but a request made from an existing book's page carries none, so
 * an ebook without a full date is looked up on Amazon, Kobo, then Google Books. The date of the
 * first result whose title and author both match is kept; nothing changes without a confident match.
 */
@Injectable()
export class RequestReleaseDateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RequestReleaseDateService.name);

  constructor(
    private readonly repo: BookRequestRepository,
    private readonly metadata: MetadataFetchService,
    private readonly gateway: BookRequestGateway,
    private readonly appSettings: AppSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.backfillAll();
  }

  /** Fire and forget: a request is never held up by a search on another site. */
  enrichInBackground(requestId: number): void {
    void this.enrich(requestId).catch((error: unknown) => this.logFailure(requestId, error));
  }

  async enrich(requestId: number): Promise<boolean> {
    const joined = await this.repo.findById(requestId);
    if (!joined) return false;
    const request = joined.request as RequestForDate;
    if (!request.title.trim()) return false;
    const kind = datedKind(request);
    if (!kind) return false;

    const startedAt = Date.now();
    for (const provider of kind === 'audiobook' ? AUDIO_DATE_PROVIDERS : EBOOK_DATE_PROVIDERS) {
      const date = await this.findDate(provider, kind, request);
      if (!date) continue;
      if (date !== request.publishedDate) {
        await this.repo.setPublishedDate(request.id, date, publishedYearFromDateKey(date));
        this.gateway.emitChanged();
      }
      this.logger.log(
        `[book_request.release_date] [end] requestId=${request.id} mediaKind=${kind} provider=${provider} durationMs=${Date.now() - startedAt} changed=${date !== request.publishedDate} - release date found`,
      );
      return true;
    }
    return false;
  }

  private async findDate(provider: MetadataProviderKey, kind: DatedKind, request: RequestForDate): Promise<string | null> {
    const audio = kind === 'audiobook';
    const candidates = await lastValueFrom(
      this.metadata
        .searchCandidates(
          {
            title: request.title,
            author: request.authors[0],
            isAudiobook: audio,
            mediaKind: kind,
            ...(audio ? { includeAudiobookProviders: true } : {}),
            maxCandidatesPerProvider: 5,
          },
          [provider],
        )
        .pipe(toArray(), timeout(SEARCH_TIMEOUT_MS)),
      { defaultValue: [] as MetadataCandidate[] },
    );
    for (const candidate of candidates) {
      const date = parsePublishedDateKey(candidate.publishedDate);
      if (date && this.matches(request, candidate)) return date;
    }
    return null;
  }

  /** Same book: the main titles nearly agree and at least one author is shared. */
  private matches(request: RequestForDate, candidate: MetadataCandidate): boolean {
    if (!candidate.title) return false;
    const similarity = symmetricTitleSimilarity(mainTitlePart(request.title), mainTitlePart(candidate.title));
    if (similarity < MIN_TITLE_SIMILARITY) return false;
    if (request.authors.length === 0) return true;
    const wanted = new Set(request.authors.map(authorKey));
    return (candidate.authors ?? []).some((author) => wanted.has(authorKey(author)));
  }

  private async backfillAll(): Promise<void> {
    await this.backfillOnce('audiobook', AUDIOBOOK_BACKFILL_KEY, () => this.repo.findOpenAudiobookIds());
    await this.backfillOnce('ebook', EBOOK_BACKFILL_KEY, () => this.repo.findOpenEbookIdsWithoutDate());
  }

  /** Brings existing open requests of one format up to date once, slowly, then never again. */
  private async backfillOnce(kind: DatedKind, key: string, findIds: () => Promise<number[]>): Promise<void> {
    if ((await this.appSettings.getValue(key)) === 'true') return;
    const ids = await findIds();
    const startedAt = Date.now();
    this.logger.log(`[book_request.release_date_backfill] [start] mediaKind=${kind} requests=${ids.length} - looking up release dates`);
    let found = 0;
    for (const [index, id] of ids.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, BACKFILL_DELAY_MS));
      try {
        if (await this.enrich(id)) found++;
      } catch (error: unknown) {
        this.logFailure(id, error);
      }
    }
    await this.appSettings.setValue(key, 'true');
    this.logger.log(
      `[book_request.release_date_backfill] [end] mediaKind=${kind} requests=${ids.length} found=${found} durationMs=${Date.now() - startedAt} - release dates caught up`,
    );
  }

  private logFailure(requestId: number, error: unknown): void {
    this.logger.warn(
      `[book_request.release_date] [fail] requestId=${requestId} errorClass=${error instanceof Error ? error.constructor.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - release date lookup failed`,
    );
  }
}

/** Which lookup a request gets, if any: every audiobook, and an ebook only when it has no full date. */
function datedKind(request: RequestForDate): DatedKind | null {
  if (request.mediaKind === 'audiobook') return 'audiobook';
  if (request.mediaKind === 'ebook' && !request.publishedDate) return 'ebook';
  return null;
}

function authorKey(name: string): string {
  return foldTextForComparison(name).replace(/[^a-z0-9]/g, '');
}
