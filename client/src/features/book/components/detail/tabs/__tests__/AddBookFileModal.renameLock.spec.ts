import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const startUpload = vi.fn<(bookId: number, options: { renameAfter?: boolean }) => Promise<void>>().mockResolvedValue(undefined)
const files = ref([{ id: 'a', file: new File(['x'], 'a.m4b'), status: 'pending', progress: 0 }])

vi.mock('@/features/book/composables/useAddBookFile', () => ({
  SUPPORTED_FORMATS_ACCEPT: '.m4b',
  useAddBookFile: () => ({
    files,
    pendingCount: computed(() => files.value.filter((file) => file.status === 'pending').length),
    isUploading: computed(() => false),
    doneCount: computed(() => 0),
    errorCount: computed(() => 0),
    addFiles: vi.fn<() => void>(),
    removeFile: vi.fn<() => void>(),
    retryFile: vi.fn<() => void>(),
    reset: vi.fn<() => void>(),
    startUpload,
  }),
}))
vi.mock('@/features/settings/composables/useAppInfo', () => ({ useAppInfo: () => ({ maxUploadSizeMb: ref(500) }) }))

import AddBookFileModal from '../AddBookFileModal.vue'

describe('AddBookFileModal rename lock', () => {
  it('shows the rename as always on and leaves the rename to the server', async () => {
    const wrapper = mount(AddBookFileModal, { props: { bookId: 7, canRenameFiles: true, renameLocked: true }, attachTo: document.body })
    const locked = document.querySelector<HTMLInputElement>('[data-testid="rename-locked"] input')!
    expect(locked.checked).toBe(true)
    expect(locked.disabled).toBe(true)

    const upload = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Upload'))
    upload!.click()
    await Promise.resolve()
    expect(startUpload).toHaveBeenCalledWith(7, { renameAfter: false })
    wrapper.unmount()
  })

  it('keeps the optional box when the library does not lock it', () => {
    const wrapper = mount(AddBookFileModal, { props: { bookId: 7, canRenameFiles: true, renameLocked: false }, attachTo: document.body })
    expect(document.querySelector('[data-testid="rename-locked"]')).toBeNull()
    expect(document.body.textContent).toContain('Rename all book files after upload')
    wrapper.unmount()
  })
})
