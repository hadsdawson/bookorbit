import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PublishersView from './PublishersView.vue'

const api = vi.hoisted(() => ({ browseEntities: vi.fn(), renameEntity: vi.fn(), mergeEntities: vi.fn() }))
const push = vi.hoisted(() => vi.fn())

vi.mock('@/features/tools/api/entity-manager', () => api)
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@vueuse/core', () => ({ useDebounceFn: (fn: () => void) => fn }))

const stubs = {
  RenameModal: { props: ['currentName'], emits: ['confirm', 'cancel'], template: '<div data-testid="rename-modal">{{ currentName }}</div>' },
  BrowseMergeModal: { props: ['items'], emits: ['confirm', 'cancel'], template: '<div data-testid="merge-modal">{{ items.length }}</div>' },
}

function page(names: [string, number][], total = names.length) {
  return { items: names.map(([name, bookCount]) => ({ id: name, name, bookCount })), total, page: 1, pageSize: 50 }
}

async function mountView() {
  const wrapper = mount(PublishersView, { global: { stubs } })
  await flushPromises()
  return wrapper
}

function emitFrom(wrapper: VueWrapper, stub: object, event: string, ...args: unknown[]): void {
  const component = wrapper.findComponent(stub as never) as unknown as VueWrapper
  component.vm.$emit(event, ...args)
}

describe('PublishersView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.browseEntities.mockResolvedValue(
      page([
        ['Tor', 12],
        ['Tor Books', 3],
        ['Orbit', 7],
      ]),
    )
  })

  it('lists publishers with their book counts', async () => {
    const wrapper = await mountView()

    expect(api.browseEntities).toHaveBeenCalledWith('publisher', expect.objectContaining({ page: 1, pageSize: 50, sortBy: 'name', sortOrder: 'asc' }))
    const rows = wrapper.findAll('[data-testid="publisher-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('Tor')
    expect(rows[0]?.text()).toContain('"count":12')
  })

  it('searches and sorts from the first page', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-testid="publishers-search"]').setValue('tor')
    await flushPromises()
    expect(api.browseEntities).toHaveBeenLastCalledWith('publisher', expect.objectContaining({ search: 'tor', page: 1 }))

    await wrapper.get('[data-testid="publishers-sort"]').setValue('bookCount:desc')
    await flushPromises()
    expect(api.browseEntities).toHaveBeenLastCalledWith('publisher', expect.objectContaining({ sortBy: 'bookCount', sortOrder: 'desc', page: 1 }))
  })

  it('opens a publisher by name', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('[data-testid="publisher-row"] button')[0]!.trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'publisher-detail', params: { name: 'Tor' } })
  })

  it('merges the selected publishers by name and reloads', async () => {
    api.mergeEntities.mockResolvedValue({})
    const wrapper = await mountView()
    const boxes = wrapper.findAll('[data-testid="publisher-row"] input[type="checkbox"]')

    await boxes[0]!.trigger('change')
    expect(wrapper.get('[data-testid="publishers-merge"]').attributes('disabled')).toBeDefined()
    await boxes[1]!.trigger('change')
    await wrapper.get('[data-testid="publishers-merge"]').trigger('click')
    expect(wrapper.get('[data-testid="merge-modal"]').text()).toBe('2')

    emitFrom(wrapper, stubs.BrowseMergeModal, 'confirm', 'Tor', ['Tor Books'], true)
    await flushPromises()

    expect(api.mergeEntities).toHaveBeenCalledWith('publisher', { targetValue: 'Tor', sourceValues: ['Tor Books'], writeFiles: true })
    expect(api.browseEntities).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="publishers-selection-bar"]').exists()).toBe(false)
  })

  it('renames a publisher by its current name', async () => {
    api.renameEntity.mockResolvedValue({})
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="publisher-row"] button')[5]!.trigger('click')
    expect(wrapper.get('[data-testid="rename-modal"]').text()).toBe('Orbit')
    emitFrom(wrapper, stubs.RenameModal, 'confirm', 'Orbit Books', false)
    await flushPromises()

    expect(api.renameEntity).toHaveBeenCalledWith('publisher', { currentValue: 'Orbit', newName: 'Orbit Books', writeFiles: false })
    expect(wrapper.find('[data-testid="rename-modal"]').exists()).toBe(false)
  })

  it('says so when the list cannot be loaded', async () => {
    api.browseEntities.mockRejectedValue(new Error('forbidden'))
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('publishers.errors.load')
  })
})
