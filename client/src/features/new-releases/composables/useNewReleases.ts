import { computed, ref } from 'vue'
import type {
  NewReleaseItem,
  NewReleaseRequestFormat,
  NewReleasesOverview,
  ReleaseFollow,
  ReleaseFollowKind,
  UpdateNewReleasesUserSettingsPayload,
} from '@bookorbit/types'

import {
  followAllForReleases,
  getNewReleases,
  listReleaseFollows,
  setNewReleaseHidden,
  requestNewRelease,
  saveNewReleasesSettings,
  unfollowForReleases,
} from '../api/new-releases'

export const FOLLOW_PAGE_SIZE = 50

export type ReleaseView = 'list' | 'calendar'
const VIEW_KEY = 'bookorbit.newReleases.view'

/** The last view this browser used; per viewer, so it lives in the browser. */
export function readReleaseView(): ReleaseView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

export function saveReleaseView(view: ReleaseView): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // A view that cannot be remembered still applies now.
  }
}

/** Whether a release date has passed, by the local calendar. */
export function isReleased(releaseDate: string, today: Date = new Date()): boolean {
  return parseReleaseDate(releaseDate) <= new Date(today.getFullYear(), today.getMonth(), today.getDate())
}

export interface ReleaseMonthGroup {
  key: string
  date: Date
  items: NewReleaseItem[]
}

/** YYYY-MM-DD as a local date, so a release never shows as the day before in a western time zone. */
export function parseReleaseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

/** Releases grouped by the month they come out, soonest first. The list arrives sorted. */
export function groupByMonth(items: readonly NewReleaseItem[]): ReleaseMonthGroup[] {
  const groups: ReleaseMonthGroup[] = []
  for (const item of items) {
    const key = item.releaseDate.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(item)
    else groups.push({ key, date: parseReleaseDate(`${key}-01`), items: [item] })
  }
  return groups
}

export function useNewReleases() {
  const overview = ref<NewReleasesOverview | null>(null)
  const loading = ref(false)
  const failed = ref(false)

  const groups = computed(() => groupByMonth(overview.value?.items ?? []))
  const followTotal = computed(() => (overview.value ? overview.value.followCounts.author + overview.value.followCounts.series : 0))
  const anySource = computed(() => {
    const sources = overview.value?.sources
    return !!sources && (sources.hardcover || sources.audible || sources.google)
  })

  async function load(): Promise<void> {
    loading.value = true
    try {
      overview.value = await getNewReleases()
      failed.value = false
    } catch {
      failed.value = true
    } finally {
      loading.value = false
    }
  }

  async function hide(item: NewReleaseItem): Promise<void> {
    await setNewReleaseHidden(item.id, true)
    if (overview.value) overview.value = { ...overview.value, items: overview.value.items.filter((entry) => entry.id !== item.id) }
  }

  async function unhide(item: NewReleaseItem): Promise<void> {
    await setNewReleaseHidden(item.id, false)
    await load()
  }

  async function followAll(kind: ReleaseFollowKind): Promise<number> {
    const { added } = await followAllForReleases(kind)
    await load()
    return added
  }

  /** Fetched again afterwards: a shorter period lists fewer books, and the delivery in effect may change. */
  async function saveSettings(settings: UpdateNewReleasesUserSettingsPayload): Promise<void> {
    await saveNewReleasesSettings(settings)
    await load()
  }

  async function request(item: NewReleaseItem, formats: NewReleaseRequestFormat[]): Promise<NewReleaseRequestFormat[]> {
    const { requested } = await requestNewRelease(item.id, formats)
    if (overview.value) {
      overview.value = {
        ...overview.value,
        items: overview.value.items.map((entry) => (entry.id === item.id ? { ...entry, state: 'requested' as const } : entry)),
      }
    }
    return requested
  }

  return { overview, loading, failed, groups, followTotal, anySource, load, hide, unhide, followAll, saveSettings, request }
}

/** The Following tab: a searchable, paged list of what this user follows. */
export function useReleaseFollowList() {
  const items = ref<ReleaseFollow[]>([])
  const total = ref(0)
  const kind = ref<ReleaseFollowKind | 'all'>('all')
  const search = ref('')
  const loading = ref(false)
  const failed = ref(false)
  let generation = 0

  async function load(append = false): Promise<void> {
    const current = ++generation
    loading.value = true
    try {
      const page = await listReleaseFollows({
        kind: kind.value === 'all' ? undefined : kind.value,
        search: search.value.trim() || undefined,
        offset: append ? items.value.length : 0,
        limit: FOLLOW_PAGE_SIZE,
      })
      if (current !== generation) return
      items.value = append ? [...items.value, ...page.items] : page.items
      total.value = page.total
      failed.value = false
    } catch {
      if (current === generation) failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function remove(follow: ReleaseFollow): Promise<void> {
    await unfollowForReleases(follow.id)
    items.value = items.value.filter((entry) => entry.id !== follow.id)
    total.value = Math.max(0, total.value - 1)
  }

  const hasMore = computed(() => items.value.length < total.value)

  return { items, total, kind, search, loading, failed, hasMore, load, remove }
}
