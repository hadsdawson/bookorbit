import { onScopeDispose, ref } from 'vue'
import type { FolderFilesEstimate, FolderFilesStatus } from '@bookorbit/types'
import { api } from '@/lib/api'

const POLL_MS = 2_000

/** The estimate, start and progress of writing folder files for a whole library. */
export function useFolderFilesBackfill(libraryId: number) {
  const estimate = ref<FolderFilesEstimate | null>(null)
  const status = ref<FolderFilesStatus | null>(null)
  const loading = ref(false)
  const error = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function loadEstimate(): Promise<void> {
    loading.value = true
    error.value = false
    try {
      const res = await api(`/api/v1/libraries/${libraryId}/folder-files/estimate`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      estimate.value = (await res.json()) as FolderFilesEstimate
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  async function start(): Promise<void> {
    error.value = false
    try {
      const res = await api(`/api/v1/libraries/${libraryId}/folder-files/write-all`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      status.value = (await res.json()) as FolderFilesStatus
      schedulePoll()
    } catch {
      error.value = true
    }
  }

  async function poll(): Promise<void> {
    timer = null
    try {
      const res = await api(`/api/v1/libraries/${libraryId}/folder-files/status`)
      if (res.ok) status.value = ((await res.json()) as { status: FolderFilesStatus | null }).status
    } catch {
      // A missed poll is retried on the next tick.
    }
    if (status.value?.running) schedulePoll()
  }

  function schedulePoll(): void {
    if (timer === null) timer = setTimeout(() => void poll(), POLL_MS)
  }

  function stop(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  onScopeDispose(stop)

  return { estimate, status, loading, error, loadEstimate, start, stop }
}

/** Which unit reads best for a rough range: under a minute, minutes, or hours. */
export function describeEstimate(seconds: { low: number; high: number }): { key: 'underMinute' | 'minutes' | 'hours'; low: number; high: number } {
  if (seconds.high < 60) return { key: 'underMinute', low: 0, high: 0 }
  if (seconds.high < 90 * 60) {
    return { key: 'minutes', low: Math.max(1, Math.round(seconds.low / 60)), high: Math.max(1, Math.round(seconds.high / 60)) }
  }
  return { key: 'hours', low: Math.max(1, Math.round(seconds.low / 3600)), high: Math.max(1, Math.round(seconds.high / 3600)) }
}
