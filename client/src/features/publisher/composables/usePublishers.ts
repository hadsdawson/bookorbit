import { ref } from 'vue'
import type { BrowseEntityItem, BrowseEntitySortBy, BrowseEntitySortOrder } from '@bookorbit/types'

import { browseEntities, mergeEntities, renameEntity } from '@/features/tools/api/entity-manager'

export const PUBLISHER_PAGE_SIZE = 50

/**
 * Publishers are plain text on each book, not records of their own, so a publisher is identified
 * by its name. Listing, renaming and merging go through the Entity Manager's endpoints, which
 * already handle that and write to the book files when asked.
 */
export function usePublishers() {
  const items = ref<BrowseEntityItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const search = ref('')
  const sortBy = ref<BrowseEntitySortBy>('name')
  const sortOrder = ref<BrowseEntitySortOrder>('asc')
  const loading = ref(false)
  const failed = ref(false)
  const working = ref(false)
  let generation = 0

  async function load(): Promise<void> {
    const current = ++generation
    loading.value = true
    try {
      const response = await browseEntities('publisher', {
        search: search.value.trim() || undefined,
        page: page.value,
        pageSize: PUBLISHER_PAGE_SIZE,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value,
      })
      if (current !== generation) return
      items.value = response.items
      total.value = response.total
      failed.value = false
    } catch {
      if (current !== generation) return
      items.value = []
      total.value = 0
      failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function rename(currentName: string, newName: string, writeFiles: boolean): Promise<void> {
    working.value = true
    try {
      await renameEntity('publisher', { currentValue: currentName, newName, writeFiles })
    } finally {
      working.value = false
    }
  }

  async function merge(target: string, sources: string[], writeFiles: boolean): Promise<void> {
    working.value = true
    try {
      await mergeEntities('publisher', { targetValue: target, sourceValues: sources, writeFiles })
    } finally {
      working.value = false
    }
  }

  return { items, total, page, search, sortBy, sortOrder, loading, failed, working, load, rename, merge }
}
