import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useRequestFormatText', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('hides the format text by default', async () => {
    const { useRequestFormatText } = await import('../composables/useRequestFormatText')
    expect(useRequestFormatText().shown.value).toBe(false)
  })

  it('remembers a choice to show it', async () => {
    const { useRequestFormatText } = await import('../composables/useRequestFormatText')
    useRequestFormatText().setShown(true)
    vi.resetModules()
    const again = await import('../composables/useRequestFormatText')
    expect(again.useRequestFormatText().shown.value).toBe(true)
  })
})
