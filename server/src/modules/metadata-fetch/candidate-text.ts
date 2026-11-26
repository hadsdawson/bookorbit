import type { MetadataCandidate } from '@bookorbit/types';

import { normalizeMetadataText } from '../../common/utils/metadata-text-normalize.utils';
import { normalizePersonName } from '../../common/utils/person-name.utils';

/** Zero-width space, word joiner and byte-order mark: invisible, yet they keep two names from matching. */
const INVISIBLE = /[\u200B\u2060\uFEFF]/g;

const TEXT_FIELDS = ['title', 'subtitle', 'publisher', 'seriesName'] as const;

/**
 * Fork. Provider pages often carry non-breaking, doubled or invisible spaces ("Hank\u00a0 Green").
 * BookOrbit tidies names that way when it saves them, but a candidate is shown and compared before
 * that, so it showed a doubled space and a change that saving would undo. Candidates are tidied the
 * same way as they come in, live or from the cache.
 */
export function tidyCandidateText(candidate: MetadataCandidate): MetadataCandidate {
  const tidied: MetadataCandidate = { ...candidate };
  for (const field of TEXT_FIELDS) {
    const value = candidate[field];
    if (typeof value !== 'string') continue;
    const tidy = normalizeMetadataText(value.replace(INVISIBLE, ''));
    if (tidy) tidied[field] = tidy;
    else delete tidied[field];
  }
  if (Array.isArray(candidate.authors)) tidied.authors = tidyNames(candidate.authors);
  if (Array.isArray(candidate.narrators)) tidied.narrators = tidyNames(candidate.narrators);
  return tidied;
}

function tidyNames(names: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const tidy = normalizePersonName(name.replace(INVISIBLE, ''));
    if (!tidy || seen.has(tidy.toLowerCase())) continue;
    seen.add(tidy.toLowerCase());
    out.push(tidy);
  }
  return out;
}
