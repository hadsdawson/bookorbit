import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PublisherDetailView from './PublisherDetailView.vue'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  renameEntity: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  route: { params: { name: 'Tor' } },
}))

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: mocks.api }))
vi.mock('@/features/tools/api/entity-manager', () => ({ browseEntities: vi.fn(), mergeEntities: vi.fn(), renameEntity: mocks.renameEntity }))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/composables/useDisplaySettings', () => ({ useDisplaySettings: () => ({ portraitCoverSize: { value: 160 }, gridGap: { value: 16 } }) }))

const stubs = {
  VirtualBookGrid: { props: ['books'], template: '<div data-testid="grid">{{ books.map((book) => book.id).join(",") }}</div>' },
  BookQuickView: true,
  AddToCollectionSheet: true,
  RenameModal: { props: ['currentName'], emits: ['confirm', 'cancel'], template: '<div data-testid="rename-modal" />' },
}

function booksPage(ids: number[], total: number, page = 0) {
  return { ok: true, json: () => Promise.resolve({ items: ids.map((id) => ({ id })), total, page, size: 60 }) }
}

function emitFrom(wrapper: VueWrapper, stub: object, event: string, ...args: unknown[]): void {
  const component = wrapper.findComponent(stub as never) as unknown as VueWrapper
  component.vm.$emit(event, ...args)
}

describe('PublisherDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("asks for the publisher's books by exact name and loads more on request", async () => {
    mocks.api.mockResolvedValueOnce(booksPage([1, 2], 3)).mockResolvedValueOnce(booksPage([3], 3, 1))
    const wrapper = mount(PublisherDetailView, { global: { stubs } })
    await flushPromises()

    const [url, init] = mocks.api.mock.calls[0]!
    expect(url).toBe('/api/v1/books/query')
    expect(JSON.parse(init.body)).toMatchObject({
      pagination: { page: 0, size: 60 },
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'publisher', operator: 'eq', value: 'Tor' }] },
    })
    expect(wrapper.get('[data-testid="publisher-name"]').text()).toBe('Tor')
    expect(wrapper.get('[data-testid="grid"]').text()).toBe('1,2')

    await wrapper.get('[data-testid="publisher-load-more"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(mocks.api.mock.calls[1]![1].body).pagination.page).toBe(1)
    expect(wrapper.get('[data-testid="grid"]').text()).toBe('1,2,3')
    expect(wrapper.find('[data-testid="publisher-load-more"]').exists()).toBe(false)
  })

  it('renames the publisher and moves to its new page', async () => {
    mocks.api.mockResolvedValue(booksPage([1], 1))
    mocks.renameEntity.mockResolvedValue({})
    const wrapper = mount(PublisherDetailView, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="publisher-rename"]').trigger('click')
    emitFrom(wrapper, stubs.RenameModal, 'confirm', 'Tor Books', true)
    await flushPromises()

    expect(mocks.renameEntity).toHaveBeenCalledWith('publisher', { currentValue: 'Tor', newName: 'Tor Books', writeFiles: true })
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'publisher-detail', params: { name: 'Tor Books' } })
  })

  it('says so when the books cannot be loaded', async () => {
    mocks.api.mockResolvedValue({ ok: false, status: 500 })
    const wrapper = mount(PublisherDetailView, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('publishers.errors.loadBooks')
  })
})
