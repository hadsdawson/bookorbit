import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof import('@/lib/api').api>() }))

import { api } from '@/lib/api'
import { useAuthorAliasHints } from './useAuthorAliasHints'

describe('useAuthorAliasHints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(api).mockResolvedValue(new Response(JSON.stringify([{ alias: 'A.M. Woody', name: 'Amanda Woody' }]), { status: 200 }))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks about typed names and swaps an alternate name for the main one', async () => {
    const authors = ref(['A.M. Woody', 'Amanda Woody', 'Co Author'])
    const { hints, applyHint } = useAuthorAliasHints(authors)
    await vi.runAllTimersAsync()

    expect(hints.value).toEqual([{ alias: 'A.M. Woody', name: 'Amanda Woody' }])
    applyHint(hints.value[0]!)
    await nextTick()
    expect(authors.value).toEqual(['Amanda Woody', 'Co Author'])
  })
})
