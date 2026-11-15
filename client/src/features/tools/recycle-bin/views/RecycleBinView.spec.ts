import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecycleBinEntry, RecycleBinOverview, RecycleBinRestoreResult, RecycleBinSettings } from '@bookorbit/types'

import RecycleBinView from './RecycleBinView.vue'

const api = vi.hoisted(() => ({
  getRecycleBin: vi.fn<(page: number, pageSize: number) => Promise<RecycleBinOverview>>(),
  saveRecycleBinSettings: vi.fn<(settings: RecycleBinSettings) => Promise<RecycleBinSettings>>(),
  restoreRecycleBinEntry: vi.fn<(id: string) => Promise<RecycleBinRestoreResult>>(),
  deleteRecycleBinEntry: vi.fn<(id: string) => Promise<void>>(),
  emptyRecycleBin: vi.fn<() => Promise<{ removed: number; failed: number }>>(),
}))
const toast = vi.hoisted(() => ({
  error: vi.fn<(message: string) => void>(),
  success: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
}))

vi.mock('../../api/recycle-bin', () => api)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-sonner', () => ({ toast }))

const ConfirmDialogStub = {
  props: ['open'],
  emits: ['confirm', 'cancel'],
  template: '<div v-if="open" data-testid="confirm-dialog"><button data-testid="confirm" @click="$emit(\'confirm\')" /></div>',
}

function makeEntry(overrides: Partial<RecycleBinEntry> = {}): RecycleBinEntry {
  return {
    id: '001800000000000-deadbeef',
    kind: 'book',
    title: 'Dune',
    libraryName: 'Books',
    libraryFolderPath: '/books',
    deletedAt: '2026-11-15T10:00:00Z',
    deletedBy: 'Hads',
    expiresAt: '2026-12-15T10:00:00Z',
    files: [{ relPath: 'H/Frank Herbert/Dune/dune.epub', sizeBytes: 1024 }],
    sizeBytes: 1024,
    ...overrides,
  }
}

function makeOverview(entries: RecycleBinEntry[] = [makeEntry()], settings: Partial<RecycleBinSettings> = {}): RecycleBinOverview {
  return { settings: { enabled: true, keepDays: 30, ...settings }, entries, total: entries.length, page: 1, pageSize: 25 }
}

function mountView() {
  return mount(RecycleBinView, { global: { stubs: { ConfirmDialog: ConfirmDialogStub } } })
}

describe('RecycleBinView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists deleted books with where they came from', async () => {
    api.getRecycleBin.mockResolvedValue(makeOverview())
    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-testid="recycle-bin-entry"]')
    expect(row.text()).toContain('Dune')
    expect(row.text()).toContain('H/Frank Herbert/Dune/dune.epub')
    expect(row.text()).toContain('"library":"Books"')
  })

  it('says so when the bin is empty and offers nothing to empty', async () => {
    api.getRecycleBin.mockResolvedValue(makeOverview([]))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="recycle-bin-none"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="recycle-bin-empty"]').exists()).toBe(false)
  })

  it('restores an entry and reloads the list', async () => {
    api.getRecycleBin.mockResolvedValueOnce(makeOverview()).mockResolvedValueOnce(makeOverview([]))
    api.restoreRecycleBinEntry.mockResolvedValue({ restored: 1, conflicts: [], missing: [] })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="recycle-bin-restore"]').trigger('click')
    await flushPromises()

    expect(api.restoreRecycleBinEntry).toHaveBeenCalledWith('001800000000000-deadbeef')
    expect(toast.success).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="recycle-bin-entry"]').exists()).toBe(false)
  })

  it('warns when a restored file had to stay in the bin', async () => {
    api.getRecycleBin.mockResolvedValue(makeOverview())
    api.restoreRecycleBinEntry.mockResolvedValue({ restored: 0, conflicts: ['a.epub'], missing: [] })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="recycle-bin-restore"]').trigger('click')
    await flushPromises()

    expect(toast.warning).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('deletes for good only after confirming', async () => {
    api.getRecycleBin.mockResolvedValue(makeOverview())
    api.deleteRecycleBinEntry.mockResolvedValue(undefined)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="recycle-bin-delete"]').trigger('click')
    expect(api.deleteRecycleBinEntry).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="confirm"]').trigger('click')
    await flushPromises()

    expect(api.deleteRecycleBinEntry).toHaveBeenCalledWith('001800000000000-deadbeef')
  })

  it('empties the bin only after confirming', async () => {
    api.getRecycleBin.mockResolvedValue(makeOverview())
    api.emptyRecycleBin.mockResolvedValue({ removed: 1, failed: 0 })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="recycle-bin-empty"]').trigger('click')
    expect(api.emptyRecycleBin).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="confirm"]').trigger('click')
    await flushPromises()

    expect(api.emptyRecycleBin).toHaveBeenCalledTimes(1)
  })

  it('saves a new keep period', async () => {
    api.getRecycleBin.mockResolvedValue(makeOverview())
    api.saveRecycleBinSettings.mockResolvedValue({ enabled: true, keepDays: 60 })
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="recycle-bin-keep-days"]').setValue('60')
    await flushPromises()

    expect(api.saveRecycleBinSettings).toHaveBeenCalledWith({ enabled: true, keepDays: 60 })
  })
})
