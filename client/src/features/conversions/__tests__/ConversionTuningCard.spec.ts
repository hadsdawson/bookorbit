import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversionSettings } from '@bookorbit/types'

import ConversionTuningCard from '../components/ConversionTuningCard.vue'

const api = vi.hoisted(() => ({ saveConversionSettings: vi.fn<(settings: ConversionSettings) => Promise<ConversionSettings>>() }))

vi.mock('../api/conversions', () => api)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn<(message: string) => void>() } }))

const SETTINGS: ConversionSettings = { enabled: true, concurrency: 1, speed: 'low' }

describe('ConversionTuningCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers Low and High speed, explains the current one, and saves a change', async () => {
    api.saveConversionSettings.mockResolvedValue({ ...SETTINGS, speed: 'high' })
    const wrapper = mount(ConversionTuningCard, { props: { settings: SETTINGS } })

    const select = wrapper.get('[data-testid="conversion-speed"]')
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'conversions.tuning.speedOption.low',
      'conversions.tuning.speedOption.high',
    ])
    expect(wrapper.text()).toContain('conversions.tuning.speedHint.low')
    await select.setValue('high')
    await flushPromises()

    expect(api.saveConversionSettings).toHaveBeenCalledWith({ ...SETTINGS, speed: 'high' })
    expect(wrapper.emitted('saved')?.[0]).toEqual([{ ...SETTINGS, speed: 'high' }])
  })

  it('offers one to three books at once', async () => {
    api.saveConversionSettings.mockResolvedValue({ ...SETTINGS, concurrency: 3 })
    const wrapper = mount(ConversionTuningCard, { props: { settings: SETTINGS } })

    const select = wrapper.get('[data-testid="conversion-concurrency"]')
    expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual(['1', '2', '3'])
    await select.setValue('3')
    await flushPromises()
    expect(api.saveConversionSettings).toHaveBeenCalledWith({ ...SETTINGS, concurrency: 3 })
  })
})
