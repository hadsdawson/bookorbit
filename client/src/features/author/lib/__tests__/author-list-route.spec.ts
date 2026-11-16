import { describe, expect, it } from 'vitest'

import { authorListParamsFromQuery } from '../author-list-route'

describe('authorListParamsFromQuery', () => {
  it('reads the Authors list address into the same filters the list sends', () => {
    expect(authorListParamsFromQuery({ q: ' king ', sort: 'lastAddedAt', order: 'desc', libraryId: '3', filter: 'recentlyAdded' })).toEqual({
      q: 'king',
      sort: 'lastAddedAt',
      order: 'desc',
      libraryId: 3,
      hasPhoto: null,
      minBookCount: null,
      addedWithinDays: 7,
      hasSortName: null,
    })
  })

  it('falls back to the plain A-Z list for anything it does not know', () => {
    expect(authorListParamsFromQuery({ sort: 'nonsense', order: 'sideways', libraryId: 'x', filter: 'odd' })).toEqual({
      q: undefined,
      sort: 'name',
      order: 'asc',
      libraryId: null,
      hasPhoto: null,
      minBookCount: null,
      addedWithinDays: null,
      hasSortName: null,
    })
  })
})
