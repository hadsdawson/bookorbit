import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import ColorThemePicker from '../ColorThemePicker.vue'
import { useThemeStore } from '@/stores/theme'

describe('ColorThemePicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('lists only the solid themes for the Solid style', () => {
    const wrapper = mount(ColorThemePicker, { props: { group: 'solid' } })

    const solid = wrapper.get('[data-testid="color-theme-group-solid"]')
    expect(solid.text()).toContain('Velvet Night')
    expect(solid.text()).not.toContain('Midnight Blaze')
    expect(solid.find('[data-theme="none"]').exists()).toBe(false)
  })

  it('lists only the ombre themes for the Ombre style', () => {
    const wrapper = mount(ColorThemePicker, { props: { group: 'ombre' } })

    const ombre = wrapper.get('[data-testid="color-theme-group-ombre"]')
    expect(ombre.findAll('button')).toHaveLength(20)
    expect(ombre.text()).toContain('Midnight Blaze')
    expect(ombre.text()).not.toContain('Velvet Night')
    expect(ombre.get('[data-theme="ombre-sunset-strip"]').attributes('data-color-theme')).toBe('ombre-sunset-strip')
  })

  it('applies an ombre theme when its tile is picked', async () => {
    const wrapper = mount(ColorThemePicker, { props: { group: 'ombre' } })
    await wrapper.get('[data-theme="ombre-midnight-blaze"]').trigger('click')

    expect(useThemeStore().colorTheme).toBe('ombre-midnight-blaze')
    expect(useThemeStore().style).toBe('ombre')
    expect(document.documentElement.getAttribute('data-color-theme')).toBe('ombre-midnight-blaze')
  })
})
