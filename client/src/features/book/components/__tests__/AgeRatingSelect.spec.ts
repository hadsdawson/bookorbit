import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AgeRatingSelect from '../AgeRatingSelect.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('AgeRatingSelect', () => {
  it('offers Not rated and the five ratings, showing the current one', () => {
    const wrapper = mount(AgeRatingSelect, { props: { modelValue: 16 } })
    const options = wrapper.findAll('option')
    expect(options.map((option) => option.text())).toEqual([
      'ageRating.notRated',
      'ageRating.allAges',
      'ageRating.age10',
      'ageRating.age13',
      'ageRating.age16',
      'ageRating.age18',
    ])
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('16')
  })

  it('emits the rating as a number, and null for Not rated', async () => {
    const wrapper = mount(AgeRatingSelect, { props: { modelValue: null } })
    await wrapper.get('select').setValue('0')
    await wrapper.get('select').setValue('')
    expect(wrapper.emitted('update:modelValue')).toEqual([[0], [null]])
  })
})
