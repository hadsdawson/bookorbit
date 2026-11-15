import type { LocationQuery } from 'vue-router'

import type { AuthorFilterParams } from '../api/author'
import { RECENTLY_ADDED_DAYS, type AuthorListSort, type AuthorQuickFilter, type SortDirection } from '../types/author'

export function parseSort(value: unknown): AuthorListSort {
  return value === 'sortName' || value === 'bookCount' || value === 'lastAddedAt' || value === 'lastEnrichedAt' || value === 'name' ? value : 'name'
}

export function parseOrder(value: unknown): SortDirection {
  return value === 'desc' || value === 'asc' ? value : 'asc'
}

export function parseLibraryId(value: unknown): number | null {
  const raw = typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

export function parseQuickFilter(value: unknown): AuthorQuickFilter {
  return value === 'noPortrait' || value === 'multipleBooks' || value === 'recentlyAdded' || value === 'noSortName' ? value : 'all'
}

/** The list filters each quick filter chip stands for. */
export function quickFilterParams(
  filter: AuthorQuickFilter,
): Required<Pick<AuthorFilterParams, 'hasPhoto' | 'minBookCount' | 'addedWithinDays' | 'hasSortName'>> {
  return {
    hasPhoto: filter === 'noPortrait' ? false : null,
    minBookCount: filter === 'multipleBooks' ? 2 : null,
    addedWithinDays: filter === 'recentlyAdded' ? RECENTLY_ADDED_DAYS : null,
    hasSortName: filter === 'noSortName' ? false : null,
  }
}

/**
 * Fork: the Authors list's sort and filters as its address holds them, so an author page opened
 * from the list can step to the authors on either side of it in that same list.
 */
export function authorListParamsFromQuery(query: LocationQuery): AuthorFilterParams & { sort: AuthorListSort; order: SortDirection } {
  const q = typeof query.q === 'string' ? query.q.trim() : ''
  return {
    q: q || undefined,
    sort: parseSort(query.sort),
    order: parseOrder(query.order),
    libraryId: parseLibraryId(query.libraryId),
    ...quickFilterParams(parseQuickFilter(query.filter)),
  }
}
