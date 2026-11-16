import { describe, expect, it } from 'vitest'

import { durationParts, tookSeconds } from '../lib/conversion-time'

describe('conversion time', () => {
  it('rounds to minutes and splits off hours', () => {
    expect(durationParts(20)).toEqual({ kind: 'underMinute' })
    expect(durationParts(25 * 60)).toEqual({ kind: 'minutes', minutes: 25 })
    expect(durationParts(95 * 60)).toEqual({ kind: 'hours', hours: 1, minutes: 35 })
  })

  it('measures from start to finish', () => {
    expect(tookSeconds('2026-11-16T18:00:00Z', '2026-11-16T18:32:00Z')).toBe(1_920)
    expect(tookSeconds(null, '2026-11-16T18:32:00Z')).toBeNull()
  })
})
