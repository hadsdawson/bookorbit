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
    api.getConversions.mockResolvedValue({ settings: { enabled: false, concurrency: 1, speed: 'low' }, convertPath: '/data/convert', jobs: [] })
    api.saveConversionSettings.mockResolvedValue({ enabled: true, concurrency: 1, speed: 'low' })
    const wrapper = mountCard()
    await flushPromises()

    await wrapper.get('[data-testid="conversion-enabled"]').trigger('click')
    await flushPromises()

    expect(api.saveConversionSettings).toHaveBeenCalledWith({ enabled: true, concurrency: 1, speed: 'low' })
    expect(status.setEnabled).toHaveBeenCalledWith(true)
    expect(wrapper.get('[data-testid="conversion-path"]').text()).toBe('/data/convert')
  })
})
