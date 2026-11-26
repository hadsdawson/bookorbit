import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SeriesCheckView from '../views/SeriesCheckView.vue'

const apiMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (url: string, init?: RequestInit) => apiMock(url, init) }))
let granted = true
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => granted }) }))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const mixedPage = {
  items: [
    {
      id: 4,
      name: 'Wisdom',
      bookCount: 3,
      authors: ['Weaver', 'Other'],
      moreAuthorCount: 0,
      coverBookIds: [],
      reasons: ['repeatedNumber', 'unrelatedAuthors'],
      repeatedNumbers: ['1', '2'],
      markedFine: false,
    },
  ],
  total: 1,
  page: 0,
  size: 25,
  counts: { open: 1, fine: 3 },
}
const waitingPage = {
  items: [{ bookId: 8, title: 'Infinite Wisdom', authors: ['Weaver'], seriesName: 'Wisdom', seriesIndex: '2', displayOrder: 0 }],
  total: 1,
  page: 0,
  size: 25,
}

function mountView() {
  return mount(SeriesCheckView, { global: { stubs: { RouterLink: RouterLinkStub, SeriesChoice: true, BookCoverImage: true } } })
}

describe('SeriesCheckView', () => {
  beforeEach(() => {
    granted = true
    apiMock.mockReset()
    apiMock.mockImplementation(async (url) => {
      if (url.startsWith('/api/v1/series-review/mixed?')) return new Response(JSON.stringify(mixedPage))
      if (url.startsWith('/api/v1/series-review/waiting?')) return new Response(JSON.stringify(waitingPage))
      return new Response(null, { status: 204 })
    })
  })

  it('shows mixed series with their reasons and counts', async () => {
    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-testid="mixed-series-row"]')
    expect(row.text()).toContain('Wisdom')
    expect(row.text()).toContain('#4')
    expect(wrapper.get('[data-testid="reason-repeated"]').text()).toContain('#1, #2')
    expect(wrapper.find('[data-testid="reason-unrelated"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="series-check-view-fine"]').text()).toContain('3')
  })

  it('marks a series fine and removes it from the list', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="mixed-series-fine"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/series-review/mixed/4/fine', { method: 'POST' })
    expect(wrapper.find('[data-testid="mixed-series-row"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="series-check-empty"]').exists()).toBe(true)
  })

  it('lists waiting books with a series chooser', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="series-check-section-waiting"]').trigger('click')

    const row = wrapper.get('[data-testid="waiting-book-row"]')
    expect(row.text()).toContain('Infinite Wisdom')
    expect(row.text()).toContain('Wisdom #2')
    expect(row.findComponent({ name: 'SeriesChoice' }).exists()).toBe(true)
  })

  it('explains the missing permission', () => {
    granted = false
    const wrapper = mountView()
    expect(wrapper.text()).toContain('permission to edit metadata')
    expect(apiMock).not.toHaveBeenCalled()
  })
})
