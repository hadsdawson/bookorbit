import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { NewReleasesOverview } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  getNewReleases: vi.fn<() => Promise<NewReleasesOverview>>(),
  setNewReleaseHidden: vi.fn<(id: number, hidden: boolean) => Promise<void>>(),
  followAllForReleases: vi.fn<(kind: string, includeUnfollowed?: boolean) => Promise<{ added: number; skipped: number; skippedNames: string[] }>>(),
  listReleaseFollows: vi.fn<() => Promise<{ items: never[]; total: number }>>(),
  unfollowForReleases: vi.fn<(id: number) => Promise<void>>(),
  followForReleases: vi.fn<(input: unknown) => Promise<unknown>>(),
  saveNewReleasesSettings: vi.fn<(settings: unknown) => Promise<unknown>>(),
  requestNewRelease: vi.fn<(id: number, formats: string[]) => Promise<{ requested: string[] }>>(),
}))

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('../api/new-releases', () => mocks)

import NewReleasesView from '../views/NewReleasesView.vue'

const ConfirmDialogStub = defineComponent({
  name: 'ConfirmDialog',
  props: { open: Boolean, title: String, description: String, confirmLabel: String, cancelLabel: String, busy: Boolean, destructive: Boolean },
  emits: ['confirm', 'cancel'],
  template: '<div />',
})

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
        authorLinks: [{ name: 'Jane Writer', authorId: null }],
        seriesId: null,
        providerIds: {},
        isbn13: null,
        seriesName: 'The Saga',
        seriesIndex: 4,
        coverUrl: null,
        ebookDate: '2027-03-09',
        audiobookDate: '2027-03-16',
        releaseDate: '2027-03-09',
        matchedFollows: [{ id: 2, kind: 'series', name: 'The Saga' }],
        state: 'requested',
      },
    ],
    followCounts: { author: 2, series: 1 },
    sources: { hardcover: true, audible: true, google: false },
    server: { defaultFormat: 'both', defaultDelivery: 'suggest', language: 'en', languageStrict: false },
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
    mocks.followAllForReleases.mockReset().mockResolvedValue({ added: 3, skipped: 0, skippedNames: [] })
    mocks.listReleaseFollows.mockReset().mockResolvedValue({ items: [], total: 0 })
    mocks.saveNewReleasesSettings.mockReset().mockResolvedValue({ delivery: null, retentionDays: 60 })
    mocks.requestNewRelease.mockReset().mockResolvedValue({ requested: ['ebook'] })
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

  it('offers Unfollow series under the book and drops it from the list once unfollowed', async () => {
    mocks.unfollowForReleases.mockReset().mockResolvedValue(undefined)
    const wrapper = mount(NewReleasesView)
    await flushPromises()

    const link = wrapper.get('[data-testid="unfollow-release-follow"]')
    expect(link.text()).toBe('Unfollow series')
    expect(link.attributes('aria-label')).toBe('Unfollow series: The Saga')
    await link.trigger('click')
    await flushPromises()

    expect(mocks.unfollowForReleases).toHaveBeenCalledWith(2)
    expect(wrapper.find('[data-testid="new-release-item"]').exists()).toBe(false)
  })

  it('hides a book from the list', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    await wrapper.get('[data-testid="hide-release"]').trigger('click')
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
    expect(mocks.followAllForReleases).toHaveBeenCalledWith('author', false)
    expect(mocks.getNewReleases).toHaveBeenCalledTimes(2)
  })

  it('asks before following again what was unfollowed on purpose (fork)', async () => {
    mocks.followAllForReleases
      .mockResolvedValueOnce({ added: 3, skipped: 2, skippedNames: ['Jane Writer', 'Ann Other'] })
      .mockResolvedValueOnce({ added: 2, skipped: 0, skippedNames: [] })
    const wrapper = mount(NewReleasesView, { global: { stubs: { ConfirmDialog: ConfirmDialogStub } } })
    await flushPromises()
    await wrapper.get('[data-testid="follow-all-authors"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.getComponent(ConfirmDialogStub)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('description')).toContain('Jane Writer, Ann Other')
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.followAllForReleases).toHaveBeenLastCalledWith('author', true)
    expect(wrapper.getComponent(ConfirmDialogStub).props('open')).toBe(false)
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
    expect(mocks.saveNewReleasesSettings).toHaveBeenCalledWith({ retentionDays: 60 })
    expect(mocks.getNewReleases).toHaveBeenCalledTimes(2)
  })
  it('requests the server default of both formats, even one with no date yet, and hides it once requested', async () => {
    mocks.getNewReleases.mockResolvedValue(overview({ items: [{ ...overview().items[0]!, audiobookDate: null, state: null }] }))
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    expect(wrapper.get('[data-testid="request-release"]').text()).toContain('Request both')
    await wrapper.get('[data-testid="request-release"]').trigger('click')
    await flushPromises()
    expect(mocks.requestNewRelease).toHaveBeenCalledWith(1, ['ebook', 'audiobook'])
    expect(wrapper.find('[data-testid="request-release"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="new-release-item"]').exists()).toBe(false)
  })

  it('offers no Request button for a book already requested', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    expect(wrapper.find('[data-testid="request-release"]').exists()).toBe(false)
  })

  it('saves how new books reach this user, or goes back to the server default', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    await wrapper.get('[data-testid="new-releases-delivery"]').setValue('request')
    await flushPromises()
    expect(mocks.saveNewReleasesSettings).toHaveBeenCalledWith({ delivery: 'request' })
    await wrapper.get('[data-testid="new-releases-delivery"]').setValue('default')
    await flushPromises()
    expect(mocks.saveNewReleasesSettings).toHaveBeenLastCalledWith({ delivery: null })
  })

  it('offers requesting only books of followed series', async () => {
    const wrapper = mount(NewReleasesView)
    await flushPromises()
    await wrapper.get('[data-testid="new-releases-delivery"]').setValue('series')
    await flushPromises()
    expect(mocks.saveNewReleasesSettings).toHaveBeenCalledWith({ delivery: 'series' })
  })
})
