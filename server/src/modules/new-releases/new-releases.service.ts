import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DEFAULT_NEW_RELEASE_RETENTION_DAYS,
  NEW_RELEASE_DELIVERIES,
  NEW_RELEASE_FORMATS,
  type NewReleaseDelivery,
  type NewReleaseFormat,
  type NewReleaseItem,
  type NewReleaseRequestFormat,
  type NewReleaseRequestResult,
  type NewReleaseRetentionDays,
  type NewReleasesOverview,
  type NewReleasesServerSettings,
  type NewReleasesUserSettings,
  type ReleaseFollow,
  type ReleaseFollowKind,
  type ReleaseFollowPage,
  Permission,
  type UpdateNewReleasesUserSettingsPayload,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AuthService } from '../auth/auth.service';
import { BookRequestService } from '../book-request/book-request.service';
import { LibraryService } from '../library/library.service';
import { NewReleasesRepository, type FollowInput, type ReleaseFollowRow } from './new-releases.repository';
import { mergeReleases, nameKey, type SourceRelease } from './release-merge';
import { formatDate, formatsToRequest, requestFor } from './release-request';
import { ReleaseSourcesService, type ReleaseTarget } from './release-sources.service';

const EVENT = 'new_releases.check';
const DEFAULT_FORMAT_KEY = 'new_releases_default_format';
const DEFAULT_DELIVERY_KEY = 'new_releases_default_delivery';
/** A followed name is looked up again once its last look is this old. */
const RECHECK_DAYS = 7;
/** Names looked up per hourly run: about ten minutes of paced calls to the book sites. */
const TARGETS_PER_RUN = 60;
const LIST_LIMIT = 500;
const FOLLOW_ALL_PAGE = 1_000;
/** Kept a while past the longest drop-off period, then deleted. */
const KEEP_RELEASED_DAYS = 120;
/** A release no source has reported for this long is gone from the sites. */
const STALE_DAYS = 60;
/** Requests filed on people's behalf per run, so a large backlog spreads over several runs. */
const AUTO_REQUESTS_PER_RUN = 100;
/** A book that could not be requested for someone is not tried again for them for this long. */
const AUTO_REQUEST_RETRY_MS = 24 * 60 * 60 * 1000;
/** Lets a new follow get its first look soon, without starting a run per click. */
const KICK_DELAY_MS = 10_000;

function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Title forms a library book may be filed under: as given, and without a subtitle. */
function titleKeys(title: string): string[] {
  const base = title.trim().toLowerCase();
  const colon = base.indexOf(':');
  return [...new Set([base, colon > 0 ? base.slice(0, colon).trim() : base])].filter(Boolean);
}

function toFollow(row: ReleaseFollowRow): ReleaseFollow {
  return {
    id: row.id,
    kind: row.kind as ReleaseFollowKind,
    name: row.name,
    authorHint: row.authorHint,
    authorId: row.authorId,
    seriesId: row.seriesId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Fork: New Releases. People follow authors and series; a background check asks the book sites
 * what each followed name has coming out and keeps one shared list, and each person sees the part
 * of it their follows match.
 */
@Injectable()
export class NewReleasesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NewReleasesService.name);
  private running: Promise<void> | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  /** `userId:releaseId` pairs whose request failed, with when they may be tried again. */
  private readonly autoRequestRetryAt = new Map<string, number>();

  constructor(
    private readonly repository: NewReleasesRepository,
    private readonly sources: ReleaseSourcesService,
    private readonly appSettings: AppSettingsService,
    private readonly libraryService: LibraryService,
    private readonly bookRequests: BookRequestService,
    private readonly auth: AuthService,
  ) {}

  onApplicationBootstrap(): void {
    // Names followed while the server was down get their first look shortly after it starts.
    this.kick(60_000);
  }

  // ── Follows ─────────────────────────────────────────────

  async follow(
    user: RequestUser,
    input: { kind: ReleaseFollowKind; name: string; authorId?: number | null; seriesId?: number | null },
  ): Promise<ReleaseFollow> {
    const name = input.name.trim();
    const key = nameKey(name);
    if (!key) throw new BadRequestException('A follow needs a name');
    const authorHint = input.kind === 'series' && input.seriesId ? await this.repository.findSeriesAuthor(input.seriesId) : null;
    const follow: FollowInput = {
      kind: input.kind,
      name,
      nameKey: key,
      authorHint,
      authorId: input.kind === 'author' ? (input.authorId ?? null) : null,
      seriesId: input.kind === 'series' ? (input.seriesId ?? null) : null,
    };
    const row = await this.repository.insertFollow(user.id, follow);
    this.kick();
    return toFollow(row);
  }

  async unfollow(user: RequestUser, id: number): Promise<void> {
    if (!(await this.repository.deleteFollow(user.id, id))) throw new NotFoundException('Follow not found');
  }

  async findFollow(user: RequestUser, kind: ReleaseFollowKind, name: string): Promise<ReleaseFollow | null> {
    const key = nameKey(name);
    if (!key) return null;
    const row = await this.repository.findFollow(user.id, kind, key);
    return row ? toFollow(row) : null;
  }

  async listFollows(
    user: RequestUser,
    query: { kind?: ReleaseFollowKind; search?: string; offset?: number; limit?: number },
  ): Promise<ReleaseFollowPage> {
    const page = await this.repository.listFollows(
      user.id,
      query.kind ?? null,
      query.search?.trim() || null,
      Math.max(0, query.offset ?? 0),
      Math.min(200, Math.max(1, query.limit ?? 50)),
    );
    return { items: page.items.map(toFollow), total: page.total };
  }

  /**
   * Follows every author, or every series, in the libraries this user can see. Walks them a page at
   * a time so a large library never sits in memory, and skips names already followed.
   */
  async followAll(user: RequestUser, kind: ReleaseFollowKind): Promise<{ added: number }> {
    const startedAt = Date.now();
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    this.logger.log(`[new_releases.follow_all] [start] userId=${user.id} kind=${kind} libraries=${libraryIds.length} - following everything`);
    let added = 0;
    let afterId = 0;
    try {
      for (;;) {
        const page =
          kind === 'author'
            ? (await this.repository.findLibraryAuthorsPage(libraryIds, afterId, FOLLOW_ALL_PAGE)).map((row) => ({
                id: row.id,
                input: { kind, name: row.name, nameKey: nameKey(row.name), authorHint: null, authorId: row.id, seriesId: null } as FollowInput,
              }))
            : (await this.repository.findLibrarySeriesPage(libraryIds, afterId, FOLLOW_ALL_PAGE)).map((row) => ({
                id: row.id,
                input: {
                  kind,
                  name: row.name,
                  nameKey: nameKey(row.name),
                  authorHint: row.author_hint,
                  authorId: null,
                  seriesId: row.id,
                } as FollowInput,
              }));
        if (page.length === 0) break;
        afterId = page[page.length - 1]!.id;
        added += await this.repository.insertFollowsIfMissing(
          user.id,
          page.map((entry) => entry.input).filter((input) => input.nameKey),
        );
      }
    } catch (error) {
      this.logger.error(
        `[new_releases.follow_all] [fail] userId=${user.id} kind=${kind} durationMs=${Date.now() - startedAt} added=${added} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - follow all stopped`,
      );
      throw error;
    }
    this.logger.log(
      `[new_releases.follow_all] [end] userId=${user.id} kind=${kind} durationMs=${Date.now() - startedAt} added=${added} - followed everything`,
    );
    if (added > 0) this.kick();
    return { added };
  }

  // ── The list ────────────────────────────────────────────

  async overview(user: RequestUser): Promise<NewReleasesOverview> {
    const [server, userSettings, followCounts, sources, lastCheckedAt, pendingChecks] = await Promise.all([
      this.serverSettings(),
      this.repository.findUserSettings(user.id),
      this.repository.countFollows(user.id),
      this.sources.status(),
      this.repository.lastCheckedAt(user.id),
      this.repository.countUncheckedFollows(user.id),
    ]);
    const retentionDays = (userSettings?.retentionDays ?? DEFAULT_NEW_RELEASE_RETENTION_DAYS) as NewReleaseRetentionDays;
    const delivery = (userSettings?.delivery as NewReleaseDelivery | null) ?? null;
    const rows = await this.repository.listForUser(user.id, retentionDays, LIST_LIMIT);
    const items: NewReleaseItem[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      authors: row.authors,
      seriesName: row.seriesName,
      seriesIndex: row.seriesIndex,
      coverUrl: row.coverUrl,
      ebookDate: row.ebookDate,
      audiobookDate: row.audiobookDate,
      releaseDate: row.releaseDate!,
      matchedFollows: row.matchedFollows,
      state: row.state,
    }));
    return {
      items,
      followCounts,
      sources,
      server,
      user: { delivery, retentionDays },
      effectiveDelivery: delivery ?? server.defaultDelivery,
      lastCheckedAt: lastCheckedAt?.toISOString() ?? null,
      checking: this.running !== null,
      pendingChecks,
    };
  }

  async setState(user: RequestUser, releaseId: number, state: 'dismissed' | null): Promise<void> {
    if (!(await this.repository.releaseExists(releaseId))) throw new NotFoundException('Release not found');
    await this.repository.setUserState(user.id, releaseId, state);
  }

  async updateUserSettings(user: RequestUser, settings: UpdateNewReleasesUserSettingsPayload): Promise<NewReleasesUserSettings> {
    await this.repository.saveUserSettings(user.id, settings);
    const saved = await this.repository.findUserSettings(user.id);
    // Switching to having books requested picks up what is already listed, not only new finds.
    if (settings.delivery === 'request') this.kick();
    return {
      delivery: (saved?.delivery as NewReleaseDelivery | null) ?? null,
      retentionDays: (saved?.retentionDays ?? DEFAULT_NEW_RELEASE_RETENTION_DAYS) as NewReleaseRetentionDays,
    };
  }

  async updateServerSettings(settings: NewReleasesServerSettings): Promise<NewReleasesServerSettings> {
    await this.appSettings.setValue(DEFAULT_FORMAT_KEY, settings.defaultFormat);
    await this.appSettings.setValue(DEFAULT_DELIVERY_KEY, settings.defaultDelivery);
    if (settings.defaultDelivery === 'request') this.kick();
    return this.serverSettings();
  }

  // ── Requests ────────────────────────────────────────────

  /** Files requests for one listed book, in the formats asked for, as the request form would. */
  async requestRelease(user: RequestUser, releaseId: number, formats: NewReleaseRequestFormat[]): Promise<NewReleaseRequestResult> {
    const release = await this.repository.findReleaseById(releaseId);
    if (!release) throw new NotFoundException('Release not found');
    const dated = formats.filter((format) => formatDate(release, format) !== null);
    if (dated.length === 0) throw new BadRequestException('That format has no confirmed release date yet');
    const requested = await this.fileRequests(user, release, dated);
    if (requested.length === 0) throw new ConflictException('The request could not be filed');
    return { requested };
  }

  private async fileRequests(
    user: RequestUser,
    release: NonNullable<Awaited<ReturnType<NewReleasesRepository['findReleaseById']>>>,
    formats: NewReleaseRequestFormat[],
  ): Promise<NewReleaseRequestFormat[]> {
    const requested: NewReleaseRequestFormat[] = [];
    for (const format of formats) {
      // One at a time rather than as a pair, so a refusal of one format still files the other.
      try {
        await this.bookRequests.submit(requestFor(release, format), user);
        requested.push(format);
      } catch (error) {
        this.logger.warn(
          `[new_releases.request] [fail] userId=${user.id} releaseId=${release.id} format=${format} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - could not file a request`,
        );
        if (formats.length === 1) throw error;
      }
    }
    if (requested.length > 0) await this.repository.setRequested(user.id, release.id);
    return requested;
  }

  /**
   * Files requests for people who chose to have new releases requested for them. Each book is
   * requested once per person; one that fails is left for a day before it is tried again.
   */
  async autoRequest(now: number = Date.now()): Promise<{ filed: number; failed: number }> {
    const server = await this.serverSettings();
    const pending = await this.repository.findPendingAutoRequests(server.defaultDelivery, AUTO_REQUESTS_PER_RUN);
    let filed = 0;
    let failed = 0;
    const users = new Map<number, RequestUser | null>();
    for (const { userId, releaseId } of pending) {
      const key = `${userId}:${releaseId}`;
      if ((this.autoRequestRetryAt.get(key) ?? 0) > now) continue;
      if (!users.has(userId)) users.set(userId, await this.auth.findActingUser(userId));
      const user = users.get(userId);
      const allowed =
        !!user &&
        (user.isSuperuser || (user.permissions.includes(Permission.NewReleasesAccess) && user.permissions.includes(Permission.BookRequestAccess)));
      const release = allowed ? await this.repository.findReleaseById(releaseId) : null;
      const formats = release ? formatsToRequest(release, server.defaultFormat) : [];
      if (!user || !release || formats.length === 0) {
        this.autoRequestRetryAt.set(key, now + AUTO_REQUEST_RETRY_MS);
        continue;
      }
      try {
        const requested = await this.fileRequests(user, release, formats);
        if (requested.length > 0) filed += 1;
        else this.autoRequestRetryAt.set(key, now + AUTO_REQUEST_RETRY_MS);
      } catch {
        failed += 1;
        this.autoRequestRetryAt.set(key, now + AUTO_REQUEST_RETRY_MS);
      }
    }
    if (pending.length > 0) {
      this.logger.log(
        `[new_releases.auto_request] [end] pending=${pending.length} filed=${filed} failed=${failed} - requested new releases for people who asked`,
      );
    }
    return { filed, failed };
  }

  async serverSettings(): Promise<NewReleasesServerSettings> {
    const values = await this.appSettings.getValues([DEFAULT_FORMAT_KEY, DEFAULT_DELIVERY_KEY]);
    const format = values.get(DEFAULT_FORMAT_KEY);
    const delivery = values.get(DEFAULT_DELIVERY_KEY);
    return {
      defaultFormat: (NEW_RELEASE_FORMATS as readonly string[]).includes(format ?? '') ? (format as NewReleaseFormat) : 'both',
      defaultDelivery: (NEW_RELEASE_DELIVERIES as readonly string[]).includes(delivery ?? '') ? (delivery as NewReleaseDelivery) : 'suggest',
    };
  }

  // ── The check ───────────────────────────────────────────

  /** Starts a check soon unless one is running or already queued. */
  kick(delayMs: number = KICK_DELAY_MS): void {
    if (this.running || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.runChecks();
    }, delayMs);
    this.kickTimer.unref();
  }

  /** Hourly: looks up the names that are due, a bounded batch at a time. */
  @Cron('0 41 * * * *')
  async runScheduled(): Promise<void> {
    await this.runChecks();
  }

  /** Resolves when the check in progress, if any, has ended. For tests. */
  async whenIdle(): Promise<void> {
    await this.running;
  }

  runChecks(limit: number = TARGETS_PER_RUN): Promise<void> {
    if (this.running) return this.running;
    this.running = this.checkDue(limit).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async checkDue(limit: number): Promise<void> {
    const startedAt = Date.now();
    const sourceStatus = await this.sources.status();
    const anySource = sourceStatus.hardcover || sourceStatus.audible || sourceStatus.google;
    const targets = anySource ? await this.repository.findDueTargets(RECHECK_DAYS, limit) : [];
    if (targets.length === 0) {
      await this.autoRequestSafely();
      return;
    }

    this.logger.log(`[${EVENT}] [start] targets=${targets.length} - looking up followed authors and series`);
    let found = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        found += await this.checkTarget(target);
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `[${EVENT}] [fail] kind=${target.kind} name="${sanitizeLogValue(target.name)}" errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - one name failed, carrying on`,
        );
      }
    }
    const pruned = await this.repository.pruneReleases(KEEP_RELEASED_DAYS, STALE_DAYS);
    await this.autoRequestSafely();
    this.logger.log(
      `[${EVENT}] [end] durationMs=${Date.now() - startedAt} targets=${targets.length} found=${found} failed=${failed} pruned=${pruned} - lookups done`,
    );
  }

  private async autoRequestSafely(): Promise<void> {
    try {
      await this.autoRequest();
    } catch (error) {
      this.logger.error(
        `[new_releases.auto_request] [fail] errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - requesting new releases stopped`,
      );
    }
  }

  /** Looks up one followed name and saves what it finds. Returns how many books have a date. */
  async checkTarget(target: ReleaseTarget, today: string = todayIso()): Promise<number> {
    const { releases, failedSources, attempted } = await this.sources.lookup(target, today);
    const merged = mergeReleases(releases, today);
    const existing = new Map(
      (await this.repository.findReleasesByWorkKeys(merged.map((release) => release.workKey))).map((row) => [row.workKey, row]),
    );

    let dated = 0;
    for (const release of merged) {
      // Reports saved earlier from other names count too, so a date two lookups agree on is confirmed.
      const earlier = ((existing.get(release.workKey)?.sources as SourceRelease[] | undefined) ?? []).filter(
        (report) => !release.sources.some((fresh) => fresh.source === report.source && fresh.sourceId === report.sourceId),
      );
      const [combined] = mergeReleases([...release.sources, ...earlier], today);
      if (!combined) continue;
      const owned = await this.repository.findOwnedBookId(titleKeys(combined.title), combined.authors);
      await this.repository.upsertRelease(combined, owned);
      if (combined.releaseDate) dated += 1;
    }
    // A name every source failed on is left due, so it is tried again next hour.
    if (failedSources.length < attempted) await this.repository.recordCheck(target, dated);
    return dated;
  }
}
