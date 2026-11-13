import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { AgeRatingFilterValue } from '@bookorbit/types'

import UserRestrictionsSection from '../UserRestrictionsSection.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../../composables/useContentFilterSearch', () => ({
  useTagSearchWithIds: () => ({ search: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]) }),
  useGenreSearchWithIds: () => ({ search: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]) }),
}))

function mountSection(include: AgeRatingFilterValue[], exclude: AgeRatingFilterValue[]) {
  return mount(UserRestrictionsSection, {
    props: {
      isEdit: true,
      isSuperuserTarget: false,
      selected: new Set<string>(),
      contentFiltersEnabled: true,
      includeTags: [],
      excludeTags: [],
      includeGenres: [],
      excludeGenres: [],
      includeAgeRatings: include,
      excludeAgeRatings: exclude,
      seeOwnRequestedBooks: false,
    },
    global: { stubs: { ContentFilterChipInput: true, ToggleSwitch: true } },
  })
}

describe('UserRestrictionsSection age ratings', () => {
  it('shows each rating and Not rated in both pickers, pressed when chosen', () => {
    const wrapper = mountSection([0], [18])
    const include = wrapper.get('[data-testid="include-age-ratings"]')
    expect(include.findAll('button')).toHaveLength(6)
    expect(include.get('[data-rating="0"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="exclude-age-ratings"] [data-rating="18"]').attributes('aria-pressed')).toBe('true')
  })

  it('takes a rating off the other list when it is picked on one', async () => {
    const wrapper = mountSection([0, 13], [18])

    await wrapper.get('[data-testid="exclude-age-ratings"] [data-rating="13"]').trigger('click')
    expect(wrapper.emitted('update:excludeAgeRatings')?.at(-1)).toEqual([[18, 13]])
    expect(wrapper.emitted('update:includeAgeRatings')?.at(-1)).toEqual([[0]])

    await wrapper.get('[data-testid="include-age-ratings"] [data-rating="-1"]').trigger('click')
    expect(wrapper.emitted('update:includeAgeRatings')?.at(-1)).toEqual([[0, -1]])
  })
})
