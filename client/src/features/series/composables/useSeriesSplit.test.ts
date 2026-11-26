import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { useSeriesSplit } from './useSeriesSplit'

const apiMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (url: string, init?: RequestInit) => apiMock(url, init) }))

function book(id: number, authors: string[], seriesIndex: string): BookCard {
  return {
    id,
    title: `B${id}`,
    authors,
    seriesIndex: null,
    seriesMemberships: [{ seriesId: 3, seriesName: 'Wisdom', seriesIndex, displayOrder: 0, expectedBookCount: null }],
  } as unknown as BookCard
}

function page(items: BookCard[], total = items.length) {
  return new Response(JSON.stringify({ items, total, page: 0, size: 100, seriesInfo: null }), { status: 200 })
}

describe('useSeriesSplit', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads every edition, groups by author and sends only a changed name', async () => {
    apiMock.mockResolvedValueOnce(page([book(1, ['Weaver'], '1'), book(2, ['Weaver'], '2'), book(3, ['Other'], '1')]))
    const split = useSeriesSplit(ref(3), ref('Wisdom'))
    await split.open()

    expect(apiMock.mock.calls[0]?.[0]).toBe('/api/v1/series/3/books?page=0&size=100&sort=seriesIndex&order=asc')
    expect(split.rows.value[2]).toEqual({ id: 3, title: 'B3', authors: ['Other'], seriesIndex: '1' })
    expect(split.authorGroups.value.map((g) => g.name)).toEqual(['Weaver', 'Other'])
    expect(split.name.value).toBe('Wisdom')

    split.toggleGroup(split.authorGroups.value[1]!)
    expect(split.canSubmit.value).toBe(true)

    apiMock.mockResolvedValueOnce(new Response(JSON.stringify({ seriesId: 9, name: 'Wisdom', movedBookCount: 1 }), { status: 200 }))
    await split.submit()
    const [url, init] = apiMock.mock.calls.at(-1)!
    expect(url).toBe('/api/v1/entity-manager/series/split-books')
    expect(JSON.parse(String(init?.body))).toEqual({ seriesId: 3, bookIds: [3], writeFiles: false })

    split.name.value = 'Other Saga'
    apiMock.mockResolvedValueOnce(new Response(JSON.stringify({ seriesId: 10, name: 'Other Saga', movedBookCount: 1 }), { status: 200 }))
    await split.submit()
    expect(JSON.parse(String(apiMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ name: 'Other Saga' })
  })

  it('cannot move every book or none', async () => {
    apiMock.mockResolvedValueOnce(page([book(1, ['A'], '1'), book(2, ['B'], '2')]))
    const split = useSeriesSplit(ref(3), ref('Wisdom'))
    await split.open()
    expect(split.canSubmit.value).toBe(false)
    split.toggle(1)
    split.toggle(2)
    expect(split.canSubmit.value).toBe(false)
    split.toggle(2)
    expect(split.canSubmit.value).toBe(true)
  })

  it('shows the server message when the split is refused', async () => {
    apiMock.mockResolvedValueOnce(page([book(1, ['A'], '1'), book(2, ['B'], '2')]))
    const split = useSeriesSplit(ref(3), ref('Wisdom'))
    await split.open()
    split.toggle(1)
    apiMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Leave at least one book' }), { status: 400 }))
    await expect(split.submit()).rejects.toThrow('Leave at least one book')
    expect(split.submitting.value).toBe(false)
  })
})
