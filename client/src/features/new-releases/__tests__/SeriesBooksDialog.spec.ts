import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { SeriesBookItem, SeriesBooksRequestResult, SeriesBooksResult } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  allowed: true,
  getSeriesBooks: vi.fn<(name: string, author?: string | null) => Promise<SeriesBooksResult>>(),
  requestSeriesBooks: vi.fn<(name: string, author: string | null | undefined, keys: string[]) => Promise<SeriesBooksRequestResult>>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => mocks.allowed }),
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('../api/new-releases', () => ({
  getSeriesBooks: mocks.getSeriesBooks,
  requestSeriesBooks: mocks.requestSeriesBooks,
  findReleaseFollow: () => Promise.resolve(null),
  followForReleases: vi.fn<() => Promise<void>>(),
  unfollowForReleases: vi.fn<() => Promise<void>>(),
}))

import SeriesBooksDialog from '../components/SeriesBooksDialog.vue'
import { useSeriesBooks } from '../composables/useSeriesBooks'

function book(overrides: Partial<SeriesBookItem>): SeriesBookItem {
  return {
    key: 'k',
    title: 'Book',
    authors: ['Jessica Cage'],
    seriesIndex: 1,
    coverUrl: null,
    releasedOn: '2025-01-10',
    comingOn: null,
    comingSoon: false,
    status: 'missing',
    missingFormats: ['ebook'],
    ownedBookId: null,
    requestId: null,
    ...overrides,
  }
}

function seriesResult(books: SeriesBookItem[]): SeriesBooksResult {
  return {
    seriesName: 'Accidents Happen',
    seriesId: 7,
    books,
    formats: ['ebook'],
    sources: { hardcover: true, audible: true, google: false },
    failedSources: [],
  }
}

const FULL = [
  book({ key: 'one', title: 'I Accidentally Hired a Shadow Walker', status: 'owned', missingFormats: [], ownedBookId: 11 }),
  book({ key: 'two', title: 'Book Two', seriesIndex: 2 }),
  book({ key: 'three', title: 'Book Three', seriesIndex: 3, releasedOn: null, comingOn: '2027-02-02', comingSoon: true }),
]

function mountDialog() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/book/:bookId', name: 'book-detail', component: { template: '<div />' } },
      { path: '/requests/:id', name: 'book-request-detail', component: { template: '<div />' } },
    ],
  })
  return mount(SeriesBooksDialog, { attachTo: document.body, global: { plugins: [router] } })
}

function rows(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[data-testid="series-book"]')]
}

describe('SeriesBooksDialog', () => {
  beforeEach(() => {
    mocks.allowed = true
    mocks.getSeriesBooks.mockReset().mockResolvedValue(seriesResult(FULL))
    mocks.requestSeriesBooks.mockReset().mockResolvedValue({ requested: ['two', 'three'], failed: [] })
  })

  afterEach(() => {
    useSeriesBooks().close()
    document.body.innerHTML = ''
  })

  it('opens for a clicked series and lists each book with where it stands', async () => {
    const wrapper = mountDialog()
    useSeriesBooks().showSeries({ name: 'Accidents Happen', author: 'Jessica Cage' })
    await flushPromises()

    expect(mocks.getSeriesBooks).toHaveBeenCalledWith('Accidents Happen', 'Jessica Cage')
    expect(rows()).toHaveLength(3)
    expect(rows()[0]!.textContent).toContain('In library')
    expect(rows()[1]!.querySelector('[data-testid="series-book-request"]')).not.toBeNull()
    expect(rows()[2]!.querySelector('[data-testid="series-book-coming-soon"]')).not.toBeNull()
    expect(rows()[2]!.querySelector('[data-testid="series-book-request"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('requests one book, then every missing book, coming soon ones included', async () => {
    const wrapper = mountDialog()
    useSeriesBooks().showSeries({ name: 'Accidents Happen', author: 'Jessica Cage' })
    await flushPromises()

    rows()[1]!.querySelector<HTMLButtonElement>('[data-testid="series-book-request"]')!.click()
    await flushPromises()
    expect(mocks.requestSeriesBooks).toHaveBeenLastCalledWith('Accidents Happen', 'Jessica Cage', ['two'])

    document.body.querySelector<HTMLButtonElement>('[data-testid="series-books-request-all"]')!.click()
    await flushPromises()
    expect(mocks.requestSeriesBooks).toHaveBeenLastCalledWith('Accidents Happen', 'Jessica Cage', ['two', 'three'])
    wrapper.unmount()
  })

  it('after a request, opens only when some book of the series is still missing', async () => {
    const wrapper = mountDialog()
    mocks.getSeriesBooks.mockResolvedValue(seriesResult([FULL[0]!]))
    await useSeriesBooks().offerSeries({ name: 'Accidents Happen' })
    await flushPromises()
    expect(useSeriesBooks().open.value).toBe(false)

    mocks.getSeriesBooks.mockResolvedValue(seriesResult(FULL))
    await useSeriesBooks().offerSeries({ name: 'Accidents Happen' })
    await flushPromises()
    expect(useSeriesBooks().open.value).toBe(true)
    expect(document.body.textContent).toContain('More books in Accidents Happen')
    wrapper.unmount()
  })

  it('does nothing without New Releases access', async () => {
    mocks.allowed = false
    const wrapper = mountDialog()
    useSeriesBooks().showSeries({ name: 'Accidents Happen' })
    await useSeriesBooks().offerSeries({ name: 'Accidents Happen' })
    expect(mocks.getSeriesBooks).not.toHaveBeenCalled()
    expect(useSeriesBooks().open.value).toBe(false)
    wrapper.unmount()
  })
})
