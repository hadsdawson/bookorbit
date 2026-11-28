import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Permission, type SeriesBookItem, type SeriesBooksResult } from '@bookorbit/types'

import { usePermissions } from '@/features/auth/composables/usePermissions'
import { i18n } from '@/i18n'
import { errorMessage } from '@/lib/api-json'
import { getSeriesBooks, requestSeriesBooks } from '../api/new-releases'

export interface SeriesTarget {
  name: string
  author?: string | null
}

/** Shared, so the request form and the request drawer open the one pop-up the requests page holds. */
const target = ref<SeriesTarget | null>(null)
/** Opened after a request: worded as an offer rather than as a list someone asked to see. */
const prompted = ref(false)
const result = ref<SeriesBooksResult | null>(null)
const loading = ref(false)
const failed = ref(false)
const busyKeys = ref<Set<string>>(new Set())
let generation = 0

function sameTarget(a: SeriesTarget | null, b: SeriesTarget): boolean {
  return !!a && a.name === b.name && (a.author ?? null) === (b.author ?? null)
}

/** Fork: the series pop-up on a request. Lists the other books of a series and requests them. */
export function useSeriesBooks() {
  // The global translator: the request form calls `offerSeries` after an await, outside setup.
  const t = i18n.global.t
  const { hasPermission } = usePermissions()
  const allowed = computed(() => hasPermission(Permission.NewReleasesAccess))
  const canRequest = computed(() => allowed.value && hasPermission(Permission.BookRequestAccess))
  const open = computed(() => target.value !== null)
  const missing = computed<SeriesBookItem[]>(() => result.value?.books.filter((book) => book.status === 'missing') ?? [])
  const bulkBusy = computed(() => busyKeys.value.size > 1)

  async function load(next: SeriesTarget): Promise<SeriesBooksResult | null> {
    const current = ++generation
    loading.value = true
    failed.value = false
    try {
      const found = await getSeriesBooks(next.name, next.author)
      if (current !== generation) return null
      result.value = found
      return found
    } catch {
      if (current === generation) failed.value = true
      return null
    } finally {
      if (current === generation) loading.value = false
    }
  }

  /** Opens the pop-up for a series someone clicked. */
  function showSeries(next: SeriesTarget): void {
    if (!allowed.value || !next.name.trim()) return
    if (!sameTarget(target.value, next)) result.value = null
    prompted.value = false
    target.value = next
    void load(next)
  }

  /**
   * After a request: looks the series up quietly and opens the pop-up only when some book of it is
   * still missing, so a finished series never interrupts.
   */
  async function offerSeries(next: SeriesTarget): Promise<void> {
    if (!canRequest.value || !next.name.trim() || target.value) return
    const found = await load(next)
    if (!found || target.value || !found.books.some((book) => book.status === 'missing')) return
    prompted.value = true
    target.value = next
  }

  function close(): void {
    generation += 1
    target.value = null
    prompted.value = false
    loading.value = false
    busyKeys.value = new Set()
  }

  async function request(keys: string[]): Promise<void> {
    const current = target.value
    if (!current || keys.length === 0 || busyKeys.value.size > 0) return
    busyKeys.value = new Set(keys)
    try {
      const outcome = await requestSeriesBooks(current.name, current.author, keys)
      if (!sameTarget(target.value, current)) return
      if (outcome.requested.length === 1 && keys.length === 1) {
        const title = result.value?.books.find((book) => book.key === outcome.requested[0])?.title ?? ''
        toast.success(t('newReleases.seriesBooks.requestedOne', { title }))
      } else if (outcome.requested.length > 0) {
        toast.success(t('newReleases.seriesBooks.requestedMany', { count: outcome.requested.length }))
      }
      if (outcome.failed.length > 0) toast.error(t('newReleases.seriesBooks.someFailed', { count: outcome.failed.length }))
      await load(current)
    } catch (error) {
      toast.error(errorMessage(error, 'newReleases.seriesBooks.requestFailed'))
    } finally {
      if (sameTarget(target.value, current)) busyKeys.value = new Set()
    }
  }

  function requestOne(key: string): Promise<void> {
    return request([key])
  }

  function requestAllMissing(): Promise<void> {
    return request(missing.value.map((book) => book.key))
  }

  function retry(): void {
    if (target.value) void load(target.value)
  }

  return {
    allowed,
    canRequest,
    open,
    target,
    prompted,
    result,
    loading,
    failed,
    busyKeys,
    bulkBusy,
    missing,
    showSeries,
    offerSeries,
    close,
    requestOne,
    requestAllMissing,
    retry,
  }
}
