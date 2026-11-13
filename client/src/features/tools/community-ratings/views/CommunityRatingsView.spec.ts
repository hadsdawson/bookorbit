import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityRatingsRefreshStatus } from '@bookorbit/types'

import CommunityRatingsView from './CommunityRatingsView.vue'

const api = vi.hoisted(() => ({
  getCommunityRatingsRefreshStatus: vi.fn<() => Promise<CommunityRatingsRefreshStatus>>(),
  setCommunityRatingsRefreshSchedule: vi.fn<(schedule: string) => Promise<CommunityRatingsRefreshStatus>>(),
  startCommunityRatingsRefresh: vi.fn<() => Promise<CommunityRatingsRefreshStatus>>(),
  cancelCommunityRatingsRefresh: vi.fn<() => Promise<CommunityRatingsRefreshStatus>>(),
}))

vi.mock('../../api/community-ratings', () => api)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn<(message: string) => void>() } }))

function makeStatus(overrides: Partial<CommunityRatingsRefreshStatus> = {}): CommunityRatingsRefreshStatus {
  return { schedule: 'off', running: false, run: null, booksWithRatings: 120, nextScheduledAt: null, ...overrides }
}

const runningRun = {
  trigger: 'manual' as const,
  startedAt: '2026-11-12T10:00:00Z',
  finishedAt: null,
  cancelled: false,
  total: 120,
  processed: 30,
  updated: 12,
  unchanged: 18,
  skipped: 0,
  failed: 0,
}

describe('CommunityRatingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts an update and shows its progress', async () => {
    api.getCommunityRatingsRefreshStatus.mockResolvedValue(makeStatus())
    api.startCommunityRatingsRefresh.mockResolvedValue(makeStatus({ running: true, run: runningRun }))
    const wrapper = mount(CommunityRatingsView)
    await flushPromises()

    await wrapper.get('[data-testid="community-ratings-start"]').trigger('click')
    await flushPromises()

    expect(api.startCommunityRatingsRefresh).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="community-ratings-stop"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('"processed":"30"')
    wrapper.unmount()
  })

  it('stops a running update', async () => {
    api.getCommunityRatingsRefreshStatus.mockResolvedValue(makeStatus({ running: true, run: runningRun }))
    api.cancelCommunityRatingsRefresh.mockResolvedValue(makeStatus({ run: { ...runningRun, finishedAt: '2026-11-12T10:05:00Z', cancelled: true } }))
    const wrapper = mount(CommunityRatingsView)
    await flushPromises()

    await wrapper.get('[data-testid="community-ratings-stop"]').trigger('click')
    await flushPromises()

    expect(api.cancelCommunityRatingsRefresh).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="community-ratings-last-run"]').text()).toContain('tools.communityRatings.lastRunStopped')
    wrapper.unmount()
  })

  it('saves the schedule when it is changed', async () => {
    api.getCommunityRatingsRefreshStatus.mockResolvedValue(makeStatus())
    api.setCommunityRatingsRefreshSchedule.mockResolvedValue(makeStatus({ schedule: 'monthly', nextScheduledAt: '2026-12-12T10:00:00Z' }))
    const wrapper = mount(CommunityRatingsView)
    await flushPromises()

    await wrapper.get('[data-testid="community-ratings-schedule"]').setValue('monthly')
    await flushPromises()

    expect(api.setCommunityRatingsRefreshSchedule).toHaveBeenCalledWith('monthly')
    expect(wrapper.text()).toContain('tools.communityRatings.nextRun')
    wrapper.unmount()
  })

  it('cannot start when no book has ratings', async () => {
    api.getCommunityRatingsRefreshStatus.mockResolvedValue(makeStatus({ booksWithRatings: 0 }))
    const wrapper = mount(CommunityRatingsView)
    await flushPromises()

    expect(wrapper.get('[data-testid="community-ratings-start"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
