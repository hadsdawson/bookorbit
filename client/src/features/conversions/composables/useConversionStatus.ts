import { ref } from 'vue'

import { getConversionStatus } from '../api/conversions'

const POLL_MS = 20_000

const enabled = ref(false)
const active = ref(0)
let loading: Promise<void> | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null

async function refreshStatus(): Promise<void> {
  try {
    const status = await getConversionStatus()
    enabled.value = status.enabled
    active.value = status.active
  } catch {
    // The sidebar keeps what it last knew; a failed check is retried on the next poll.
  }
}

/** Polls only while conversions are on, so the sidebar count stays current without a socket. */
function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  if (!enabled.value) return
  pollTimer = setTimeout(() => {
    void refreshStatus().then(schedulePoll)
  }, POLL_MS)
}

/** Whether conversions are turned on, which decides if the Conversions tab is shown, and how many are underway. */
export function useConversionStatus() {
  function load(): Promise<void> {
    loading ??= refreshStatus().then(schedulePoll)
    return loading
  }

  function setEnabled(value: boolean): void {
    enabled.value = value
    if (!value) active.value = 0
    schedulePoll()
  }

  function setActive(value: number): void {
    active.value = value
  }

  return { enabled, active, load, setEnabled, setActive }
}
