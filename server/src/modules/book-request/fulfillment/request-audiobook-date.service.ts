import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { lastValueFrom, timeout, toArray } from 'rxjs';
import { MetadataProviderKey } from '@bookorbit/types';
import type { MetadataCandidate } from '@bookorbit/types';

import { foldTextForComparison, mainTitlePart, symmetricTitleSimilarity } from '../../../common/text-match/title-match';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { publishedYearFromDateKey } from '../../../common/utils/published-date.utils';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { MetadataFetchService } from '../../metadata-fetch/metadata-fetch.service';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestRepository } from '../book-request.repository';

/** Audible first: it lists the release date for audiobooks most reliably, then Libro.fm. */
const AUDIO_DATE_PROVIDERS: MetadataProviderKey[] = [MetadataProviderKey.AUDIBLE, MetadataProviderKey.LIBROFM];
const SEARCH_TIMEOUT_MS = 20_000;
/** Below this the result is likely another book with a similar name. */
const MIN_TITLE_SIMILARITY = 0.85;
const BACKFILL_KEY = 'book_request_audiobook_dates_backfilled_v1';
/** Spacing between catch-up lookups, so a long backlog does not hammer either site. */
const BACKFILL_DELAY_MS = 3_000;

interface RequestForDate {
  id: number;
  title: string;
  authors: string[];
  mediaKind: string;
  publishedDate: string | null;
}

/**
 * An audiobook comes out on its own date, often weeks or months after the print edition, and the
 * request form takes its date from whichever result was picked, usually an ebook one. This looks
 * the audiobook up on Audible, then Libro.fm, and keeps the date of the first result whose title
 * and author both match. Nothing is changed when neither finds a confident match.
 */
@Injectable()
export class RequestAudiobookDateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RequestAudiobookDateService.name);

  constructor(
    private readonly repo: BookRequestRepository,
    private readonly metadata: MetadataFetchService,
    private readonly gateway: BookRequestGateway,
    private readonly appSettings: AppSettingsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.backfillOnce();
  }

  /** Fire and forget: a request is never held up by a search on another site. */
  enrichInBackground(requestId: number): void {
    void this.enrich(requestId).catch((error: unknown) => this.logFailure(requestId, error));
  }

  async enrich(requestId: number): Promise<boolean> {
    const joined = await this.repo.findById(requestId);
    if (!joined) return false;
    const request = joined.request as RequestForDate;
    if (request.mediaKind !== 'audiobook' || !request.title.trim()) return false;

    const startedAt = Date.now();
    for (const provider of AUDIO_DATE_PROVIDERS) {
      const date = await this.findDate(provider, request);
      if (!date) continue;
      if (date !== request.publishedDate) {
        await this.repo.setPublishedDate(request.id, date, publishedYearFromDateKey(date) ?? null);
        this.gateway.emitChanged();
      }
      this.logger.log(
        `[book_request.audiobook_date] [end] requestId=${request.id} provider=${provider} durationMs=${Date.now() - startedAt} changed=${date !== request.publishedDate} - audiobook release date found`,
      );
      return true;
    }
    return false;
  }

  private async findDate(provider: MetadataProviderKey, request: RequestForDate): Promise<string | null> {
    const candidates = await lastValueFrom(
      this.metadata
        .searchCandidates(
          {
            title: request.title,
            author: request.authors[0],
            isAudiobook: true,
            mediaKind: 'audiobook',
            includeAudiobookProviders: true,
            maxCandidatesPerProvider: 5,
          },
          [provider],
        )
        .pipe(toArray(), timeout(SEARCH_TIMEOUT_MS)),
      { defaultValue: [] as MetadataCandidate[] },
    );
    const match = candidates.find((candidate) => candidate.publishedDate && this.matches(request, candidate));
    return match?.publishedDate ?? null;
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

  /** Brings existing open audiobook requests up to date once, slowly, then never again. */
  private async backfillOnce(): Promise<void> {
    if ((await this.appSettings.getValue(BACKFILL_KEY)) === 'true') return;
    const ids = await this.repo.findOpenAudiobookIds();
    const startedAt = Date.now();
    this.logger.log(`[book_request.audiobook_date_backfill] [start] requests=${ids.length} - looking up audiobook release dates`);
    let found = 0;
    for (const [index, id] of ids.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, BACKFILL_DELAY_MS));
      try {
        if (await this.enrich(id)) found++;
      } catch (error: unknown) {
        this.logFailure(id, error);
      }
    }
    await this.appSettings.setValue(BACKFILL_KEY, 'true');
    this.logger.log(
      `[book_request.audiobook_date_backfill] [end] requests=${ids.length} found=${found} durationMs=${Date.now() - startedAt} - audiobook release dates caught up`,
    );
  }

  private logFailure(requestId: number, error: unknown): void {
    this.logger.warn(
      `[book_request.audiobook_date] [fail] requestId=${requestId} errorClass=${error instanceof Error ? error.constructor.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - audiobook release date lookup failed`,
    );
  }
}

function authorKey(name: string): string {
  return foldTextForComparison(name).replace(/[^a-z0-9]/g, '');
}
