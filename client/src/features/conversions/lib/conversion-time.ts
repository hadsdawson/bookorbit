export type DurationParts = { kind: 'underMinute' } | { kind: 'minutes'; minutes: number } | { kind: 'hours'; hours: number; minutes: number }

/** Seconds as a short spoken length: under a minute, minutes, or hours and minutes. */
export function durationParts(seconds: number): DurationParts {
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes < 1) return { kind: 'underMinute' }
  if (totalMinutes < 60) return { kind: 'minutes', minutes: totalMinutes }
  return { kind: 'hours', hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}

/** How long a finished conversion ran, from when it started to when it finished. */
export function tookSeconds(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null
  const ms = Date.parse(finishedAt) - Date.parse(startedAt)
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null
}
