import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryFolderRelocateDialog from '../components/LibraryFolderRelocateDialog.vue'

const api = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())
const refreshLibraries = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock('@/lib/api', () => ({
  api,
  NetworkError: class NetworkError extends Error {},
}))
vi.mock('@/features/library/composables/useLibraries', () => ({ useLibraries: () => ({ refreshLibraries }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const READY = {
  oldPath: '/books/bookorbit',
  newPath: '/data/books',
  bookCount: 120,
  fileCount: 130,
  filesFound: 130,
  filesMissing: 0,
  filesWrongSize: 0,
  filesNewerOrOlder: 0,
  pathConflicts: 0,
  sampleProblems: [],
  canApply: true,
}

describe('LibraryFolderRelocateDialog', () => {
  beforeEach(() => api.mockReset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountDialog() {
    return mount(LibraryFolderRelocateDialog, {
      props: { libraryId: 3, libraryName: 'The NeverEnding Shelf', folder: { id: 9, path: '/books/bookorbit', createdAt: '2026-01-01T00:00:00Z' } },
      attachTo: document.body,
    })
  }

  const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!

  async function typePath(path: string) {
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('#relocate-new-path')!
    input.value = path
    input.dispatchEvent(new Event('input'))
    await flushPromises()
  }

  it('keeps both actions off until a location is typed and checked', async () => {
    mountDialog()
    await flushPromises()

    expect(button('Check location').disabled).toBe(true)
    expect(button('Change location').disabled).toBe(true)

    await typePath('/data/books')
    expect(button('Check location').disabled).toBe(false)
    expect(button('Change location').disabled).toBe(true)
  })

  it('previews the new location and then applies it', async () => {
    api
      .mockResolvedValueOnce(json(READY))
      .mockResolvedValueOnce(json({ folderId: 9, oldPath: '/books/bookorbit', newPath: '/data/books', bookCount: 120, fileCount: 130 }))
    const wrapper = mountDialog()
    await typePath('/data/books')

    button('Check location').click()
    await flushPromises()

    expect(api).toHaveBeenNthCalledWith(
      1,
      '/api/v1/libraries/3/folders/9/relocate/preview',
      expect.objectContaining({ body: JSON.stringify({ newPath: '/data/books' }) }),
    )
    expect(document.body.textContent).toContain('130 of 130 files found for 120 books.')
    expect(button('Change location').disabled).toBe(false)

    button('Change location').click()
    await flushPromises()

    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/libraries/3/folders/9/relocate', expect.objectContaining({ method: 'POST' }))
    expect(refreshLibraries).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('lists what is missing and does not allow the change', async () => {
    api.mockResolvedValueOnce(json({ ...READY, filesFound: 128, filesMissing: 2, canApply: false, sampleProblems: ['Missing: Ann/Book/one.epub'] }))
    mountDialog()
    await typePath('/data/books')

    button('Check location').click()
    await flushPromises()

    expect(document.body.textContent).toContain('2 files are missing from the new location.')
    expect(document.body.textContent).toContain('Missing: Ann/Book/one.epub')
    expect(button('Change location').disabled).toBe(true)
  })

  it('clears the preview when the typed location changes', async () => {
    api.mockResolvedValueOnce(json(READY))
    mountDialog()
    await typePath('/data/books')
    button('Check location').click()
    await flushPromises()
    expect(button('Change location').disabled).toBe(false)

    await typePath('/data/other')

    expect(button('Change location').disabled).toBe(true)
  })

  it('shows a readable message when the server refuses', async () => {
    api.mockResolvedValueOnce(json({ message: 'nested', errorCode: 'LIBRARY_RELOCATION_NESTED' }, 400))
    mountDialog()
    await typePath('/books/bookorbit/sub')

    button('Check location').click()
    await flushPromises()

    expect(document.body.textContent).toContain('cannot sit inside the current folder')
  })
})
