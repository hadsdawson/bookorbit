import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewReleasesServerSettings as Settings } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  allowed: true,
  getNewReleasesServerSettings: vi.fn<() => Promise<Settings>>(),
  saveNewReleasesServerSettings: vi.fn<(settings: Settings) => Promise<Settings>>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => mocks.allowed }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('../api/new-releases', () => ({
  getNewReleasesServerSettings: mocks.getNewReleasesServerSettings,
  saveNewReleasesServerSettings: mocks.saveNewReleasesServerSettings,
}))

import NewReleasesServerSettings from '../components/NewReleasesServerSettings.vue'

describe('NewReleasesServerSettings', () => {
  beforeEach(() => {
    mocks.allowed = true
    mocks.getNewReleasesServerSettings.mockReset().mockResolvedValue({ defaultFormat: 'both', defaultDelivery: 'suggest' })
    mocks.saveNewReleasesServerSettings.mockReset().mockImplementation(async (settings) => settings)
  })

  it('saves the server default format and delivery', async () => {
    const wrapper = mount(NewReleasesServerSettings)
    await flushPromises()
    await wrapper.get('#new-releases-default-format').setValue('audiobook')
    await flushPromises()
    expect(mocks.saveNewReleasesServerSettings).toHaveBeenCalledWith({ defaultFormat: 'audiobook', defaultDelivery: 'suggest' })
    await wrapper.get('#new-releases-default-delivery').setValue('request')
    await flushPromises()
    expect(mocks.saveNewReleasesServerSettings).toHaveBeenLastCalledWith({ defaultFormat: 'audiobook', defaultDelivery: 'request' })
  })

  it('stays hidden from people who cannot manage requests', async () => {
    mocks.allowed = false
    const wrapper = mount(NewReleasesServerSettings)
    await flushPromises()
    expect(wrapper.find('[data-testid="new-releases-server-settings"]').exists()).toBe(false)
    expect(mocks.getNewReleasesServerSettings).not.toHaveBeenCalled()
  })
})
