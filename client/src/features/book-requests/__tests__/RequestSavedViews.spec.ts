import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

import en from '@/locales/en.json'

const api = vi.hoisted(() => ({
  list: vi.fn<() => Promise<unknown[]>>(),
  save: vi.fn<(name: string, filters: unknown) => Promise<unknown>>(),
  remove: vi.fn<(id: number) => Promise<void>>(),
}))

vi.mock('../api/saved-views', () => ({
  listSavedViews: api.list,
  saveSavedView: api.save,
  deleteSavedView: api.remove,
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import RequestSavedViews from '../components/RequestSavedViews.vue'
import { DEFAULT_LIST_STATE } from '../requestListQuery'

function mountViews(state = DEFAULT_LIST_STATE) {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  return mount(RequestSavedViews, { props: { state, showRequester: false }, global: { plugins: [i18n] } })
}

describe('RequestSavedViews', () => {
  beforeEach(() => {
    api.list.mockReset().mockResolvedValue([{ id: 1, name: 'Audio to chase', filters: { format: 'audiobook' } }])
    api.save.mockReset().mockImplementation((name: string, filters: unknown) => Promise.resolve({ id: 2, name, filters }))
    api.remove.mockReset().mockResolvedValue(undefined)
  })

  it('applies a saved view by emitting its filters', async () => {
    const wrapper = mountViews()
    await flushPromises()
    await wrapper.get('button[data-view-id="1"]').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ format: 'audiobook', status: '' })
  })

  it('will not save until there is a filter and a name', async () => {
    const wrapper = mountViews()
    await flushPromises()
    await wrapper.get('[data-testid="saved-view-name"]').setValue('Mine')
    expect(wrapper.get('[data-testid="saved-view-save"]').attributes('disabled')).toBeDefined()
  })

  it('saves the current filters under the typed name', async () => {
    const wrapper = mountViews({ ...DEFAULT_LIST_STATE, format: 'ebook' })
    await flushPromises()
    await wrapper.get('[data-testid="saved-view-name"]').setValue('  Ebooks  ')
    await wrapper.get('[data-testid="saved-view-save"]').trigger('click')
    await flushPromises()
    expect(api.save).toHaveBeenCalledWith('Ebooks', { format: 'ebook' })
  })

  it('deletes a view', async () => {
    const wrapper = mountViews()
    await flushPromises()
    await wrapper.get('button[data-view-id="1"] + button').trigger('click')
    await flushPromises()
    expect(api.remove).toHaveBeenCalledWith(1)
  })
})
