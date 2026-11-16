import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversionOverview, ConversionSettings } from '@bookorbit/types'

import ConversionSettingsCard from '../components/ConversionSettingsCard.vue'

const api = vi.hoisted(() => ({
  getConversions: vi.fn<() => Promise<ConversionOverview>>(),
  saveConversionSettings: vi.fn<(settings: ConversionSettings) => Promise<ConversionSettings>>(),
}))
const status = vi.hoisted(() => ({ setEnabled: vi.fn<(value: boolean) => void>() }))

vi.mock('../api/conversions', () => api)
vi.mock('../composables/useConversionStatus', () => ({ useConversionStatus: () => status }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn<(message: string) => void>() } }))

const ToggleSwitchStub = {
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: '<button data-testid="toggle" @click="$emit(\'update:modelValue\', !modelValue)" />',
}

function mountCard() {
  return mount(ConversionSettingsCard, { global: { stubs: { ToggleSwitch: ToggleSwitchStub } } })
}

describe('ConversionSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('turns conversions on and shows the tab straight away', async () => {
    api.getConversions.mockResolvedValue({ settings: { enabled: false, concurrency: 1 }, convertPath: '/data/convert', jobs: [] })
    api.saveConversionSettings.mockResolvedValue({ enabled: true, concurrency: 1 })
    const wrapper = mountCard()
    await flushPromises()
    expect(wrapper.find('[data-testid="conversion-concurrency"]').exists()).toBe(false)

    await wrapper.get('[data-testid="conversion-enabled"]').trigger('click')
    await flushPromises()

    expect(api.saveConversionSettings).toHaveBeenCalledWith({ enabled: true, concurrency: 1 })
    expect(status.setEnabled).toHaveBeenCalledWith(true)
    expect(wrapper.get('[data-testid="conversion-path"]').text()).toBe('/data/convert')
  })

  it('offers one to three books at once', async () => {
    api.getConversions.mockResolvedValue({ settings: { enabled: true, concurrency: 1 }, convertPath: '/data/convert', jobs: [] })
    api.saveConversionSettings.mockResolvedValue({ enabled: true, concurrency: 3 })
    const wrapper = mountCard()
    await flushPromises()

    const select = wrapper.get('[data-testid="conversion-concurrency"]')
    expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual(['1', '2', '3'])
    await select.setValue('3')
    await flushPromises()
    expect(api.saveConversionSettings).toHaveBeenCalledWith({ enabled: true, concurrency: 3 })
  })
})
