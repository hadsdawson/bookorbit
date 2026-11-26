import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SeriesSplitDialog from './SeriesSplitDialog.vue'

const apiMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (url: string, init?: RequestInit) => apiMock(url, init) }))
const toastError = vi.fn<(message: string) => void>()
vi.mock('vue-sonner', () => ({ toast: { error: (message: string) => toastError(message) } }))

const books = [
  { id: 1, title: 'One', authors: ['Weaver'], seriesIndex: '1', seriesMemberships: [] },
  { id: 2, title: 'Other One', authors: ['Other'], seriesIndex: '1', seriesMemberships: [] },
]

describe('SeriesSplitDialog', () => {
  beforeEach(() => {
    apiMock.mockReset()
    toastError.mockReset()
    apiMock.mockImplementation(async (url) => {
      if (url.includes('/books?')) return new Response(JSON.stringify({ items: books, total: 2, page: 0, size: 100, seriesInfo: null }))
      return new Response(JSON.stringify({ seriesId: 9, name: 'Wisdom', movedBookCount: 1 }))
    })
  })

  it('moves the ticked books and reports the new series', async () => {
    const wrapper = mount(SeriesSplitDialog, {
      props: { open: true, seriesId: 3, seriesName: 'Wisdom' },
      global: { stubs: { BookCoverImage: true } },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="series-split-book"]')).toHaveLength(2)
    expect((wrapper.get('[data-testid="series-split-name"]').element as HTMLInputElement).value).toBe('Wisdom')
    expect(wrapper.get('[data-testid="series-split-submit"]').attributes('disabled')).toBeDefined()

    const other = wrapper.findAll('[data-testid="series-split-author"]').find((chip) => chip.text().startsWith('Other'))!
    await other.trigger('click')
    await wrapper.get('[data-testid="series-split-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('split')).toEqual([[{ seriesId: 9, name: 'Wisdom', movedBookCount: 1 }]])
  })

  it('shows why a split was refused', async () => {
    const wrapper = mount(SeriesSplitDialog, {
      props: { open: true, seriesId: 3, seriesName: 'Wisdom' },
      global: { stubs: { BookCoverImage: true } },
    })
    await flushPromises()
    apiMock.mockImplementation(async () => new Response(JSON.stringify({ message: 'None of these books are in this series' }), { status: 400 }))

    await wrapper.findAll('[data-testid="series-split-book"]')[0]!.setValue(true)
    await wrapper.get('[data-testid="series-split-submit"]').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith('None of these books are in this series')
    expect(wrapper.emitted('split')).toBeUndefined()
  })
})
