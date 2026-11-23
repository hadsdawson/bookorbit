import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryScanChangesDialog from '../components/LibraryScanChangesDialog.vue'

const api = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({
  api,
  NetworkError: class NetworkError extends Error {},
}))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const PAGE = {
  items: [
    {
      id: 1,
      bookId: 9,
      title: 'Dune',
      authors: 'Frank Herbert',
      folderPath: '/books/Frank Herbert/Dune',
      changeType: 'updated',
      fieldChanges: [
        { field: 'Title', old: 'dune', new: 'Dune' },
        { field: 'Series', old: null, new: 'Dune Chronicles' },
      ],
      occurredAt: '2026-11-23T10:00:00.000Z',
    },
    {
      id: 2,
      bookId: 12,
      title: null,
      authors: null,
      folderPath: '/books/Someone/Lost Book',
      changeType: 'missing',
      fieldChanges: [{ field: 'Status', old: 'Present', new: 'Missing' }],
      occurredAt: '2026-11-23T10:00:01.000Z',
    },
  ],
  total: 2,
  truncated: false,
}

describe('LibraryScanChangesDialog', () => {
  beforeEach(() => api.mockReset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountDialog() {
    return mount(LibraryScanChangesDialog, { props: { libraryId: 3, libraryName: 'Fiction', jobId: 31 }, attachTo: document.body })
  }

  const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!

  it('lists each book with the old and new value of every changed field', async () => {
    api.mockResolvedValueOnce(json(PAGE))
    mountDialog()
    await flushPromises()

    expect(api).toHaveBeenCalledWith('/api/v1/scanner/libraries/3/scans/31/changes?offset=0&limit=50')
    const text = document.body.textContent ?? ''
    expect(text).toContain('Dune')
    expect(text).toContain('Frank Herbert')
    expect(text).toContain('dune')
    expect(text).toContain('Dune Chronicles')
    expect(text).toContain('(empty)')
  })

  it('names a book without a title after its folder', async () => {
    api.mockResolvedValueOnce(json(PAGE))
    mountDialog()
    await flushPromises()

    expect(document.body.textContent).toContain('Lost Book')
  })

  it('asks the server for just one kind of change when a filter is picked', async () => {
    api.mockResolvedValueOnce(json(PAGE)).mockResolvedValueOnce(json({ items: [PAGE.items[1]], total: 1, truncated: false }))
    mountDialog()
    await flushPromises()

    button('Missing').click()
    await flushPromises()

    expect(api).toHaveBeenLastCalledWith('/api/v1/scanner/libraries/3/scans/31/changes?offset=0&limit=50&type=missing')
  })

  it('warns when the scan touched more books than the list keeps', async () => {
    api.mockResolvedValueOnce(json({ ...PAGE, truncated: true }))
    mountDialog()
    await flushPromises()

    expect(document.body.textContent).toContain('more books than are kept')
  })

  it('shows an error when the changes cannot be loaded', async () => {
    api.mockResolvedValueOnce(json({}, 500))
    mountDialog()
    await flushPromises()

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Could not load')
  })
})
