import { ConflictException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  COMMUNITY_RATINGS_REFRESH_SCHEDULES,
  type CommunityRatingsRefreshRun,
  type CommunityRatingsRefreshSchedule,
  type CommunityRatingsRefreshStatus,
  type CommunityRatingsRefreshTrigger,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { BookService } from '../book/book.service';
import { CommunityRatingsRefreshRepository } from './community-ratings-refresh.repository';

const EVENT = 'community_ratings.refresh';
const SCHEDULE_KEY = 'community_ratings_refresh_schedule';
const RUN_KEY = 'community_ratings_refresh_run';
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const SAVE_EVERY = 25;
/** Waited after a book that reached a provider, so a large library never floods one. */
const PACE_MS = 1_000;
/** Giving the server time to finish starting before an interrupted pass carries on. */
const RESUME_DELAY_MS = 60_000;

/** What is kept between restarts: the public run plus where it had got to. */
interface StoredRun extends CommunityRatingsRefreshRun {
  lastBookId: number;
}

function parseRun(raw: string | null): StoredRun | null {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<StoredRun>) : null;
    if (!value || typeof value.startedAt !== 'string' || typeof value.lastBookId !== 'number') return null;
    return value as StoredRun;
  } catch {
    return null;
  }
}

function toPublicRun(run: StoredRun): CommunityRatingsRefreshRun {
  return {
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    cancelled: run.cancelled,
    total: run.total,
    processed: run.processed,
    updated: run.updated,
    unchanged: run.unchanged,
    skipped: run.skipped,
    failed: run.failed,
  };
}

/**
 * Fork: keeps community ratings current. One pass visits every book that already has a rating and
 * asks the metadata providers for that book's ratings again. It runs monthly when the schedule is
 * on, or on demand from Tools. A pass is slow on purpose, survives a restart by carrying on from
 * the book it had reached, and only ever writes ratings.
 */
@Injectable()
export class CommunityRatingsRefreshService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommunityRatingsRefreshService.name);
  private current: StoredRun | null = null;
  private cancelRequested = false;
  private paceMs = PACE_MS;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: CommunityRatingsRefreshRepository,
    private readonly appSettings: AppSettingsService,
    private readonly bookService: BookService,
  ) {}

  onApplicationBootstrap(): void {
    const timer = setTimeout(() => {
      void this.resumeInterrupted();
    }, RESUME_DELAY_MS);
    timer.unref();
  }

  async status(now: Date = new Date()): Promise<CommunityRatingsRefreshStatus> {
    const [schedule, lastRun, booksWithRatings] = await Promise.all([
      this.getSchedule(),
      this.current ? Promise.resolve(this.current) : this.readStoredRun(),
      this.repository.countBooksWithRatings(),
    ]);
    const running = this.current !== null;
    let nextScheduledAt: string | null = null;
    if (schedule === 'monthly' && !running) {
      const due = lastRun ? Date.parse(lastRun.startedAt) + MONTH_MS : now.getTime();
      nextScheduledAt = new Date(Math.max(due, now.getTime())).toISOString();
    }
    return { schedule, running, run: lastRun ? toPublicRun(lastRun) : null, booksWithRatings, nextScheduledAt };
  }

  async setSchedule(schedule: CommunityRatingsRefreshSchedule): Promise<CommunityRatingsRefreshStatus> {
    await this.appSettings.setValue(SCHEDULE_KEY, schedule);
    return this.status();
  }

  async start(trigger: CommunityRatingsRefreshTrigger): Promise<CommunityRatingsRefreshStatus> {
    if (this.current) throw new ConflictException('Community ratings are already being updated');
    const run: StoredRun = {
      trigger,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      cancelled: false,
      total: await this.repository.countBooksWithRatings(),
      processed: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      lastBookId: 0,
    };
    this.begin(run);
    return this.status();
  }

  async cancel(): Promise<CommunityRatingsRefreshStatus> {
    if (this.current) this.cancelRequested = true;
    return this.status();
  }

  /** Checked hourly: a monthly pass starts once the last one began 30 or more days ago. */
  @Cron('0 17 * * * *')
  async runScheduled(now: Date = new Date()): Promise<void> {
    if (this.current || (await this.getSchedule()) !== 'monthly') return;
    const last = await this.readStoredRun();
    if (last && now.getTime() - Date.parse(last.startedAt) < MONTH_MS) return;
    await this.start('scheduled');
  }

  /** Resolves when the pass in progress, if any, has ended. For tests and orderly shutdown. */
  async whenIdle(): Promise<void> {
    await this.loop;
  }

  setPaceForTesting(paceMs: number): void {
    this.paceMs = paceMs;
  }

  private async resumeInterrupted(): Promise<void> {
    if (this.current) return;
    const stored = await this.readStoredRun().catch(() => null);
    if (!stored || stored.finishedAt !== null) return;
    this.logger.log(`[${EVENT}] [start] resumed=true afterBookId=${stored.lastBookId} - carrying on with the pass a restart interrupted`);
    this.begin(stored);
  }

  private begin(run: StoredRun): void {
    this.current = run;
    this.cancelRequested = false;
    this.loop = this.runPass(run).catch((error: unknown) => {
      this.logger.error(
        `[${EVENT}] [fail] processed=${run.processed} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - the pass stopped`,
      );
    });
  }

  private async runPass(run: StoredRun): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`[${EVENT}] [start] trigger=${run.trigger} total=${run.total} afterBookId=${run.lastBookId} - updating community ratings`);
    try {
      await this.saveRun(run);
      for (;;) {
        const bookIds = await this.repository.findBookIdsWithRatings(run.lastBookId, BATCH_SIZE);
        if (bookIds.length === 0 || this.cancelRequested) break;
        for (const bookId of bookIds) {
          if (this.cancelRequested) break;
          const outboundRequests = await this.refreshOne(run, bookId);
          run.lastBookId = bookId;
          run.processed += 1;
          if (run.processed % SAVE_EVERY === 0) await this.saveRun(run);
          if (outboundRequests > 0 && this.paceMs > 0) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
        }
      }
    } finally {
      run.cancelled = this.cancelRequested;
      run.finishedAt = new Date().toISOString();
      this.current = null;
      this.cancelRequested = false;
      await this.saveRun(run).catch(() => undefined);
      this.logger.log(
        `[${EVENT}] [end] trigger=${run.trigger} durationMs=${Date.now() - startedAt} processed=${run.processed} updated=${run.updated} unchanged=${run.unchanged} skipped=${run.skipped} failed=${run.failed} cancelled=${run.cancelled} - community ratings pass ended`,
      );
    }
  }

  private async refreshOne(run: StoredRun, bookId: number): Promise<number> {
    try {
      const result = await this.bookService.refreshCommunityRatings(bookId);
      run[result.status] += 1;
      return result.outboundRequests;
    } catch (error) {
      run.failed += 1;
      this.logger.warn(
        `[${EVENT}] [fail] bookId=${bookId} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - ratings lookup failed for one book`,
      );
      // A failure usually means a provider is struggling, so the next book waits too.
      return 1;
    }
  }

  private async getSchedule(): Promise<CommunityRatingsRefreshSchedule> {
    const value = await this.appSettings.getValue(SCHEDULE_KEY);
    return COMMUNITY_RATINGS_REFRESH_SCHEDULES.includes(value as CommunityRatingsRefreshSchedule)
      ? (value as CommunityRatingsRefreshSchedule)
      : 'off';
  }

  private async readStoredRun(): Promise<StoredRun | null> {
    return parseRun(await this.appSettings.getValue(RUN_KEY));
  }

  private async saveRun(run: StoredRun): Promise<void> {
    await this.appSettings.setValue(RUN_KEY, JSON.stringify(run));
  }
}
