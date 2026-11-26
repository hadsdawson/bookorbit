import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeriesReviewItem, SeriesWaitingBook } from '@bookorbit/types'
import { useMixedSeries, useWaitingSeriesBooks } from '../composables/useSeriesCheck'

const apiMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (url: string, init?: RequestInit) => apiMock(url, init) }))

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function item(id: number): SeriesReviewItem {
  return {
    id,
    name: `S${id}`,
    bookCount: 2,
    authors: [],
    moreAuthorCount: 0,
    coverBookIds: [],
    reasons: ['repeatedNumber'],
    repeatedNumbers: ['1'],
    markedFine: false,
  }
}

function waitingBook(bookId: number, displayOrder = 0): SeriesWaitingBook {
  return { bookId, title: 'T', authors: [], seriesName: 'Wisdom', seriesIndex: null, displayOrder }
}

describe('useMixedSeries', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads the open view and switches to marked fine', async () => {
    apiMock.mockImplementation(async (url) =>
      json({
        items: url.includes('view=fine') ? [] : [item(1)],
        total: url.includes('view=fine') ? 0 : 1,
        page: 0,
        size: 25,
        counts: { open: 1, fine: 0 },
      }),
    )
    const mixed = useMixedSeries()
    await mixed.load()
    expect(apiMock).toHaveBeenCalledWith('/api/v1/series-review/mixed?view=open&page=0&size=25', undefined)
    expect(mixed.items.value).toHaveLength(1)

    await mixed.setView('fine')
    expect(apiMock.mock.calls.at(-1)?.[0]).toContain('view=fine')
    expect(mixed.items.value).toEqual([])
  })

  it('marks a series fine and moves its count', async () => {
    apiMock.mockResolvedValueOnce(json({ items: [item(1), item(2)], total: 2, page: 0, size: 25, counts: { open: 2, fine: 0 } }))
    const mixed = useMixedSeries()
    await mixed.load()

    apiMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await mixed.setFine(1, true)).toBe(true)

    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/series-review/mixed/1/fine', { method: 'POST' })
    expect(mixed.items.value.map((i) => i.id)).toEqual([2])
    expect(mixed.counts.value).toEqual({ open: 1, fine: 1 })
  })

  it('keeps the row when marking fails', async () => {
    apiMock.mockResolvedValueOnce(json({ items: [item(1)], total: 1, page: 0, size: 25, counts: { open: 1, fine: 0 } }))
    const mixed = useMixedSeries()
    await mixed.load()
    apiMock.mockResolvedValueOnce(new Response(null, { status: 500 }))

    expect(await mixed.setFine(1, true)).toBe(false)
    expect(mixed.items.value).toHaveLength(1)
  })
})

describe('useWaitingSeriesBooks', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('sends the pick and drops the row once it is saved', async () => {
    apiMock.mockResolvedValueOnce(json({ items: [waitingBook(5), waitingBook(6)], total: 2, page: 0, size: 25 }))
    const waiting = useWaitingSeriesBooks()
    await waiting.load()

    apiMock.mockResolvedValueOnce(json({ id: 5, pendingSeries: [] }))
    expect(await waiting.resolve(waitingBook(5), { seriesId: 9 })).toBe(true)

    const [url, init] = apiMock.mock.calls.at(-1)!
    expect(url).toBe('/api/v1/series-review/waiting/resolve')
    expect(JSON.parse(String(init?.body))).toEqual({ bookId: 5, displayOrder: 0, seriesId: 9 })
    expect(waiting.items.value.map((b) => b.bookId)).toEqual([6])
    expect(waiting.total.value).toBe(1)
  })

  it('keeps a row that is still waiting after the save', async () => {
    apiMock.mockResolvedValueOnce(json({ items: [waitingBook(5)], total: 1, page: 0, size: 25 }))
    const waiting = useWaitingSeriesBooks()
    await waiting.load()
    apiMock.mockResolvedValueOnce(json({ id: 5, pendingSeries: [{ seriesName: 'Wisdom', seriesIndex: null, displayOrder: 0 }] }))

    expect(await waiting.resolve(waitingBook(5), { newSeries: true })).toBe(false)
    expect(waiting.items.value).toHaveLength(1)
  })
})
