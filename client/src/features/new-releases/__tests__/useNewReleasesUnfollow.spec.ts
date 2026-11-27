import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewReleaseItem, NewReleaseMatchedFollow, NewReleasesOverview } from '@bookorbit/types'

const unfollowForReleases = vi.fn<(id: number) => Promise<void>>()
const followForReleases = vi.fn<(input: unknown) => Promise<unknown>>()
const getNewReleases = vi.fn<(...args: unknown[]) => Promise<unknown>>()

vi.mock('../api/new-releases', () => ({
  getNewReleases: (...args: unknown[]) => getNewReleases(...args),
  requestNewRelease: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setNewReleaseHidden: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  followAllForReleases: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  saveNewReleasesSettings: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  unfollowForReleases: (id: number) => unfollowForReleases(id),
  followForReleases: (input: unknown) => followForReleases(input),
}))

import { useNewReleases } from '../composables/useNewReleases'

const author: NewReleaseMatchedFollow = { id: 1, kind: 'author', name: 'Jane Writer' }
const series: NewReleaseMatchedFollow = { id: 2, kind: 'series', name: 'The Saga' }

function item(id: number, matchedFollows: NewReleaseMatchedFollow[]): NewReleaseItem {
  return {
    id,
    title: `Book ${id}`,
    authors: ['Jane Writer'],
    authorLinks: [{ name: 'Jane Writer', authorId: 7 }],
    seriesId: null,
    providerIds: {},
    isbn13: null,
    seriesName: null,
    seriesIndex: null,
    coverUrl: null,
    ebookDate: '2027-03-09',
    audiobookDate: null,
    releaseDate: '2027-03-09',
    matchedFollows,
    state: null,
  }
}

describe('unfollowing from a new release', () => {
  beforeEach(() => {
    unfollowForReleases.mockReset().mockResolvedValue(undefined)
    followForReleases.mockReset().mockResolvedValue({})
    getNewReleases.mockReset().mockResolvedValue({ items: [] })
  })

  function withItems() {
    const releases = useNewReleases()
    releases.overview.value = {
      items: [item(1, [author]), item(2, [author, series]), item(3, [series])],
      followCounts: { author: 1, series: 1 },
    } as unknown as NewReleasesOverview
    return releases
  }

  it('drops books listed only for that follow and keeps the rest without it', async () => {
    const releases = withItems()

    await releases.unfollow(author)

    expect(unfollowForReleases).toHaveBeenCalledWith(1)
    expect(releases.overview.value?.items.map((entry) => [entry.id, entry.matchedFollows.map((follow) => follow.id)])).toEqual([
      [2, [2]],
      [3, [2]],
    ])
    expect(releases.overview.value?.followCounts).toEqual({ author: 0, series: 1 })
  })

  it('follows again and reloads on undo', async () => {
    const releases = withItems()

    await releases.refollow(author, { authorId: 7 })

    expect(followForReleases).toHaveBeenCalledWith({ kind: 'author', name: 'Jane Writer', authorId: 7 })
    expect(getNewReleases).toHaveBeenCalled()
  })
})
