import { ref } from 'vue'

export interface ScanChangesTarget {
  libraryId: number
  libraryName: string
  jobId: number
}

const target = ref<ScanChangesTarget | null>(null)

/** Shared by the scan toast and the history table, which both open the same single dialog. */
export function useScanChangesViewer() {
  function open(next: ScanChangesTarget) {
    target.value = next
  }

  function close() {
    target.value = null
  }

  return { target, open, close }
}
