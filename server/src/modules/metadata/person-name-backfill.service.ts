import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PersonNameBackfillRepository } from './person-name-backfill.repository';
/**
 * Fork: rewrites existing author and narrator names from "A. J. Clack" to "A.J. Clack" on every boot.
 * A name whose joined form already belongs to another row is left alone, so the two show up in
 * Tools > Duplicates to merge, rather than being merged here without a person deciding.
 */
@Injectable()
export class PersonNameBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PersonNameBackfillService.name);

  constructor(private readonly repo: PersonNameBackfillRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'person_name.join_initials';
    const startedAt = Date.now();
    try {
      const authorIds = await this.repo.joinAuthorInitials();
      const narratorIds = await this.repo.joinNarratorInitials();
      if (authorIds.length > 0 || narratorIds.length > 0) {
        this.logger.log(
          `[${event}] [end] durationMs=${Date.now() - startedAt} authorsRenamed=${authorIds.length} narratorsRenamed=${narratorIds.length} - initials joined`,
        );
      }
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - joining initials failed`,
      );
    }
  }
}
