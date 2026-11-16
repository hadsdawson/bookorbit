import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CopyTextButton from '../CopyTextButton.vue'

const clipboard = vi.hoisted(() => ({ copyToClipboard: vi.fn<(text: string) => Promise<boolean>>() }))
const toast = vi.hoisted(() => ({ error: vi.fn<(message: string) => void>() }))

vi.mock('@/lib/clipboard', () => clipboard)
vi.mock('vue-sonner', () => ({ toast }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('CopyTextButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('copies its text, shows that it did, and does not open the row underneath', async () => {
    clipboard.copyToClipboard.mockResolvedValue(true)
    const rowClick = vi.fn<() => void>()
    const wrapper = mount({
      components: { CopyTextButton },
      setup: () => ({ rowClick }),
      template: '<div @click="rowClick"><CopyTextButton text="Hard Eight" label="Copy title" /></div>',
    })

    const button = wrapper.get('[data-testid="copy-text"]')
    expect(button.attributes('aria-label')).toBe('Copy title')
    await button.trigger('click')
    await flushPromises()

    expect(clipboard.copyToClipboard).toHaveBeenCalledWith('Hard Eight')
    expect(rowClick).not.toHaveBeenCalled()
    expect(button.attributes('title')).toBe('bookRequests.copy.copied')
    vi.advanceTimersByTime(1_500)
    await flushPromises()
    expect(button.attributes('title')).toBe('Copy title')
  })

  it('says so when the clipboard refuses', async () => {
    clipboard.copyToClipboard.mockResolvedValue(false)
    const wrapper = mount(CopyTextButton, { props: { text: 'Janet Evanovich', label: 'Copy author' } })

    await wrapper.get('[data-testid="copy-text"]').trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('bookRequests.copy.failed')
  })
})
