import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useRequestShortcuts } from '../composables/useRequestShortcuts'

const state = vi.hoisted(() => ({ push: vi.fn<(to: unknown) => void>(), canManage: true }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: state.push }) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => state.canManage }),
}))

const Host = defineComponent({
  setup() {
    useRequestShortcuts()
    return () => null
  },
})

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('useRequestShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.push.mockReset()
    state.canManage = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes to all requests on G then R for managers', () => {
    const wrapper = mount(Host)
    press('g')
    press('r')
    expect(state.push).toHaveBeenCalledWith({ name: 'book-requests', query: { tab: 'all' } })
    wrapper.unmount()
  })

  it('goes to my requests on G then R for people who cannot manage requests', () => {
    state.canManage = false
    const wrapper = mount(Host)
    press('g')
    press('r')
    expect(state.push).toHaveBeenCalledWith({ name: 'book-requests', query: { tab: 'mine' } })
    wrapper.unmount()
  })

  it('goes to Request a book on R then B', () => {
    const wrapper = mount(Host)
    press('r')
    press('b')
    expect(state.push).toHaveBeenCalledWith({ name: 'book-requests', query: { tab: 'search' } })
    wrapper.unmount()
  })

  it('does nothing for a single key or a wrong pair', () => {
    const wrapper = mount(Host)
    press('g')
    press('b')
    press('r')
    press('r')
    expect(state.push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('forgets the first key after the timeout', () => {
    const wrapper = mount(Host)
    press('g')
    vi.advanceTimersByTime(2000)
    press('r')
    expect(state.push).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignores keys typed into a text field', () => {
    const wrapper = mount(Host)
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('g', {}, input)
    press('r', {}, input)
    expect(state.push).not.toHaveBeenCalled()
    input.remove()
    wrapper.unmount()
  })

  it('ignores keys pressed with a modifier', () => {
    const wrapper = mount(Host)
    press('g')
    press('r', { metaKey: true })
    expect(state.push).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
