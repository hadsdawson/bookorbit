import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BookDockFilterBar, { type BookDockViewCounts } from '../BookDockFilterBar.vue'

const counts: BookDockViewCounts = { total: 168, onHold: 167, working: 0, ready: 1, error: 0, merged: 12 }

describe('BookDockFilterBar', () => {
  it('counts each chip from the dock being shown and picks its view', async () => {
    const wrapper = shallowMount(BookDockFilterBar, { props: { activeView: 'all', counts } })

    const readyChip = wrapper.get('[data-testid="book-dock-chip-ready"]')
    expect(readyChip.text()).toContain('1')
    expect(readyChip.text()).not.toContain('168')
    expect(wrapper.get('[data-testid="book-dock-chip-onHold"]').text()).toContain('167')

    await readyChip.trigger('click')
    await wrapper.get('[data-testid="book-dock-chip-onHold"]').trigger('click')

    expect(wrapper.emitted('view')).toEqual([['ready'], ['onHold']])
  })

  it('cannot pick an empty chip unless it is the one shown', () => {
    const wrapper = shallowMount(BookDockFilterBar, { props: { activeView: 'error', counts } })

    expect(wrapper.get('[data-testid="book-dock-chip-working"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="book-dock-chip-error"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="book-dock-chip-error"]').attributes('aria-pressed')).toBe('true')
  })

  it('has a Merged chip beside the others, counted and pickable', async () => {
    const wrapper = shallowMount(BookDockFilterBar, { props: { activeView: 'all', counts } })

    const chips = wrapper.findAll('[data-testid^="book-dock-chip-"]').map((chip) => chip.attributes('data-testid'))
    expect(chips).toEqual([
      'book-dock-chip-all',
      'book-dock-chip-onHold',
      'book-dock-chip-working',
      'book-dock-chip-ready',
      'book-dock-chip-error',
      'book-dock-chip-merged',
    ])
    const merged = wrapper.get('[data-testid="book-dock-chip-merged"]')
    expect(merged.text()).toContain('Merged')
    expect(merged.text()).toContain('12')

    await merged.trigger('click')
    expect(wrapper.emitted('view')).toEqual([['merged']])
  })

  it('shows Merged as empty when an older server sends no merged count', () => {
    const { merged: _merged, ...older } = counts
    const wrapper = shallowMount(BookDockFilterBar, { props: { activeView: 'all', counts: older } })

    expect(wrapper.get('[data-testid="book-dock-chip-merged"]').attributes('disabled')).toBeDefined()
  })
})
