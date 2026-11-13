import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lastValueFrom, timeout, toArray } from 'rxjs';
import { MetadataProviderKey } from '@bookorbit/types';
import type { MetadataCandidate } from '@bookorbit/types';

import { foldTextForComparison, mainTitlePart, symmetricTitleSimilarity } from '../../../common/text-match/title-match';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { parsePublishedDateKey, publishedYearFromDateKey } from '../../../common/utils/published-date.utils';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import type { CacheDirective } from '../../../common/provider-cache/provider-cache-spec';
import { MetadataFetchService } from '../../metadata-fetch/metadata-fetch.service';
import { ProviderThrottleTracker } from '../../metadata-fetch/provider-throttle.tracker';
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
const RECHECK_LAST_RUN_KEY = 'book_request_weekly_recheck_last_run';
/** The last request a capped run reached, so the next run carries on from there instead of starting over. */
const RECHECK_CURSOR_KEY = 'book_request_weekly_recheck_cursor';
const RECHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Wider spacing than the one-time catch-up: this runs every week, so it stays a light, steady trickle. */
const RECHECK_DELAY_MS = 5_000;
/** A ceiling on one week's run, so even a huge backlog finishes in a couple of hours. */
const RECHECK_MAX_REQUESTS = 1_000;
/** The point of a re-check is a newer answer, so go live, but fall back to a stored answer if the site fails. */
const RECHECK_DIRECTIVE: CacheDirective = { policy: 'refresh', allowFallback: true };

interface RequestForDate {
  id: number;
  title: string;
  authors: string[];
  mediaKind: string;
  publishedDate: string | null;
  coverUrl: string | null;
}

interface EnrichOptions {
  /** The weekly re-check: an ebook with a date is looked up again, and a missing cover is filled. */
  recheck?: boolean;
}

interface EnrichOutcome {
  found: boolean;
  dateChanged: boolean;
  coverAdded: boolean;
}

/**
 * Fills in the release date a request shows. An audiobook comes out on its own date, often weeks
 * after the print edition, while the request form takes its date from whichever result was picked,
 * usually an ebook one: so an audiobook is always looked up, on Audible then Libro.fm. An ebook's
 * picked date is normally right, but a request made from an existing book's page carries none, so
 * an ebook without a full date is looked up on Amazon, Kobo, then Google Books. The date of the
 * first result whose title and author both match is kept; nothing changes without a confident match.
 *
 * Once a week every open request is checked again, since release dates move and pre-release books
 * gain their cover art late: dates are updated and a request with no cover gets the matched result's.
 * That run is spaced out, skips any site that has asked BookOrbit to slow down, and is capped.
 */
@Injectable()
export class RequestReleaseDateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RequestReleaseDateService.name);

  constructor(
    private readonly repo: BookRequestRepository,
    private readonly metadata: MetadataFetchService,
    private readonly gateway: BookRequestGateway,
    private readonly appSettings: AppSettingsService,
    private readonly throttle: ProviderThrottleTracker,
  ) {}

  private busy = false;

  onApplicationBootstrap(): void {
    void this.backfillAll();
  }

  /** Checked hourly; the re-check itself runs once seven days have passed since the last one began. */
  @Cron('0 23 * * * *')
  async runWeeklyRecheck(now: Date = new Date()): Promise<void> {
    if (this.busy) return;
    const lastRun = Date.parse((await this.appSettings.getValue(RECHECK_LAST_RUN_KEY)) ?? '');
    if (Number.isFinite(lastRun) && now.getTime() - lastRun < RECHECK_INTERVAL_MS) return;
    this.busy = true;
    try {
      // Marked before the run, so restarts during a long run never set off a second one that week.
      await this.appSettings.setValue(RECHECK_LAST_RUN_KEY, now.toISOString());
      await this.recheckAll();
    } finally {
      this.busy = false;
    }
  }

  private async recheckAll(): Promise<void> {
    const ids = await this.nextRecheckBatch();
    const startedAt = Date.now();
    this.logger.log(`[book_request.weekly_recheck] [start] requests=${ids.length} - re-checking release dates and covers`);
    let found = 0;
    let datesChanged = 0;
    let coversAdded = 0;
    for (const [index, id] of ids.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, RECHECK_DELAY_MS));
      try {
        const outcome = await this.lookUp(id, { recheck: true });
        if (outcome.found) found++;
        if (outcome.dateChanged) datesChanged++;
        if (outcome.coverAdded) coversAdded++;
      } catch (error: unknown) {
        this.logFailure(id, error);
      }
    }
    this.logger.log(
      `[book_request.weekly_recheck] [end] requests=${ids.length} durationMs=${Date.now() - startedAt} found=${found} datesChanged=${datesChanged} coversAdded=${coversAdded} - release dates and covers re-checked`,
    );
  }

  /**
   * Up to one run's worth of open requests. A backlog larger than that is worked through over
   * successive weeks: a run that hits the cap remembers where it stopped, and the run that reaches
   * the end starts again from the oldest.
   */
  private async nextRecheckBatch(): Promise<number[]> {
    const cursor = Number((await this.appSettings.getValue(RECHECK_CURSOR_KEY)) ?? '');
    let ids = await this.repo.findOpenDatedIds(RECHECK_MAX_REQUESTS, Number.isInteger(cursor) && cursor > 0 ? cursor : 0);
    if (ids.length === 0 && cursor > 0) ids = await this.repo.findOpenDatedIds(RECHECK_MAX_REQUESTS, 0);
    const reachedCap = ids.length === RECHECK_MAX_REQUESTS;
    await this.appSettings.setValue(RECHECK_CURSOR_KEY, reachedCap ? String(ids[ids.length - 1]) : '');
    return ids;
  }

  /** Fire and forget: a request is never held up by a search on another site. */
  enrichInBackground(requestId: number): void {
    void this.enrich(requestId).catch((error: unknown) => this.logFailure(requestId, error));
  }

  async enrich(requestId: number): Promise<boolean> {
    return (await this.lookUp(requestId, {})).found;
  }

  private async lookUp(requestId: number, options: EnrichOptions): Promise<EnrichOutcome> {
    const none: EnrichOutcome = { found: false, dateChanged: false, coverAdded: false };
    const joined = await this.repo.findById(requestId);
    if (!joined) return none;
    const request = joined.request as RequestForDate;
    if (!request.title.trim()) return none;
    const kind = datedKind(request, options.recheck === true);
    if (!kind) return none;

    const wantCover = options.recheck === true && !request.coverUrl;
    const startedAt = Date.now();
    let date: string | null = null;
    let cover: string | null = null;
    let dateProvider: MetadataProviderKey | null = null;
    for (const provider of kind === 'audiobook' ? AUDIO_DATE_PROVIDERS : EBOOK_DATE_PROVIDERS) {
      if (options.recheck && this.throttle.isThrottled(provider)) continue;
      const match = await this.findMatch(provider, kind, request, {
        wantDate: !date,
        wantCover: wantCover && !cover,
        recheck: options.recheck === true,
      });
      if (!date && match.date) {
        date = match.date;
        dateProvider = provider;
      }
      cover ??= match.cover;
      if (date && (!wantCover || cover)) break;
    }

    const differs = date !== null && date !== request.publishedDate;
    const kept = differs && options.recheck === true && isSettledDate(request.publishedDate, date!, new Date());
    const dateChanged = differs && !kept;
    if (dateChanged) await this.repo.setPublishedDate(request.id, date!, publishedYearFromDateKey(date!));
    const coverAdded = cover !== null && (await this.repo.setCoverUrlIfMissing(request.id, cover));
    if (dateChanged || coverAdded) this.gateway.emitChanged();
    if (date) {
      const outcome = dateChanged
        ? 'release date changed'
        : kept
          ? 'a different date was found but the released date was kept'
          : 'release date confirmed';
      this.logger.log(
        `[book_request.release_date] [end] requestId=${request.id} mediaKind=${kind} provider=${dateProvider} recheck=${options.recheck === true} durationMs=${Date.now() - startedAt} changed=${dateChanged} from=${request.publishedDate ?? 'none'} to=${dateChanged ? date : (request.publishedDate ?? 'none')} found=${date} coverAdded=${coverAdded} - ${outcome}`,
      );
    }
    return { found: date !== null, dateChanged, coverAdded };
  }

  /** The first matching result's date, and when wanted, the first matching result's cover. */
  private async findMatch(
    provider: MetadataProviderKey,
    kind: DatedKind,
    request: RequestForDate,
    want: { wantDate: boolean; wantCover: boolean; recheck: boolean },
  ): Promise<{ date: string | null; cover: string | null }> {
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
          ...(want.recheck ? [{ directive: RECHECK_DIRECTIVE }] : []),
        )
        .pipe(toArray(), timeout(SEARCH_TIMEOUT_MS)),
      { defaultValue: [] as MetadataCandidate[] },
    );
    let date: string | null = null;
    let cover: string | null = null;
    for (const candidate of candidates) {
      if (!this.matches(request, candidate, want.recheck && request.publishedDate !== null)) continue;
      if (want.wantDate && !date) date = parsePublishedDateKey(candidate.publishedDate) ?? null;
      if (want.wantCover && !cover && isWebAddress(candidate.coverUrl)) cover = candidate.coverUrl;
      if ((!want.wantDate || date) && (!want.wantCover || cover)) break;
    }
    return { date, cover };
  }

  /**
   * Same book: the main titles nearly agree and at least one author is shared. A request with no
   * author can match on the title alone, except when that would replace a date it already has.
   */
  private matches(request: RequestForDate, candidate: MetadataCandidate, authorRequired = false): boolean {
    if (!candidate.title) return false;
    const similarity = symmetricTitleSimilarity(mainTitlePart(request.title), mainTitlePart(candidate.title));
    if (similarity < MIN_TITLE_SIMILARITY) return false;
    if (request.authors.length === 0) return !authorRequired;
    const wanted = new Set(request.authors.map(authorKey));
    return (candidate.authors ?? []).some((author) => wanted.has(authorKey(author)));
  }

  private async backfillAll(): Promise<void> {
    this.busy = true;
    try {
      await this.backfillOnce('audiobook', AUDIOBOOK_BACKFILL_KEY, () => this.repo.findOpenAudiobookIds());
      await this.backfillOnce('ebook', EBOOK_BACKFILL_KEY, () => this.repo.findOpenEbookIdsWithoutDate());
    } finally {
      this.busy = false;
    }
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

/**
 * Which lookup a request gets, if any: every audiobook, and an ebook only when it has no full date,
 * except in the weekly re-check, where an ebook's date is checked again too.
 */
function datedKind(request: RequestForDate, recheck: boolean): DatedKind | null {
  if (request.mediaKind === 'audiobook') return 'audiobook';
  if (request.mediaKind === 'ebook' && (recheck || !request.publishedDate)) return 'ebook';
  return null;
}

/**
 * A book that is already out does not get a new release date: when the date on file and the one
 * just found are both in the past, the difference is another edition's date, not news. A date still
 * ahead, on either side, is a release that moved and is taken.
 */
export function isSettledDate(current: string | null, found: string, now: Date): boolean {
  if (!current) return false;
  const today = now.toISOString().slice(0, 10);
  return current <= today && found <= today;
}

function isWebAddress(value: string | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function authorKey(name: string): string {
  return foldTextForComparison(name).replace(/[^a-z0-9]/g, '');
}
