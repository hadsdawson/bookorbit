import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChapterHealthLookupPanel from '../ChapterHealthLookupPanel.vue'

function mountPanel(autoApply: { runtimeToleranceSeconds: number; canEdit: boolean } | null) {
  return mount(ChapterHealthLookupPanel, {
    props: { lookup: null, candidates: 3, selectedCount: 0, canLookUp: true, busy: false, autoApply },
  })
}

describe('ChapterHealthLookupPanel runtime tolerance', () => {
  it('lets someone with App settings change it and only offers Save once it changed', async () => {
    const wrapper = mountPanel({ runtimeToleranceSeconds: 2, canEdit: true })
    const input = wrapper.get('#chapter-runtime-tolerance')
    expect((input.element as HTMLInputElement).value).toBe('2')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Save')).toBe(false)

    await input.setValue('7.5')
    const save = wrapper.findAll('button').find((button) => button.text() === 'Save')!
    await save.trigger('click')
    expect(wrapper.emitted('saveTolerance')).toEqual([[7.5]])
  })

  it('keeps the value in range', async () => {
    const wrapper = mountPanel({ runtimeToleranceSeconds: 2, canEdit: true })
    await wrapper.get('#chapter-runtime-tolerance').setValue('500')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save')!
      .trigger('click')
    expect(wrapper.emitted('saveTolerance')).toEqual([[60]])
  })

  it('only shows the value to everyone else', () => {
    const wrapper = mountPanel({ runtimeToleranceSeconds: 5, canEdit: false })
    expect(wrapper.find('#chapter-runtime-tolerance').exists()).toBe(false)
    expect(wrapper.text()).toContain('within 5 seconds')
  })

  it('shows nothing about it before the setting loads', () => {
    expect(mountPanel(null).text()).not.toContain('Runtime must match')
  })
})
