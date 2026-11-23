import { ref } from 'vue'
import type { LibraryFolderRelocationPreview, LibraryFolderRelocationResult } from '@bookorbit/types'
import { apiJson, errorMessage, jsonBody } from '@/lib/api-json'

const FALLBACK_KEY = 'settings.admin.libraries.relocate.failed'

/** Previews and applies a change of where one library folder lives on disk, keeping its books. */
export function useLibraryFolderRelocation(libraryId: number, folderId: number) {
  const preview = ref<LibraryFolderRelocationPreview | null>(null)
  const checking = ref(false)
  const applying = ref(false)
  const error = ref<string | null>(null)

  const base = `/api/v1/libraries/${libraryId}/folders/${folderId}/relocate`

  async function check(newPath: string): Promise<void> {
    checking.value = true
    error.value = null
    preview.value = null
    try {
      preview.value = await apiJson<LibraryFolderRelocationPreview>(`${base}/preview`, jsonBody('POST', { newPath }), FALLBACK_KEY)
    } catch (cause) {
      error.value = errorMessage(cause, FALLBACK_KEY)
    } finally {
      checking.value = false
    }
  }

  async function apply(newPath: string): Promise<boolean> {
    applying.value = true
    error.value = null
    try {
      await apiJson<LibraryFolderRelocationResult>(base, jsonBody('POST', { newPath }), FALLBACK_KEY)
      return true
    } catch (cause) {
      error.value = errorMessage(cause, FALLBACK_KEY)
      return false
    } finally {
      applying.value = false
    }
  }

  function reset(): void {
    preview.value = null
    error.value = null
  }

  return { preview, checking, applying, error, check, apply, reset }
}
