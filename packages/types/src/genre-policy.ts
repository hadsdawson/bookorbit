/**
 * A server-wide list of the only genres books may carry. Off by default. While on, every genre
 * written to a book is matched to this list ignoring case, and anything not on it is dropped.
 */
export interface GenrePolicy {
  enabled: boolean;
  genres: string[];
}

export type UpdateGenrePolicyPayload = Partial<GenrePolicy>;

export const GENRE_POLICY_SETTING_KEYS = {
  ENABLED: "metadata_allowed_genres_enabled",
  GENRES: "metadata_allowed_genres",
} as const;

export const MAX_ALLOWED_GENRES = 500;
export const MAX_ALLOWED_GENRE_LENGTH = 200;

/**
 * Trims, drops blanks and case-insensitive duplicates, keeping the first spelling of each, so the
 * list a person typed is the list stored.
 */
export function normalizeAllowedGenres(genres: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of genres) {
    const name = raw.trim().slice(0, MAX_ALLOWED_GENRE_LENGTH);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** The allowed spelling of `name`, or null when the policy does not allow it. */
export function matchAllowedGenre(name: string, allowed: readonly string[]): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return allowed.find((genre) => genre.toLowerCase() === key) ?? null;
}
