import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { BookRequestItem } from '@bookorbit/types'

import RequestTrackingStatusSelect from '../RequestTrackingStatusSelect.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return { id: 1, title: 'Hard Eight', mediaKind: 'audiobook', trackingStatus: null, trackingStatusAuto: false, ...overrides } as BookRequestItem
}

describe('RequestTrackingStatusSelect', () => {
  it('fork: offers Grabbed and sends it as a hand-set choice', async () => {
    const wrapper = mount(RequestTrackingStatusSelect, { props: { request: request(), editable: true, busy: false } })

    const select = wrapper.get('select')
    expect(select.findAll('option').map((option) => option.attributes('value'))).toContain('grabbed')
    await select.setValue('grabbed')

    expect(wrapper.emitted('change')?.[0]?.[1]).toBe('grabbed')
  })

  it('fork: shows a grabbed request in the success colour', () => {
    const wrapper = mount(RequestTrackingStatusSelect, { props: { request: request({ trackingStatus: 'grabbed' }), editable: false, busy: false } })

    expect(wrapper.text()).toContain('bookRequests.trackingStatus.grabbed')
    expect(wrapper.html()).toContain('text-success')
  })
})
