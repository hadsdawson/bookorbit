import { computed, ref } from 'vue'
import type { LibraryScanChange, LibraryScanChangesPage, LibraryScanChangeType } from '@bookorbit/types'
import { api } from '@/lib/api'

const PAGE_SIZE = 50

/** Pages through the books one scan touched, optionally narrowed to a single kind of change. */
export function useScanChanges(libraryId: number, jobId: number) {
  const items = ref<LibraryScanChange[]>([])
  const total = ref(0)
  const truncated = ref(false)
  const loading = ref(false)
  const failed = ref(false)
  const type = ref<LibraryScanChangeType | null>(null)
  /** Bumped when the filter changes so a slow response for the old filter cannot overwrite the new list. */
  let generation = 0

  const hasMore = computed(() => items.value.length < total.value)

  async function fetchPage(reset: boolean): Promise<void> {
    const requestGeneration = ++generation
    loading.value = true
    failed.value = false
    const offset = reset ? 0 : items.value.length
    const query = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) })
    if (type.value) query.set('type', type.value)
    try {
      const res = await api(`/api/v1/scanner/libraries/${libraryId}/scans/${jobId}/changes?${query.toString()}`)
      if (!res.ok) throw new Error('Failed to load scan changes')
      const page = (await res.json()) as LibraryScanChangesPage
      if (requestGeneration !== generation) return
      const pageItems = Array.isArray(page.items) ? page.items : []
      items.value = reset ? pageItems : [...items.value, ...pageItems]
      total.value = typeof page.total === 'number' ? page.total : items.value.length
      truncated.value = page.truncated === true
    } catch {
      if (requestGeneration === generation) failed.value = true
    } finally {
      if (requestGeneration === generation) loading.value = false
    }
  }

  function load(): Promise<void> {
    return fetchPage(true)
  }

  function loadMore(): Promise<void> {
    if (loading.value || !hasMore.value) return Promise.resolve()
    return fetchPage(false)
  }

  function setType(next: LibraryScanChangeType | null): Promise<void> {
    type.value = next
    return fetchPage(true)
  }

  return { items, total, truncated, loading, failed, type, hasMore, load, loadMore, setType }
}
