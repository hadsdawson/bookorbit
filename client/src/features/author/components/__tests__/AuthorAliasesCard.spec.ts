import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddAuthorNameResult, AuthorNameKind, AuthorNames } from '@bookorbit/types'

import AuthorAliasesCard from '../AuthorAliasesCard.vue'

const mocks = vi.hoisted(() => ({
  addAuthorName: vi.fn<(authorId: number, name: string, kind: AuthorNameKind) => Promise<AddAuthorNameResult>>(),
  removeAuthorSpelling: vi.fn<(authorId: number, aliasId: number) => Promise<AuthorNames>>(),
  unlinkAuthorPenName: vi.fn<(authorId: number, otherId: number) => Promise<AuthorNames>>(),
}))

vi.mock('../../api/author', () => mocks)
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('@/features/book/composables/useAuthorSearch', () => ({
  useAuthorSearch: () => ({ search: vi.fn<() => Promise<string[]>>().mockResolvedValue([]) }),
}))

const names: AuthorNames = {
  spellings: [{ id: 5, name: 'S. McGuire' }],
  penNames: [{ id: 40, name: 'A. Deborah Baker', bookCount: 2 }],
  penNameOf: [],
}

function mountCard() {
  return mount(AuthorAliasesCard, {
    props: { authorId: 12, authorName: 'Seanan McGuire', names, canEdit: true },
    global: {
      stubs: {
        InputWithSuggestions: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: `<input data-test="name-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
      },
    },
  })
}

describe('AuthorAliasesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists pen names with their book counts apart from other spellings', () => {
    const wrapper = mountCard()
    expect(wrapper.get('[data-testid="author-pen-names"]').text()).toContain('A. Deborah Baker')
    expect(wrapper.get('[data-testid="author-pen-names"]').text()).toContain('2 books')
    expect(wrapper.get('[data-testid="author-spellings"]').text()).toContain('S. McGuire')
  })

  it('adds a pen name by default and passes the chosen kind', async () => {
    mocks.addAuthorName.mockResolvedValue({ names, mergedAuthorCount: 0, affectedBookCount: 0, openAuthorId: null })
    const wrapper = mountCard()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Add name'))!
      .trigger('click')
    await wrapper.get('[data-test="name-input"]').setValue('Mira Grant')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.addAuthorName).toHaveBeenCalledWith(12, 'Mira Grant', 'penName')
    expect(wrapper.emitted('update:names')?.[0]).toEqual([names])
  })

  it('opens the main name after making this author its pen name', async () => {
    mocks.addAuthorName.mockResolvedValue({ names, mergedAuthorCount: 0, affectedBookCount: 0, openAuthorId: 50 })
    const wrapper = mountCard()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Add name'))!
      .trigger('click')
    await wrapper.get('[data-test="name-input"]').setValue('James Elroy')
    await wrapper.get('[data-testid="author-name-kind"]').setValue('mainName')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.addAuthorName).toHaveBeenCalledWith(12, 'James Elroy', 'mainName')
    expect(wrapper.emitted('open')?.[0]).toEqual([50])
  })

  it('unties a pen name', async () => {
    mocks.unlinkAuthorPenName.mockResolvedValue({ ...names, penNames: [] })
    const wrapper = mountCard()
    await wrapper.get('[aria-label="Untie pen name A. Deborah Baker"]').trigger('click')
    await flushPromises()
    expect(mocks.unlinkAuthorPenName).toHaveBeenCalledWith(12, 40)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})
