import { onScopeDispose, ref, type Ref } from 'vue'

const TICK_MS = 30_000
/** Fork: past this, a step that normally takes seconds is shown as slow. The server gives up at 20 minutes. */
export const SLOW_STEP_MS = 10 * 60_000

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
let users = 0

/** Fork: one shared clock for every Book Dock row that shows how long it has been on a step. */
export function useProcessingClock(): Ref<number> {
  users += 1
  if (!timer) {
    now.value = Date.now()
    timer = setInterval(() => {
      now.value = Date.now()
    }, TICK_MS)
  }
  onScopeDispose(() => {
    users -= 1
    if (users === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  })
  return now
}

/** Whole minutes since `since`, never negative. */
export function minutesSince(since: string, nowMs: number): number {
  const startedMs = Date.parse(since)
  if (!Number.isFinite(startedMs)) return 0
  return Math.max(0, Math.floor((nowMs - startedMs) / 60_000))
}
