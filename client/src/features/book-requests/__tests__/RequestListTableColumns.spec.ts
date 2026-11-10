import { mount, RouterLinkStub } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { BookRequestItem } from '@bookorbit/types'

import RequestListTable from '../components/RequestListTable.vue'
import { useRequestTableColumns } from '../composables/useRequestTableColumns'

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 1,
    userId: 1,
    requesterUsername: 'reader',
    requesterName: 'Reader Person',
    title: 'Dune',
    subtitle: null,
    authors: ['Frank Herbert'],
    seriesName: null,
    seriesIndex: null,
    isbn10: null,
    isbn13: null,
    publishedYear: 2026,
    publishedDate: '2026-12-08',
    language: 'en',
    coverUrl: null,
    providerKey: null,
    providerId: null,
    metadataSources: [],
    mediaKind: 'ebook',
    status: 'approved',
    trackingStatus: null,
    preferredFormats: [],
    note: null,
    targetLibraryId: 1,
    targetLibraryName: 'Books',
    targetFolderId: null,
    decidedByUserId: null,
    decidedByUsername: null,
    decidedAt: null,
    decisionNote: null,
    matchedBookId: null,
    bookDockFileId: null,
    selfServe: false,
    fulfillerUserId: null,
    statusReason: null,
    failureCode: null,
    failureMeta: null,
    subscribers: [],
    download: null,
    dismissed: false,
    companionRequestId: null,
    targetBookId: null,
    createdAt: '2026-11-10T12:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z',
    ...overrides,
  }
}

function render(requests: BookRequestItem[]) {
  return mount(RequestListTable, {
    props: {
      requests,
      canManage: true,
      canSelfFulfil: true,
      currentUserId: 1,
      busyIds: new Set<number>(),
      progressByRequest: {},
      density: 'comfortable',
      sortBy: 'createdAt',
      sortDir: 'desc',
      selectedIds: [],
    },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

function headerTexts(wrapper: ReturnType<typeof render>): string[] {
  return wrapper.findAll('thead th').map((th) => th.text().trim().toLowerCase())
}

describe('RequestListTable columns', () => {
  afterEach(() => {
    useRequestTableColumns().reset()
  })

  it('leaves a hidden column out of both the header and the rows', () => {
    useRequestTableColumns().setVisible('requester', false)
    const wrapper = render([request()])
    expect(headerTexts(wrapper).some((text) => text.includes('requested by'))).toBe(false)
    expect(wrapper.find('table').text()).not.toContain('Reader Person')
  })

  it('never hides the title', () => {
    useRequestTableColumns().setVisible('title', false)
    expect(headerTexts(render([request()])).some((text) => text.includes('title'))).toBe(true)
  })

  it('keeps the header and row cell counts equal', () => {
    useRequestTableColumns().setVisible('age', false)
    useRequestTableColumns().setVisible('outcome', false)
    const wrapper = render([request()])
    expect(wrapper.findAll('tbody tr')[0]!.findAll('td')).toHaveLength(wrapper.findAll('thead th').length)
  })

  it('gives each half of a pair its own tracking select', () => {
    const audiobook = request({ id: 2, mediaKind: 'audiobook', companionRequestId: 1, trackingStatus: 'format_not_available' })
    const wrapper = render([{ ...request({ companionRequestId: 2 }), companion: audiobook } as BookRequestItem])
    const selects = wrapper.find('table').findAll('select')
    expect(selects).toHaveLength(2)
    expect(selects.map((select) => (select.element as HTMLSelectElement).value)).toEqual(['', 'format_not_available'])
  })

  it('remembers widths across mounts', () => {
    useRequestTableColumns().setWidth('released', 300)
    useRequestTableColumns().commitWidths()
    expect(useRequestTableColumns().widthOf('released')).toBe(300)
    expect(
      render([request()])
        .findAll('col')
        .some((col) => col.attributes('style')?.includes('300px')),
    ).toBe(true)
  })
})

describe('RequestListTable released and tracking cells', () => {
  it('shows N/A when only a year is known', () => {
    const wrapper = render([request({ publishedDate: null, publishedYear: 2024 })])
    expect(wrapper.find('table').text()).toContain('N/A')
    expect(wrapper.find('table').text()).not.toContain('2024')
  })

  it('shows the full date when there is one', () => {
    expect(
      render([request({ publishedDate: '2026-12-08' })])
        .find('table')
        .text(),
    ).toContain('2026')
  })

  it('hides tracking on an available request', () => {
    expect(
      render([request({ status: 'available' })])
        .find('table')
        .findAll('select'),
    ).toHaveLength(0)
  })

  it('hides tracking only on the half of a pair that is available', () => {
    const audiobook = request({ id: 2, mediaKind: 'audiobook', companionRequestId: 1, status: 'approved' })
    const wrapper = render([{ ...request({ companionRequestId: 2, status: 'available' }), companion: audiobook } as BookRequestItem])
    expect(wrapper.find('table').findAll('select')).toHaveLength(1)
  })
})
