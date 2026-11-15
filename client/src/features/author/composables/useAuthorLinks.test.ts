import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'

vi.mock('../api/author', () => ({
  fetchAuthorLinks: vi.fn<typeof import('../api/author').fetchAuthorLinks>(),
  fetchAuthors: vi.fn<typeof import('../api/author').fetchAuthors>(),
  linkAuthor: vi.fn<typeof import('../api/author').linkAuthor>(),
  unlinkAuthor: vi.fn<typeof import('../api/author').unlinkAuthor>(),
}))

import { fetchAuthorLinks, fetchAuthors, linkAuthor, unlinkAuthor } from '../api/author'
import { useAuthorLinks } from './useAuthorLinks'

describe('useAuthorLinks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(fetchAuthorLinks).mockResolvedValue([{ id: 12, name: 'Amanda Woody' }])
    vi.mocked(linkAuthor).mockResolvedValue([
      { id: 12, name: 'Amanda Woody' },
      { id: 13, name: 'Third Name' },
    ])
    vi.mocked(unlinkAuthor).mockResolvedValue([])
    vi.mocked(fetchAuthors).mockResolvedValue({
      items: [
        { id: 9, name: 'A.M. Woody', bookCount: 2 },
        { id: 12, name: 'Amanda Woody', bookCount: 1 },
        { id: 13, name: 'Third Name', bookCount: 1 },
      ],
      total: 3,
    } as never)
  })

  it('loads links and leaves the author and its linked names out of the search', async () => {
    const links = useAuthorLinks(ref(9))
    await links.load()
    expect(links.links.value).toEqual([{ id: 12, name: 'Amanda Woody' }])

    links.query.value = 'woody'
    await nextTick()
    await vi.runAllTimersAsync()
    expect(links.candidates.value.map((candidate) => candidate.id)).toEqual([13])
  })

  it('links and unlinks through the API', async () => {
    const links = useAuthorLinks(ref(9))
    await links.link(13)
    expect(linkAuthor).toHaveBeenCalledWith(9, 13)
    expect(links.links.value).toHaveLength(2)
    await links.unlink(12)
    expect(unlinkAuthor).toHaveBeenCalledWith(9, 12)
    expect(links.links.value).toEqual([])
  })
})
