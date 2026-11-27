import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewReleaseItem, NewReleasesOverview } from '@bookorbit/types'

const requestNewRelease = vi.fn<(...args: unknown[]) => Promise<unknown>>()

vi.mock('../api/new-releases', () => ({
  getNewReleases: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  requestNewRelease: (...args: unknown[]) => requestNewRelease(...args),
  setNewReleaseHidden: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  followAllForReleases: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  saveNewReleasesSettings: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}))

import { useNewReleases } from '../composables/useNewReleases'

function item(id: number): NewReleaseItem {
  return {
    id,
    title: `Book ${id}`,
    authors: ['Jane Writer'],
    authorLinks: [{ name: 'Jane Writer', authorId: null }],
    seriesId: null,
    providerIds: {},
    isbn13: null,
    seriesName: null,
    seriesIndex: null,
    coverUrl: null,
    ebookDate: '2027-03-09',
    audiobookDate: null,
    releaseDate: '2027-03-09',
    matchedFollows: [{ id: 1, kind: 'author', name: 'Jane Writer' }],
    state: null,
  }
}

describe('requesting a new release', () => {
  beforeEach(() => {
    requestNewRelease.mockReset().mockResolvedValue({ requested: ['ebook'] })
  })

  function withItems() {
    const releases = useNewReleases()
    releases.overview.value = { items: [item(1), item(2)] } as unknown as NewReleasesOverview
    return releases
  }

  it('drops the book from the list once it is requested', async () => {
    const releases = withItems()
    await releases.request(item(1), ['ebook'])
    expect(releases.overview.value?.items.map((entry) => entry.id)).toEqual([2])
  })

  it('keeps it, marked requested, while hidden books are shown', async () => {
    const releases = withItems()
    releases.showHidden.value = true
    await releases.request(item(1), ['ebook'])
    expect(releases.overview.value?.items.map((entry) => [entry.id, entry.state])).toEqual([
      [1, 'requested'],
      [2, null],
    ])
  })
})
