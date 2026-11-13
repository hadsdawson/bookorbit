import type { NewReleaseItem } from '@bookorbit/types'

export type ReleaseFormat = 'ebook' | 'audiobook'

/** One book on one day; both formats share an entry when they come out the same day. */
export interface CalendarEntry {
  key: string
  item: NewReleaseItem
  formats: ReleaseFormat[]
}

/** YYYY-MM-DD for a local date. */
export function toDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Each book's ebook and audiobook dates as calendar entries, by day, in list order. */
export function calendarEntries(items: readonly NewReleaseItem[]): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>()
  for (const item of items) {
    const dates = new Map<string, ReleaseFormat[]>()
    if (item.ebookDate) dates.set(item.ebookDate, ['ebook'])
    if (item.audiobookDate) dates.set(item.audiobookDate, [...(dates.get(item.audiobookDate) ?? []), 'audiobook'])
    for (const [day, formats] of dates) {
      byDay.set(day, [...(byDay.get(day) ?? []), { key: `${item.id}:${day}`, item, formats }])
    }
  }
  return byDay
}

/**
 * The weeks shown for a month: from the week holding its first day to the week holding its last,
 * each week starting on `firstDay` (0 = Sunday).
 */
export function monthGrid(monthStart: Date, firstDay: number): Date[][] {
  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const start = new Date(year, month, 1 - ((first.getDay() - firstDay + 7) % 7))
  const weeks: Date[][] = []
  for (let cursor = start; cursor <= last || weeks.length === 0;) {
    const week: Date[] = []
    for (let index = 0; index < 7; index++) {
      week.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + index))
    }
    weeks.push(week)
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)
  }
  return weeks
}
