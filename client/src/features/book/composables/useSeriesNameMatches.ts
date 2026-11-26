import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { SeriesNameMatch } from '@bookorbit/types'
import { api } from '@/lib/api'

const DEBOUNCE_MS = 300

/**
 * Fork. Every series with this name, looked up as the name settles, so an editor can show which is
 * which when several share it. A stale answer for an earlier name is dropped.
 */
export function useSeriesNameMatches(name: Ref<string>) {
  const matches = ref<SeriesNameMatch[]>([])
  const loading = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let latest = 0

  async function load(value: string) {
    const ticket = ++latest
    const trimmed = value.trim()
    if (!trimmed) {
      matches.value = []
      loading.value = false
      return
    }
    loading.value = true
    try {
      const response = await api(`/api/v1/series/by-name?name=${encodeURIComponent(trimmed)}`)
      const data = response.ok ? ((await response.json()) as SeriesNameMatch[]) : []
      if (ticket === latest) matches.value = data
    } catch {
      if (ticket === latest) matches.value = []
    } finally {
      if (ticket === latest) loading.value = false
    }
  }

  watch(
    name,
    (value) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(value), DEBOUNCE_MS)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })

  return { matches, loading }
}
