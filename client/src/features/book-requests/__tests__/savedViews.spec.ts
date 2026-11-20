import { describe, expect, it } from 'vitest'

import { DEFAULT_LIST_STATE, savedViewFilters, savedViewPatch } from '../requestListQuery'

describe('saved view filters', () => {
  it('keeps only the filters and sort that differ from the defaults', () => {
    expect(savedViewFilters(DEFAULT_LIST_STATE)).toEqual({})
    expect(savedViewFilters({ ...DEFAULT_LIST_STATE, view: 'finished', q: 'dune', format: 'audiobook', tracking: 'missing', page: 3 })).toEqual({
      format: 'audiobook',
      tracking: 'missing',
    })
    expect(savedViewFilters({ ...DEFAULT_LIST_STATE, sort: 'title', dir: 'desc' })).toEqual({ sort: 'title', dir: 'desc' })
  })

  it('clears every filter a view does not keep when it is applied', () => {
    expect(savedViewPatch({ format: 'ebook' }, true)).toEqual({
      status: '',
      format: 'ebook',
      requester: '',
      approval: '',
      tracking: '',
      sort: 'createdAt',
      dir: 'desc',
      page: 1,
    })
  })

  it('ignores a saved requester for someone who cannot filter by requester', () => {
    expect(savedViewPatch({ requester: 4 }, false).requester).toBe('')
    expect(savedViewPatch({ requester: 4 }, true).requester).toBe(4)
  })
})
