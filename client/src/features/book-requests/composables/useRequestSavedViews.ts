import { ref } from 'vue'
import type { BookRequestSavedView, BookRequestSavedViewFilters } from '@bookorbit/types'

import { deleteSavedView, listSavedViews, saveSavedView } from '../api/saved-views'

const views = ref<BookRequestSavedView[]>([])
const loaded = ref(false)

function sorted(list: BookRequestSavedView[]): BookRequestSavedView[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Module-level so the views stay put while the filter menu opens and closes. */
export function useRequestSavedViews() {
  async function load(): Promise<void> {
    try {
      views.value = sorted(await listSavedViews())
      loaded.value = true
    } catch {
      // The menu still works without saved views; opening it again tries once more.
    }
  }

  async function save(name: string, filters: BookRequestSavedViewFilters): Promise<BookRequestSavedView> {
    const saved = await saveSavedView(name, filters)
    views.value = sorted([...views.value.filter((view) => view.id !== saved.id), saved])
    return saved
  }

  async function remove(id: number): Promise<void> {
    await deleteSavedView(id)
    views.value = views.value.filter((view) => view.id !== id)
  }

  return { views, loaded, load, save, remove }
}
