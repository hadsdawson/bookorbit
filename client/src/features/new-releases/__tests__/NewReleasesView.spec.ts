import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewReleasesOverview } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  getNewReleases: vi.fn<() => Promise<NewReleasesOverview>>(),
  setNewReleaseHidden: vi.fn<(id: number, hidden: boolean) => Promise<void>>(),
  followAllForReleases: vi.fn<(kind: string) => Promise<{ added: number }>>(),
  listReleaseFollows: vi.fn<() => Promise<{ items: never[]; total: number }>>(),
  unfollowForReleases: vi.fn<(id: number) => Promise<void>>(),
  setNewReleasesRetention: vi.fn<(days: number) => Promise<unknown>>(),
}))

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('../api/new-releases', () => mocks)

import NewReleasesView from '../views/NewReleasesView.vue'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

function overview(overrides: Partial<NewReleasesOverview> = {}): NewReleasesOverview {
  return {
    items: [
      {
        id: 1,
        title: 'Next',
        authors: ['Jane Writer'],
        seriesName: 'The Saga',
        seriesIndex: 4,
        coverUrl: null,
        ebookDate: '2027-03-09',
        audiobookDate: '2027-03-16',
        releaseDate: '2027-03-09',
        matchedFollows: [{ kind: 'series', name: 'The Saga' }],
        state: 'requested',
      },
    ],
    followCounts: { author: 2, series: 1 },
    sources: { hardcover: true, audible: true, google: false },
    server: { defaultFormat: 'both', defaultDelivery: 'suggest' },
    user: { delivery: null, retentionDays: 30 },
    effectiveDelivery: 'suggest',
    lastCheckedAt: null,
    checking: false,
    pendingChecks: 0,
    ...overrides,
  }
}

describe('NewReleasesView', () => {
  beforeEach(() => {
    mocks.getNewReleases.mockReset().mockResolvedValue(overview())
    mocks.setNewReleaseHidden.mockReset().mockResolvedValue(undefined)
    mocks.followAllForReleases.mockReset().mockResolvedValue({ added: 3 })
    mocks.listReleaseFollows.mockReset().mockResolvedValue({ items: [], total: 0 })
    mocks.setNewReleasesRetention.mockReset().mockResolvedValue({ delivery: null, retentionDays: 60 })
  })

  it('lists upcoming books by month with both format dates and why they are listed', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    const item = wrapper.get('[data-testid="new-release-item"]')
    expect(item.text()).toContain('Next')
    expect(item.text()).toContain('The Saga #4')
    expect(item.text()).toContain('Ebook')
    expect(item.text()).toContain('Audiobook')
    expect(item.text()).toContain('Requested')
    expect(item.text()).toContain('Because you follow The Saga')
  })

  it('hides a book from the list', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    await wrapper.get('[data-testid="new-release-item"] button').trigger('click')
    await flushPromises()
    expect(mocks.setNewReleaseHidden).toHaveBeenCalledWith(1, true)
    expect(wrapper.find('[data-testid="new-release-item"]').exists()).toBe(false)
  })

  it('says how to start when nothing is followed, and warns when no book site is on', async () => {
    mocks.getNewReleases.mockResolvedValue(
      overview({ items: [], followCounts: { author: 0, series: 0 }, sources: { hardcover: false, audible: false, google: false } }),
    )
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    expect(wrapper.get('[data-testid="new-releases-empty"]').text()).toContain("You're not following anyone yet")
    expect(wrapper.find('[data-testid="new-releases-no-sources"]').exists()).toBe(true)
  })

  it('follows every author in the library', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    await wrapper.get('[data-testid="follow-all-authors"]').trigger('click')
    await flushPromises()
    expect(mocks.followAllForReleases).toHaveBeenCalledWith('author')
    expect(mocks.getNewReleases).toHaveBeenCalledTimes(2)
  })
  it('shows each format on its own day in the calendar and remembers the view', async () => {
    vi.useFakeTimers({ now: new Date(2027, 2, 1), toFake: ['Date'] })
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    await wrapper.get('[data-testid="new-releases-calendar-view"]').trigger('click')

    await wrapper.get('[data-day="2027-03-09"]').trigger('click')
    expect(wrapper.get('[data-testid="calendar-selected-day"]').text()).toContain('Next')
    expect(wrapper.get('[data-testid="calendar-selected-day"]').text()).toContain('Ebook')
    await wrapper.get('[data-day="2027-03-16"]').trigger('click')
    expect(wrapper.get('[data-testid="calendar-selected-day"]').text()).toContain('Audiobook')
    expect(localStorage.getItem('bookorbit.newReleases.view')).toBe('calendar')
  })

  it('saves how long released books stay listed, then reloads the list', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    await wrapper.get('[data-testid="new-releases-retention"]').setValue('60')
    await flushPromises()
    expect(mocks.setNewReleasesRetention).toHaveBeenCalledWith(60)
    expect(mocks.getNewReleases).toHaveBeenCalledTimes(2)
  })
})
