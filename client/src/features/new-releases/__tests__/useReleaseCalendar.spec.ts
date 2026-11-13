import { describe, expect, it } from 'vitest'
import type { NewReleaseItem } from '@bookorbit/types'

import { calendarEntries, monthGrid, toDayKey } from '../composables/useReleaseCalendar'

function item(id: number, ebookDate: string | null, audiobookDate: string | null): NewReleaseItem {
  return {
    id,
    title: `Book ${id}`,
    authors: ['Jane Writer'],
    seriesName: null,
    seriesIndex: null,
    coverUrl: null,
    ebookDate,
    audiobookDate,
    releaseDate: [ebookDate, audiobookDate].filter((date): date is string => !!date).sort()[0]!,
    matchedFollows: [],
    state: null,
  }
}

describe('release calendar', () => {
  it('puts each format on its own day, and both on one entry when they share a day', () => {
    const byDay = calendarEntries([item(1, '2027-03-09', '2027-03-16'), item(2, '2027-03-09', '2027-03-09')])
    expect(byDay.get('2027-03-09')!.map((entry) => [entry.item.id, entry.formats])).toEqual([
      [1, ['ebook']],
      [2, ['ebook', 'audiobook']],
    ])
    expect(byDay.get('2027-03-16')!.map((entry) => entry.formats)).toEqual([['audiobook']])
  })

  it('lays a month out in whole weeks from the chosen first day', () => {
    const sundayFirst = monthGrid(new Date(2027, 2, 1), 0)
    expect(toDayKey(sundayFirst[0]![0]!)).toBe('2027-02-28')
    expect(toDayKey(sundayFirst.at(-1)!.at(-1)!)).toBe('2027-04-03')
    expect(sundayFirst).toHaveLength(5)

    const mondayFirst = monthGrid(new Date(2027, 2, 1), 1)
    expect(toDayKey(mondayFirst[0]![0]!)).toBe('2027-03-01')
  })
})
