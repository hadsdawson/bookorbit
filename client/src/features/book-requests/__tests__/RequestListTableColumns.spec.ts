import { mount, RouterLinkStub } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { BookRequestItem } from '@bookorbit/types'

import RequestListTable from '../components/RequestListTable.vue'
import { completeOrder, REQUEST_TABLE_COLUMNS, useRequestTableColumns } from '../composables/useRequestTableColumns'

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
    trackingStatusAuto: false,
    preferredFormats: [],
    note: null,
    targetLibraryId: 1,
    targetLibraryName: 'Books',
    targetFolderId: null,
    decidedByUserId: null,
    decidedByUsername: null,
    decidedByName: null,
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
      viewer: { userId: 1, canManage: true, canSelfFulfil: true },
      showRequester: false,
      busyIds: new Set<number>(),
      progressByRequest: {},
      density: 'comfortable',
      sortBy: 'createdAt',
      sortDir: 'desc',
      selectedRowIds: new Set<number>(),
      pageSelection: 'none',
    },
    global: { stubs: { RouterLink: RouterLinkStub, RequestCover: true, RequestPairCover: true } },
  })
}

function headerColumns(wrapper: ReturnType<typeof render>): string[] {
  return wrapper.findAll('thead th[data-column]').map((th) => th.attributes('data-column')!)
}

describe('RequestListTable columns', () => {
  afterEach(() => {
    useRequestTableColumns().reset()
  })

  it('draws upstream columns plus Released and Tracking by default', () => {
    expect(headerColumns(render([request()]))).toEqual(['book', 'requested', 'released', 'status', 'tracking', 'nextStep', 'actions'])
  })

  it('leaves a hidden column out of both the header and the rows', () => {
    useRequestTableColumns().setVisible('released', false)
    const wrapper = render([request()])
    expect(headerColumns(wrapper)).not.toContain('released')
    expect(wrapper.get('table tbody').text()).not.toContain('2026')
  })

  it('never hides the book', () => {
    useRequestTableColumns().setVisible('book', false)
    expect(headerColumns(render([request()]))).toContain('book')
  })

  it('keeps the header and row cell counts equal', () => {
    useRequestTableColumns().setVisible('tracking', false)
    const wrapper = render([request()])
    expect(wrapper.findAll('thead th')).toHaveLength(wrapper.findAll('tbody tr:first-child td').length)
  })

  it('gives each half of a pair its own tracking select', () => {
    const ebook = request({ id: 10, companionRequestId: 11 })
    const audiobook = request({ id: 11, mediaKind: 'audiobook', companionRequestId: 10 })
    const wrapper = render([{ ...ebook, companion: audiobook }])
    expect(wrapper.findAll('table tbody select')).toHaveLength(2)
  })

  it('hides tracking only on the half of a pair that is available', () => {
    const ebook = request({ id: 10, companionRequestId: 11, status: 'available' })
    const audiobook = request({ id: 11, mediaKind: 'audiobook', companionRequestId: 10 })
    const wrapper = render([{ ...ebook, companion: audiobook }])
    expect(wrapper.findAll('table tbody select')).toHaveLength(1)
  })

  it('remembers widths across mounts', () => {
    useRequestTableColumns().setWidth('status', 200)
    const wrapper = render([request()])
    const index = headerColumns(wrapper).indexOf('status')
    expect(wrapper.findAll('colgroup col')[index + 1]!.attributes('style')).toContain('200px')
  })

  it('gives the book a resize edge that moves its boundary with the next column', async () => {
    const wrapper = render([request()])
    const edge = wrapper.find('thead th[data-column="book"] [role="separator"]')
    expect(edge.exists()).toBe(true)
    const columns = useRequestTableColumns()
    const before = columns.widthOf('requested')
    await edge.trigger('keydown', { key: 'ArrowRight' })
    expect(columns.widthOf('requested')).toBe(before - 16)
    await edge.trigger('keydown', { key: 'ArrowLeft' })
    expect(columns.widthOf('requested')).toBe(before)
  })

  it('has no book resize edge when the book is the last column', async () => {
    const columns = useRequestTableColumns()
    columns.moveTo('book', 'actions')
    const wrapper = render([request()])
    expect(wrapper.find('thead th[data-column="book"] [role="separator"]').exists()).toBe(false)
  })

  it('caps a drag so the book keeps its minimum', () => {
    const columns = useRequestTableColumns()
    columns.setWidth('nextStep', 2000)
    expect(columns.widthOf('nextStep')).toBeLessThanOrEqual(480)
    columns.setWidth('nextStep', 400, 150)
    expect(columns.widthOf('nextStep')).toBe(150)
  })

  it('moves a column one step with the arrow keys on its grip', async () => {
    const wrapper = render([request()])
    await wrapper.get('thead th[data-column="tracking"] button[draggable="true"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(headerColumns(wrapper).indexOf('tracking')).toBeLessThan(headerColumns(wrapper).indexOf('status'))
  })

  it('sorts by release date and tracking from their headers', async () => {
    const wrapper = render([request()])
    await wrapper.get('thead th[data-column="released"] button:not([draggable])').trigger('click')
    await wrapper.get('thead th[data-column="tracking"] button:not([draggable])').trigger('click')
    expect(wrapper.emitted('sort')).toEqual([['publishedDate'], ['trackingStatus']])
  })

  it('keeps a saved order and slots new columns in beside their default neighbour', () => {
    expect(completeOrder(['actions', 'book', 'stale'])).toEqual(['actions', 'book', ...REQUEST_TABLE_COLUMNS.slice(1, -1)])
  })
})
