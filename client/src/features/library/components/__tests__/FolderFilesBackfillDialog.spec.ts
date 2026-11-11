import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FolderFilesBackfillDialog from '../FolderFilesBackfillDialog.vue'
import { describeEstimate } from '../../composables/useFolderFilesBackfill'

const api = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({ api }))

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const ESTIMATE = { books: 1200, sharedFolderBooks: 3, estimatedSeconds: { low: 30, high: 150 } }

describe('FolderFilesBackfillDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  function mountDialog() {
    return mount(FolderFilesBackfillDialog, { props: { libraryId: 4, libraryName: 'Audiobooks' }, attachTo: document.body })
  }

  it('explains the time and side effects before anything is written', async () => {
    api.mockResolvedValueOnce(json(ESTIMATE))
    mountDialog()
    await flushPromises()

    const text = document.body.textContent ?? ''
    expect(api).toHaveBeenCalledWith('/api/v1/libraries/4/folder-files/estimate')
    expect(text).toContain('1,200 books')
    expect(text).toContain('3 books share a folder')
    expect(text).toContain('cover.jpg, cover-ebook.jpg or metadata.json already in those folders is replaced')
    expect(text).toContain('Audiobookshelf')
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('closes without writing when only future changes are wanted', async () => {
    api.mockResolvedValueOnce(json(ESTIMATE))
    const wrapper = mountDialog()
    await flushPromises()

    const forward = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('Only from now on'))!
    forward.click()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('starts the run, follows its progress and reports the result', async () => {
    api
      .mockResolvedValueOnce(json(ESTIMATE))
      .mockResolvedValueOnce(json({ running: true, total: 1200, processed: 0, written: 0, unchanged: 0, skipped: 0, failed: 0 }))
      .mockResolvedValueOnce(json({ status: { running: false, total: 1200, processed: 1200, written: 1190, unchanged: 5, skipped: 3, failed: 2 } }))
    const wrapper = mountDialog()
    await flushPromises()

    const writeAll = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('Write all now'))!
    writeAll.click()
    await flushPromises()
    expect(api).toHaveBeenCalledWith('/api/v1/libraries/4/folder-files/write-all', { method: 'POST' })
    expect(document.body.textContent).toContain('0 of 1,200 books')

    await vi.advanceTimersByTimeAsync(2_000)
    await flushPromises()
    expect(api).toHaveBeenLastCalledWith('/api/v1/libraries/4/folder-files/status')
    expect(document.body.textContent).toContain('1,190 written, 5 already up to date, 5 skipped')
    expect(wrapper.emitted('finished')).toEqual([[1190]])
  })

  it('closes on its own when no book owns its folder', async () => {
    api.mockResolvedValueOnce(json({ books: 0, sharedFolderBooks: 4, estimatedSeconds: { low: 0, high: 0 } }))
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('describeEstimate', () => {
  it('picks a readable unit for the range', () => {
    expect(describeEstimate({ low: 5, high: 40 }).key).toBe('underMinute')
    expect(describeEstimate({ low: 30, high: 150 })).toEqual({ key: 'minutes', low: 1, high: 3 })
    expect(describeEstimate({ low: 3600, high: 3 * 3600 })).toEqual({ key: 'hours', low: 1, high: 3 })
  })
})
