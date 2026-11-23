import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { LibraryFolder, LibraryStats } from '@bookorbit/types'
import type { FolderCheck } from '../../composables/useLibraryCreator'
import LibraryFolderRelocateDialog from '@/features/settings/libraries/components/LibraryFolderRelocateDialog.vue'
import LibraryCreatorFolders from '../LibraryCreatorFolders.vue'

describe('LibraryCreatorFolders', () => {
  it('adds a pasted path from the always-visible path field', async () => {
    const wrapper = mountFolders()

    await wrapper.get('#manual-folder-path').setValue('/books/fiction')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('update:folders')).toEqual([[['/books/fiction']]])
  })

  it('rejects a relative path with a message tied to the field', async () => {
    const wrapper = mountFolders()

    await wrapper.get('#manual-folder-path').setValue('books')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('update:folders')).toBeUndefined()
    expect(wrapper.get('#manual-folder-error').text()).toBe('Enter an absolute server path beginning with /.')
    expect(wrapper.get('#manual-folder-path').attributes('aria-describedby')).toBe('manual-folder-error')
  })

  it('shows each folder check beside its folder', () => {
    const wrapper = mountFolders({
      folders: ['/books/fantasy', '/books/comics', '/books/missing', '/books/new'],
      checks: {
        '/books/fantasy': { state: 'checked', accessible: true, fileCount: 1250 },
        '/books/comics': { state: 'checked', accessible: true, fileCount: 11, overlapLibrary: 'Comics' },
        '/books/missing': { state: 'checked', accessible: false, fileCount: 0 },
        '/books/new': { state: 'checking' },
      },
    })

    const rows = wrapper.findAll('li')
    expect(rows[0]!.text()).toContain('1,250 files')
    expect(rows[1]!.text()).toContain('Overlaps Comics')
    expect(rows[2]!.text()).toContain('Not accessible')
    expect(rows[3]!.text()).toContain('Checking')
    expect(wrapper.text()).toContain('1,261 matching files')
  })

  it('bolds the folder name and keeps the parent path quiet', () => {
    const wrapper = mountFolders({ folders: ['/mnt/media/books/Novels'] })
    const path = wrapper.get('li p')

    expect(path.findAll('span').map((span) => span.text())).toEqual(['/mnt/media/books/', 'Novels'])
  })

  it('asks for a recheck of one folder after a failed check', async () => {
    const wrapper = mountFolders({ folders: ['/books'], checks: { '/books': { state: 'failed' } } })

    await wrapper.get('button[aria-label="Check /books again"]').trigger('click')

    expect(wrapper.emitted('check')).toEqual([[['/books']]])
  })

  it('shows what an existing library holds before any folder is rechecked', () => {
    const stats: LibraryStats = { totalBooks: 455, totalSizeBytes: 787_300_000, formatCounts: { epub: 378, pdf: 6 } }
    const wrapper = mountFolders({ folders: ['/books'], stats })

    expect(wrapper.text()).toContain('455 books')
    expect(wrapper.text()).toContain('EPUB')
  })
  describe('change location', () => {
    const saved: LibraryFolder = { id: 7, path: '/books/bookorbit' } as LibraryFolder
    const relocateLabel = 'button[aria-label="Change location"]'

    it('offers Change location only for a folder the library already has', () => {
      const wrapper = mountFolders({ folders: ['/books/bookorbit', '/books/new'], libraryId: 3, savedFolders: [saved] })

      const rows = wrapper.findAll('li')
      expect(rows[0]!.find(relocateLabel).exists()).toBe(true)
      expect(rows[1]!.find(relocateLabel).exists()).toBe(false)
    })

    it('hides it while a new library is being created', () => {
      const wrapper = mountFolders({ folders: ['/books/bookorbit'], libraryId: null, savedFolders: [saved] })

      expect(wrapper.find(relocateLabel).exists()).toBe(false)
    })

    it('disables it while the editor has unsaved changes', () => {
      const wrapper = mountFolders({ folders: ['/books/bookorbit'], libraryId: 3, savedFolders: [saved], relocationBlocked: true })

      expect(wrapper.get(relocateLabel).attributes('disabled')).toBeDefined()
    })

    it('opens the dialog for that folder and tells the editor a nested window is open', async () => {
      const wrapper = mountFolders({ folders: ['/books/bookorbit'], libraryId: 3, savedFolders: [saved] })

      await wrapper.get(relocateLabel).trigger('click')

      expect(wrapper.findComponent(LibraryFolderRelocateDialog).props('folder')).toEqual(saved)
      expect(wrapper.emitted('update:pickerOpen')).toEqual([[true]])
    })

    it('passes a finished relocation up and closes the dialog', async () => {
      const wrapper = mountFolders({ folders: ['/books/bookorbit'], libraryId: 3, savedFolders: [saved] })
      await wrapper.get(relocateLabel).trigger('click')

      const dialog = wrapper.findComponent(LibraryFolderRelocateDialog)
      dialog.vm.$emit('relocated')
      dialog.vm.$emit('close')
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('relocated')).toHaveLength(1)
      expect(wrapper.findComponent(LibraryFolderRelocateDialog).exists()).toBe(false)
      expect(wrapper.emitted('update:pickerOpen')).toEqual([[true], [false]])
    })
  })
})

function mountFolders(
  props: {
    folders?: string[]
    checks?: Record<string, FolderCheck>
    stats?: LibraryStats | null
    libraryId?: number | null
    savedFolders?: LibraryFolder[]
    relocationBlocked?: boolean
  } = {},
) {
  return mount(LibraryCreatorFolders, {
    props: {
      folders: props.folders ?? [],
      checks: props.checks ?? {},
      stats: props.stats ?? null,
      libraryId: props.libraryId ?? null,
      savedFolders: props.savedFolders ?? [],
      relocationBlocked: props.relocationBlocked ?? false,
    },
    global: {
      stubs: {
        FolderPickerModal: true,
        LibraryFolderRelocateDialog: true,
      },
    },
  })
}
