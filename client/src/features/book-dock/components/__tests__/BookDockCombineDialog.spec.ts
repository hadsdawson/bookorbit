import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookDockFile } from '@bookorbit/types'

const apiMock = vi.fn<(...args: unknown[]) => Promise<Response>>()
const libraryList = ref([
  { id: 1, formatPriority: ['epub', 'm4b'] },
  { id: 3, formatPriority: ['m4b', 'epub'] },
])

vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }))
vi.mock('@/features/library/composables/useBookDestination', () => ({
  useBookDestination: () => ({
    libraries: libraryList,
    libraryId: ref(1),
    folderId: ref(2),
    hasDestination: ref(true),
    fetchLibraries: vi.fn(),
  }),
}))

import BookDockCombineDialog from '../BookDockCombineDialog.vue'

function file(id: number, fileName: string, targetFolderId: number | null = null, targetLibraryId: number | null = null): BookDockFile {
  return { id, fileName, targetFolderId, targetLibraryId, selectedMetadata: { title: 'Book A' } } as unknown as BookDockFile
}

function mountDialog(files: BookDockFile[]) {
  return mount(BookDockCombineDialog, {
    props: { files },
    global: { stubs: { Teleport: true, BookDestinationFields: true } },
  })
}

function sentBody(): Record<string, unknown> {
  const [, init] = apiMock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string)
}

function combineButton(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.findAll('button').find((button) => button.text().trim() === 'Combine')!
}

describe('BookDockCombineDialog', () => {
  beforeEach(() => {
    apiMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 2, succeeded: 2, failed: 0, results: [], bookId: 9, primaryFileId: 2 }),
    } as Response)
  })

  it('follows the format priority of the library the book is headed to', async () => {
    const wrapper = mountDialog([file(1, 'Book A.epub', 7, 3), file(2, 'Book A.m4b', 7, 3)])
    await combineButton(wrapper).trigger('click')
    await flushPromises()
    expect(sentBody().primaryFileId).toBe(2)
  })

  it('makes the ebook the primary file when the library ranks it first, and sends the default destination', async () => {
    const wrapper = mountDialog([file(1, 'Book A.m4b'), file(2, 'Book A.epub')])
    await combineButton(wrapper).trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-dock/combine', expect.objectContaining({ method: 'POST' }))
    expect(sentBody()).toEqual({ fileIds: [1, 2], primaryFileId: 2, defaultLibraryId: 1, defaultFolderId: 2 })
    expect(wrapper.text()).toContain('All 2 files filed as one book')
  })

  it('sends the primary file the person picked', async () => {
    const wrapper = mountDialog([file(1, 'Book A.m4b'), file(2, 'Book A.epub')])
    await wrapper.findAll('input[type="radio"]')[0]!.setValue(true)
    await combineButton(wrapper).trigger('click')
    await flushPromises()
    expect(sentBody().primaryFileId).toBe(1)
  })

  it('leaves the destination out when the primary file already has its own', async () => {
    const wrapper = mountDialog([file(1, 'Book A.m4b'), file(2, 'Book A.epub', 5)])
    await combineButton(wrapper).trigger('click')
    await flushPromises()
    expect(sentBody()).toEqual({ fileIds: [1, 2], primaryFileId: 2 })
  })

  it('shows the server reason when combining is refused', async () => {
    apiMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Combining files needs a library that keeps each book in its own folder' }),
    } as Response)
    const wrapper = mountDialog([file(1, 'Book A.m4b'), file(2, 'Book A.epub')])
    await combineButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('keeps each book in its own folder')
  })
})
