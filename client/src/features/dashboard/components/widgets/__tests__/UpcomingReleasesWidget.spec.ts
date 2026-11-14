import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpcomingReleasesWidgetData } from '@bookorbit/types'
import UpcomingReleasesWidget from '../UpcomingReleasesWidget.vue'
import { UPCOMING_RELEASES_REFRESH_MS } from '../../../composables/useUpcomingReleasesWidget'

const fetchUpcomingReleases = vi.fn<() => Promise<UpcomingReleasesWidgetData | null>>()
const push = vi.fn<(...args: unknown[]) => void>()

vi.mock('@/features/dashboard/api/dashboard-widget.api', () => ({
  fetchUpcomingReleases: () => fetchUpcomingReleases(),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

function data(overrides: Partial<UpcomingReleasesWidgetData> = {}): UpcomingReleasesWidgetData {
  return {
    date: '2099-11-17',
    total: 3,
    items: [
      {
        id: 8,
        title: 'Next',
        authors: ['Jane Writer'],
        seriesName: 'The Saga',
        seriesIndex: 4,
        coverUrl: null,
        formats: ['ebook', 'audiobook'],
        state: 'requested',
      },
    ],
    ...overrides,
  }
}

describe('UpcomingReleasesWidget', () => {
  afterEach(() => {
    vi.useRealTimers()
    fetchUpcomingReleases.mockReset()
    push.mockReset()
  })

  it('lists the books out that day and counts the rest', async () => {
    fetchUpcomingReleases.mockResolvedValue(data())
    const wrapper = mount(UpcomingReleasesWidget)
    await flushPromises()

    expect(wrapper.get('[data-testid="upcoming-list"]').text()).toContain('Next')
    expect(wrapper.text()).toContain('Jane Writer · The Saga #4')
    expect(wrapper.text()).toContain('Requested')
    expect(wrapper.get('[data-testid="upcoming-open"]').text()).toContain('2 more')

    await wrapper.get('[data-testid="upcoming-open"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'new-releases' })
  })

  it('says so when nothing followed comes out that day', async () => {
    fetchUpcomingReleases.mockResolvedValue(data({ items: [], total: 0 }))
    const wrapper = mount(UpcomingReleasesWidget)
    await flushPromises()

    expect(wrapper.find('[data-testid="upcoming-empty"]').exists()).toBe(true)
  })

  it('refreshes on its own so the list stays current', async () => {
    vi.useFakeTimers()
    fetchUpcomingReleases.mockResolvedValue(data())
    const wrapper = mount(UpcomingReleasesWidget)
    await flushPromises()
    expect(fetchUpcomingReleases).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(UPCOMING_RELEASES_REFRESH_MS)
    expect(fetchUpcomingReleases).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
