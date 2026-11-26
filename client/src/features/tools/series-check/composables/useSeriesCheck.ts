import { computed, ref } from 'vue'
import type { SeriesReviewItem, SeriesReviewView, SeriesWaitingBook } from '@bookorbit/types'
import { fetchMixedSeries, fetchWaitingBooks, resolveWaitingSeries, setSeriesMarkedFine } from './series-check-api'

const PAGE_SIZE = 25

/** Fork. Series that look mixed, with the Looks fine / undo views. Pages are 1-based. */
export function useMixedSeries() {
  const view = ref<SeriesReviewView>('open')
  const items = ref<SeriesReviewItem[]>([])
  const counts = ref({ open: 0, fine: 0 })
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(false)
  const busyIds = ref(new Set<number>())
  let token = 0

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

  async function load() {
    const ticket = ++token
    loading.value = true
    error.value = false
    try {
      const data = await fetchMixedSeries({ view: view.value, page: page.value - 1, size: PAGE_SIZE })
      if (ticket !== token) return
      items.value = data.items
      counts.value = data.counts
      total.value = data.total
      if (data.items.length === 0 && page.value > 1 && data.total > 0) {
        page.value = Math.ceil(data.total / PAGE_SIZE)
        await load()
        return
      }
      loaded.value = true
    } catch {
      if (ticket === token) error.value = true
    } finally {
      if (ticket === token) loading.value = false
    }
  }

  async function setView(next: SeriesReviewView) {
    if (next === view.value) return
    view.value = next
    page.value = 1
    await load()
  }

  async function setPage(next: number) {
    page.value = Math.min(Math.max(1, next), totalPages.value)
    await load()
  }

  /** Marks a series fine, or brings it back, then drops it from the view it left. */
  async function setFine(seriesId: number, fine: boolean): Promise<boolean> {
    busyIds.value = new Set(busyIds.value).add(seriesId)
    try {
      await setSeriesMarkedFine(seriesId, fine)
      items.value = items.value.filter((item) => item.id !== seriesId)
      counts.value = fine
        ? { open: Math.max(0, counts.value.open - 1), fine: counts.value.fine + 1 }
        : { open: counts.value.open + 1, fine: Math.max(0, counts.value.fine - 1) }
      total.value = Math.max(0, total.value - 1)
      if (items.value.length === 0 && total.value > 0) await load()
      return true
    } catch {
      return false
    } finally {
      const next = new Set(busyIds.value)
      next.delete(seriesId)
      busyIds.value = next
    }
  }

  function isBusy(seriesId: number) {
    return busyIds.value.has(seriesId)
  }

  return { view, items, counts, total, page, totalPages, loading, loaded, error, load, setView, setPage, setFine, isBusy }
}

function waitingKey(book: Pick<SeriesWaitingBook, 'bookId' | 'displayOrder'>) {
  return `${book.bookId}:${book.displayOrder}`
}

/** Fork. Books whose series name matches several series, picked one at a time. Pages are 1-based. */
export function useWaitingSeriesBooks() {
  const items = ref<SeriesWaitingBook[]>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(false)
  const busyKeys = ref(new Set<string>())
  let token = 0

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

  async function load() {
    const ticket = ++token
    loading.value = true
    error.value = false
    try {
      const data = await fetchWaitingBooks({ page: page.value - 1, size: PAGE_SIZE })
      if (ticket !== token) return
      items.value = data.items
      total.value = data.total
      if (data.items.length === 0 && page.value > 1 && data.total > 0) {
        page.value = Math.ceil(data.total / PAGE_SIZE)
        await load()
        return
      }
      loaded.value = true
    } catch {
      if (ticket === token) error.value = true
    } finally {
      if (ticket === token) loading.value = false
    }
  }

  async function setPage(next: number) {
    page.value = Math.min(Math.max(1, next), totalPages.value)
    await load()
  }

  /** Saves the pick and drops the row once the name is no longer waiting. */
  async function resolve(book: SeriesWaitingBook, choice: { seriesId: number } | { newSeries: true }): Promise<boolean> {
    const key = waitingKey(book)
    busyKeys.value = new Set(busyKeys.value).add(key)
    try {
      const detail = await resolveWaitingSeries({ bookId: book.bookId, displayOrder: book.displayOrder, ...choice })
      const stillWaiting = (detail.pendingSeries ?? []).some(
        (entry) => entry.seriesName === book.seriesName && entry.displayOrder === book.displayOrder,
      )
      if (!stillWaiting) {
        items.value = items.value.filter((item) => waitingKey(item) !== key)
        total.value = Math.max(0, total.value - 1)
        if (items.value.length === 0 && total.value > 0) await load()
      }
      return !stillWaiting
    } catch {
      return false
    } finally {
      const next = new Set(busyKeys.value)
      next.delete(key)
      busyKeys.value = next
    }
  }

  function isBusy(book: SeriesWaitingBook) {
    return busyKeys.value.has(waitingKey(book))
  }

  return { items, total, page, totalPages, loading, loaded, error, load, setPage, resolve, isBusy, waitingKey }
}
