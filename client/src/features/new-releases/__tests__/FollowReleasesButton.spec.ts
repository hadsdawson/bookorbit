import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseFollow } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  allowed: true,
  findReleaseFollow: vi.fn<(kind: string, name: string) => Promise<ReleaseFollow | null>>(),
  followForReleases: vi.fn<(input: unknown) => Promise<ReleaseFollow>>(),
  unfollowForReleases: vi.fn<(id: number) => Promise<void>>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => mocks.allowed }),
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('../api/new-releases', () => ({
  findReleaseFollow: mocks.findReleaseFollow,
  followForReleases: mocks.followForReleases,
  unfollowForReleases: mocks.unfollowForReleases,
}))

import FollowReleasesButton from '../components/FollowReleasesButton.vue'

const follow: ReleaseFollow = {
  id: 5,
  kind: 'series',
  name: 'The Saga',
  authorHint: 'Jane Writer',
  authorId: null,
  seriesId: 9,
  createdAt: '2026-11-13T00:00:00.000Z',
}

describe('FollowReleasesButton', () => {
  beforeEach(() => {
    mocks.allowed = true
    mocks.findReleaseFollow.mockReset().mockResolvedValue(null)
    mocks.followForReleases.mockReset().mockResolvedValue(follow)
    mocks.unfollowForReleases.mockReset().mockResolvedValue(undefined)
  })

  it('renders nothing without New Releases access', () => {
    mocks.allowed = false
    const wrapper = mount(FollowReleasesButton, { props: { kind: 'series', name: 'The Saga', seriesId: 9 } })
    expect(wrapper.find('[data-testid="follow-releases"]').exists()).toBe(false)
    expect(mocks.findReleaseFollow).not.toHaveBeenCalled()
  })

  it('follows, then unfollows, the series it is on', async () => {
    const wrapper = mount(FollowReleasesButton, { props: { kind: 'series', name: 'The Saga', seriesId: 9 } })
    await flushPromises()
    const button = wrapper.get('[data-testid="follow-releases"]')
    expect(button.attributes('aria-pressed')).toBe('false')

    await button.trigger('click')
    await flushPromises()
    expect(mocks.followForReleases).toHaveBeenCalledWith({ kind: 'series', name: 'The Saga', seriesId: 9, authorId: undefined })
    expect(button.attributes('aria-pressed')).toBe('true')

    await button.trigger('click')
    await flushPromises()
    expect(mocks.unfollowForReleases).toHaveBeenCalledWith(5)
    expect(button.attributes('aria-pressed')).toBe('false')
  })
})
