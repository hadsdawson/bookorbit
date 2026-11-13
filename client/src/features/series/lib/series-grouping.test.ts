// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SeriesSummary } from '@bookorbit/types'

import { groupSeries } from './series-grouping'

const labels = { inProgress: 'In progress', hasGaps: 'Has gaps', notStarted: 'Not started', complete: 'Complete' }

function series(name: string): SeriesSummary {
  return { id: name.length, name } as SeriesSummary
}

describe('groupSeries by letter', () => {
  it('files a name under the letter after a leading "The", "A" or "An", as the list is sorted', () => {
    const groups = groupSeries(
      [series('The Expanse'), series('A Song of Ice and Fire'), series('Discworld'), series('Theodore Boone'), series('1632')],
      'letter',
      labels,
    )
    expect(groups.map((group) => [group.label, group.items.map((item) => item.name)])).toEqual([
      ['D', ['Discworld']],
      ['E', ['The Expanse']],
      ['S', ['A Song of Ice and Fire']],
      ['T', ['Theodore Boone']],
      ['#', ['1632']],
    ])
  })
})
