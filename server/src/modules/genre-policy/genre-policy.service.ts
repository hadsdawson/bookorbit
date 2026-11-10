import { Injectable, Logger } from '@nestjs/common';
import { GENRE_POLICY_SETTING_KEYS, matchAllowedGenre, normalizeAllowedGenres } from '@bookorbit/types';
import type { GenrePolicy, UpdateGenrePolicyPayload } from '@bookorbit/types';

import { AppSettingsService } from '../app-settings/app-settings.service';

const KEYS = GENRE_POLICY_SETTING_KEYS;
/** Genres are written once per book during bulk refreshes, so the policy is read once per window rather than per book. */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class GenrePolicyService {
  private readonly logger = new Logger(GenrePolicyService.name);
  private cached: { policy: GenrePolicy; at: number } | null = null;

  constructor(private readonly appSettings: AppSettingsService) {}

  async get(): Promise<GenrePolicy> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) return this.cached.policy;
    const values = await this.appSettings.getValues([KEYS.ENABLED, KEYS.GENRES]);
    const policy: GenrePolicy = {
      enabled: values.get(KEYS.ENABLED) === 'true',
      genres: parseGenres(values.get(KEYS.GENRES)),
    };
    this.cached = { policy, at: Date.now() };
    return policy;
  }

  async update(payload: UpdateGenrePolicyPayload): Promise<GenrePolicy> {
    const writes: Array<Promise<void>> = [];
    if (payload.enabled !== undefined) writes.push(this.appSettings.setValue(KEYS.ENABLED, String(payload.enabled)));
    if (payload.genres !== undefined) writes.push(this.appSettings.setValue(KEYS.GENRES, JSON.stringify(normalizeAllowedGenres(payload.genres))));
    await Promise.all(writes);
    this.cached = null;
    const policy = await this.get();
    this.logger.log(`[genre_policy.update] [end] enabled=${policy.enabled} genres=${policy.genres.length} - allowed genres updated`);
    return policy;
  }

  /**
   * The genres a book may be given: unchanged while the policy is off, otherwise only the allowed
   * ones, in their allowed spelling. An enabled policy with an empty list allows nothing.
   */
  async filter(names: readonly string[]): Promise<string[]> {
    const policy = await this.get();
    if (!policy.enabled) return [...names];
    const kept: string[] = [];
    for (const name of names) {
      const match = matchAllowedGenre(name, policy.genres);
      if (match && !kept.includes(match)) kept.push(match);
    }
    return kept;
  }
}

function parseGenres(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeAllowedGenres(parsed.filter((entry): entry is string => typeof entry === 'string')) : [];
  } catch {
    return [];
  }
}
