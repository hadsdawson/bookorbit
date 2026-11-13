import { describe, expect, it } from 'vitest'
import type { NewReleaseItem } from '@bookorbit/types'

import { groupByMonth, parseReleaseDate } from '../composables/useNewReleases'

function item(id: number, releaseDate: string): NewReleaseItem {
  return {
    id,
    title: `Book ${id}`,
    authors: ['Jane Writer'],
    seriesName: null,
    seriesIndex: null,
    coverUrl: null,
    ebookDate: releaseDate,
    audiobookDate: null,
    releaseDate,
    matchedFollows: [{ kind: 'author', name: 'Jane Writer' }],
    state: null,
  }
}

describe('new releases grouping', () => {
  it('reads a release date as a local day', () => {
    const date = parseReleaseDate('2027-03-09')
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2027, 2, 9])
  })

  it('groups a sorted list by month, soonest first', () => {
    const groups = groupByMonth([item(1, '2027-03-09'), item(2, '2027-03-30'), item(3, '2027-05-01')])
    expect(groups.map((group) => [group.key, group.items.map((entry) => entry.id)])).toEqual([
      ['2027-03', [1, 2]],
      ['2027-05', [3]],
    ])
  })
})
