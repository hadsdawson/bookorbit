import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BookDockStatusBadge from '../BookDockStatusBadge.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

const NOW = Date.parse('2026-11-16T21:00:00Z')

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString()
}

describe('BookDockStatusBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the step a running file is on and how long it has been there', () => {
    const wrapper = mount(BookDockStatusBadge, { props: { status: 'fetching', processing: 'running', since: minutesAgo(3) } })
    const text = wrapper.text()
    expect(text).toContain('bookDock.processing.step')
    expect(text).toContain('bookDock.processing.lookingUp')
    expect(text).toContain('{\\"minutes\\":\\"3\\"}')
  })

  it('says a file is waiting its turn', () => {
    const wrapper = mount(BookDockStatusBadge, { props: { status: 'pending', processing: 'waiting', since: minutesAgo(30) } })
    expect(wrapper.text()).toBe('bookDock.processing.waiting')
  })

  it('flags a stuck file and explains why', () => {
    const wrapper = mount(BookDockStatusBadge, { props: { status: 'extracting', processing: 'stuck', since: minutesAgo(30) } })
    const badge = wrapper.get('[data-testid="book-dock-status"]')
    expect(badge.text()).toBe('bookDock.processing.stuck')
    expect(badge.attributes('title')).toBe('bookDock.processing.stuckHint')
  })

  it('warns once a step has run for ten minutes', () => {
    const wrapper = mount(BookDockStatusBadge, { props: { status: 'extracting', processing: 'running', since: minutesAgo(12) } })
    expect(wrapper.get('[data-testid="book-dock-status"]').attributes('title')).toBe('bookDock.processing.slowHint')
  })

  it('falls back to the plain status when the server says nothing about the line', () => {
    const wrapper = mount(BookDockStatusBadge, { props: { status: 'error' } })
    expect(wrapper.text()).toBe('bookDock.status.error')
  })
})
