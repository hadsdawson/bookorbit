import { ref } from 'vue'
import type { BookFileScanResult } from '@bookorbit/types'
import { api } from '@/lib/api'

/** Fork. Rescans one book's folder from its Files tab and reports what changed. */
export function useBookFileScan() {
  const scanning = ref(false)

  async function scanBookFiles(bookId: number): Promise<BookFileScanResult> {
    scanning.value = true
    try {
      const response = await api(`/api/v1/books/${bookId}/scan-files`, { method: 'POST' })
      if (!response.ok) throw new Error(`Scan failed (${response.status})`)
      return (await response.json()) as BookFileScanResult
    } finally {
      scanning.value = false
    }
  }

  return { scanning, scanBookFiles }
}
