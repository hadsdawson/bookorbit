import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookDockRepository } from './book-dock.repository';

/** Throttles the check on the list path, which runs on every page load and refresh. */
const RECHECK_MS = 60_000;

/**
 * With one library holding one folder there is nowhere else a docked file could go, so asking
 * the person to pick it is a step with only one answer. Files with no destination are given that
 * one; a file someone already pointed somewhere keeps its destination. Any second library or
 * folder turns this off, and files assigned before then keep what they were given.
 */
@Injectable()
export class BookDockDefaultTargetService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookDockDefaultTargetService.name);
  private lastCheckedAt = 0;

  constructor(private readonly repo: BookDockRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.apply();
  }

  /** Called on each list load; does real work at most once a minute. */
  async applyThrottled(): Promise<void> {
    if (Date.now() - this.lastCheckedAt < RECHECK_MS) return;
    await this.apply();
  }

  /** Called right after a file arrives, so a new file never shows as missing a destination. */
  async apply(): Promise<void> {
    this.lastCheckedAt = Date.now();
    const startedAt = Date.now();
    try {
      const target = await this.repo.findSoleLibraryTarget();
      if (!target) return;
      const assigned = await this.repo.assignTargetToUnassigned(target.libraryId, target.folderId);
      if (assigned > 0) {
        this.logger.log(
          `[book_dock.default_target] [end] libraryId=${target.libraryId} folderId=${target.folderId} durationMs=${Date.now() - startedAt} assigned=${assigned} - docked files given the only library`,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `[book_dock.default_target] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.constructor.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - could not assign the only library`,
      );
    }
  }
}
