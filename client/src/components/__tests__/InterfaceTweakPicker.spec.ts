import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import InterfaceTweakPicker from '../InterfaceTweakPicker.vue'
import { useThemeStore } from '@/stores/theme'

describe('InterfaceTweakPicker', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    setActivePinia(createPinia())
  })

  it('offers three text sizes, the default one picked', () => {
    const wrapper = mount(InterfaceTweakPicker, { props: { kind: 'interfaceTextSize' } })
    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['Default', 'Large', 'Larger'])
    expect(wrapper.get('[data-option="default"]').attributes('aria-pressed')).toBe('true')
  })

  it('applies the picked option', async () => {
    const wrapper = mount(InterfaceTweakPicker, { props: { kind: 'boxDepth' } })
    await wrapper.get('[data-option="strong"]').trigger('click')
    expect(useThemeStore().boxDepth).toBe('strong')
    expect(document.documentElement.getAttribute('data-box-depth')).toBe('strong')
  })

  it('shows each font in its own face', () => {
    const wrapper = mount(InterfaceTweakPicker, { props: { kind: 'interfaceFont' } })
    expect(wrapper.get('[data-option="lexend"]').attributes('style')).toContain('Lexend Variable')
  })
})
