import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import ColorThemePicker from '../ColorThemePicker.vue'
import { useThemeStore } from '@/stores/theme'

describe('ColorThemePicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('lists the ombre themes in their own group, apart from the solid ones', () => {
    const wrapper = mount(ColorThemePicker)

    const solid = wrapper.get('[data-testid="color-theme-group-solid"]')
    const ombre = wrapper.get('[data-testid="color-theme-group-ombre"]')
    expect(solid.text()).toContain('Velvet Night')
    expect(solid.text()).not.toContain('Midnight Blaze')
    expect(ombre.findAll('button')).toHaveLength(20)
    expect(ombre.text()).toContain('Midnight Blaze')
    expect(ombre.get('[data-theme="ombre-sunset-strip"]').attributes('data-color-theme')).toBe('ombre-sunset-strip')
  })

  it('applies an ombre theme when its tile is picked', async () => {
    const wrapper = mount(ColorThemePicker)
    await wrapper.get('[data-theme="ombre-midnight-blaze"]').trigger('click')

    expect(useThemeStore().colorTheme).toBe('ombre-midnight-blaze')
    expect(document.documentElement.getAttribute('data-color-theme')).toBe('ombre-midnight-blaze')
  })
})
