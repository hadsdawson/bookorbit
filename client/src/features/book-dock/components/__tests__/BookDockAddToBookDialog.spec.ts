import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookDockFile, BookDockFinalizeResult } from '@bookorbit/types'

import BookDockAddToBookDialog from '../BookDockAddToBookDialog.vue'

const finalizeState = vi.hoisted(() => ({
  finalize: vi.fn<(payload: unknown) => Promise<void>>(),
  next: null as BookDockFinalizeResult | null,
}))
const libraries = vi.hoisted(() => ({ list: [] as { id: number; name: string; organizationMode: string; folders: { id: number }[] }[] }))
const toast = vi.hoisted(() => ({ success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() }))

vi.mock('@/features/library/composables/useBookDestination', () => ({
  useBookDestination: () => ({ libraries: ref(libraries.list), fetchLibraries: vi.fn<() => Promise<void>>(() => Promise.resolve()) }),
}))
vi.mock('../../composables/useBookDockFinalize', () => ({
  useBookDockFinalize: () => {
    const result = ref<BookDockFinalizeResult | null>(null)
    return {
      result,
      error: ref<string | null>(null),
      loading: ref(false),
      finalize: async (payload: unknown) => {
        await finalizeState.finalize(payload)
        result.value = finalizeState.next
      },
    }
  },
}))
vi.mock('vue-sonner', () => ({ toast }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

const PickerStub = {
  props: ['libraryId', 'fileName'],
  emits: ['pick', 'cancel'],
  template:
    '<button data-testid="picker" :data-library="libraryId" :data-file="fileName" @click="$emit(\'pick\', { bookId: 42, title: \'Hard Eight\' })" />',
}

function file(id: number, targetLibraryId: number | null = null): BookDockFile {
  return { id, fileName: `book-${id}.m4b`, targetLibraryId } as unknown as BookDockFile
}

function mountDialog(files: BookDockFile[]) {
  return mount(BookDockAddToBookDialog, {
    props: { files },
    global: { stubs: { Teleport: true, BookDockJoinBookPicker: PickerStub } },
  })
}

describe('BookDockAddToBookDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    finalizeState.next = null
    libraries.list = [
      { id: 1, name: 'Ebooks', organizationMode: 'book_per_folder', folders: [{ id: 10 }] },
      { id: 2, name: 'Flat', organizationMode: 'book_per_file', folders: [{ id: 20 }] },
      { id: 3, name: 'Audiobooks', organizationMode: 'book_per_folder', folders: [{ id: 30 }] },
    ]
  })

  it('searches the library the files are headed for, and only offers libraries that keep a folder per book', () => {
    const wrapper = mountDialog([file(5, 3), file(6, 3)])

    expect(wrapper.get('[data-testid="picker"]').attributes('data-library')).toBe('3')
    expect(wrapper.findAll('[data-testid="book-dock-add-to-book-library"] option').map((option) => option.text())).toEqual(['Ebooks', 'Audiobooks'])
  })

  it('files every selected file into the picked book after confirming', async () => {
    finalizeState.next = { total: 2, succeeded: 2, failed: 0, results: [] }
    const wrapper = mountDialog([file(5), file(6)])

    await wrapper.get('[data-testid="picker"]').trigger('click')
    expect(wrapper.get('[data-testid="book-dock-add-to-book-confirm"]').text()).toContain('Hard Eight')
    await wrapper.get('[data-testid="book-dock-add-to-book-submit"]').trigger('click')
    await flushPromises()

    expect(finalizeState.finalize).toHaveBeenCalledWith({
      fileIds: [5, 6],
      overrides: [
        { fileId: 5, libraryId: 1, joinBook: { bookId: 42 } },
        { fileId: 6, libraryId: 1, joinBook: { bookId: 42 } },
      ],
    })
    expect(toast.success).toHaveBeenCalled()
    expect(wrapper.emitted('added')).toHaveLength(1)
  })

  it('stays open and explains a file the book could not take', async () => {
    finalizeState.next = {
      total: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { fileId: 5, fileName: 'book-5.epub', success: true },
        { fileId: 6, fileName: 'book-6.m4b', success: false, errorCode: 'BOOK_DOCK_JOIN_AUDIO_CONFLICT' },
      ],
    }
    const wrapper = mountDialog([file(5), file(6)])

    await wrapper.get('[data-testid="picker"]').trigger('click')
    await wrapper.get('[data-testid="book-dock-add-to-book-submit"]').trigger('click')
    await flushPromises()

    const failures = wrapper.get('[data-testid="book-dock-add-to-book-failures"]').text()
    expect(failures).toContain('book-6.m4b')
    expect(failures).toContain('bookDock.finalizeDialog.join.error.BOOK_DOCK_JOIN_AUDIO_CONFLICT')
    expect(wrapper.emitted('added')).toBeUndefined()
  })

  it('says so when no library can take another format into a book', () => {
    libraries.list = [{ id: 2, name: 'Flat', organizationMode: 'book_per_file', folders: [{ id: 20 }] }]
    const wrapper = mountDialog([file(5)])
    expect(wrapper.find('[data-testid="book-dock-add-to-book-none"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="picker"]').exists()).toBe(false)
  })
})
