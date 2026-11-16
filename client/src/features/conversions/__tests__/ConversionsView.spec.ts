import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversionJob, ConversionOverview } from '@bookorbit/types'

import ConversionsView from '../views/ConversionsView.vue'

const api = vi.hoisted(() => ({
  getConversions: vi.fn<() => Promise<ConversionOverview>>(),
  retryConversion: vi.fn<(id: string) => Promise<ConversionJob>>(),
}))
const status = vi.hoisted(() => ({ setEnabled: vi.fn<(value: boolean) => void>() }))
const permissions = vi.hoisted(() => ({ granted: new Set<string>() }))
const toast = vi.hoisted(() => ({ error: vi.fn<(message: string) => void>(), success: vi.fn<(message: string) => void>() }))
const uploads = vi.hoisted(() => ({ upload: vi.fn<(files: { file: File; path: string }[]) => Promise<unknown>>() }))

vi.mock('../api/conversions', () => api)
vi.mock('../composables/useConversionStatus', () => ({ useConversionStatus: () => status }))
vi.mock('../composables/useConversionUpload', async () => {
  const { ref } = await import('vue')
  return {
    CONVERTIBLE_ACCEPT: '.mp3,.m4a,.m4b',
    pickedFiles: (list: File[]) => Array.from(list).map((file) => ({ file, path: file.webkitRelativePath || file.name })),
    useConversionUpload: () => ({ uploading: ref(false), percent: ref(0), fileIndex: ref(0), fileCount: ref(0), upload: uploads.upload }),
  }
})
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => permissions.granted.has(name) }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))
vi.mock('vue-sonner', () => ({ toast }))

function makeJob(overrides: Partial<ConversionJob> = {}): ConversionJob {
  return {
    id: '7f1e9a52-1111-4222-8333-944455556666',
    name: 'Book.mp3',
    status: 'converting',
    method: 'encode',
    progress: 42,
    bitrate: 128_000,
    trackCount: null,
    reason: null,
    detail: null,
    outputName: null,
    createdAt: '2026-11-16T19:00:00Z',
    startedAt: '2026-11-16T19:00:01Z',
    finishedAt: null,
    ...overrides,
  }
}

function makeOverview(jobs: ConversionJob[], enabled = true): ConversionOverview {
  return { settings: { enabled, concurrency: 1 }, convertPath: '/data/convert', jobs }
}

function mountView() {
  return mount(ConversionsView, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
}

describe('ConversionsView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    permissions.granted.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the Convert folder and a progress bar for a book being re-encoded', async () => {
    api.getConversions.mockResolvedValue(makeOverview([makeJob()]))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-testid="conversions-path"]').text()).toBe('/data/convert')
    const row = wrapper.get('[data-testid="conversion-job"]')
    expect(row.text()).toContain('Book.mp3')
    expect(row.text()).toContain('conversions.method.encode {"kbps":"128"}')
    expect(row.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('42')
    expect(status.setEnabled).toHaveBeenCalledWith(true)
  })

  it('checks again every two seconds while something is converting', async () => {
    api.getConversions.mockResolvedValue(makeOverview([makeJob()]))
    mountView()
    await flushPromises()
    expect(api.getConversions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(api.getConversions).toHaveBeenCalledTimes(2)
  })

  it('explains a failure and offers to try again', async () => {
    const failed = makeJob({ status: 'failed', progress: null, reason: 'failed', detail: 'Invalid data found when processing input' })
    api.getConversions.mockResolvedValue(makeOverview([failed]))
    api.retryConversion.mockResolvedValue({ ...failed, status: 'queued' })
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('conversions.reasons.failed')
    expect(wrapper.text()).toContain('Invalid data found when processing input')
    await wrapper.get('[data-testid="conversion-retry"]').trigger('click')
    await flushPromises()
    expect(api.retryConversion).toHaveBeenCalledWith(failed.id)
  })

  it('says where a finished book went', async () => {
    api.getConversions.mockResolvedValue(
      makeOverview([makeJob({ status: 'done', progress: 100, outputName: 'Book.m4b', finishedAt: '2026-11-16T19:10:00Z' })]),
    )
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('conversions.landed {"name":"Book.m4b"}')
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  })

  it('tells a Book Dock manager where to turn conversions on', async () => {
    permissions.granted.add('manage_book_dock')
    api.getConversions.mockResolvedValue(makeOverview([], false))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-testid="conversions-off"]').text()).toContain('conversions.offHintManage')
    expect(status.setEnabled).toHaveBeenCalledWith(false)
  })

  it('describes a joined folder of tracks', async () => {
    api.getConversions.mockResolvedValue(makeOverview([makeJob({ trackCount: 12, bitrate: 64_000 })]))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('conversions.method.joinEncode {"tracks":"12","kbps":"64"}')
  })

  it('offers uploads only to people who may upload, and sends the picked folder as one upload', async () => {
    api.getConversions.mockResolvedValue(makeOverview([]))
    const hidden = mountView()
    await flushPromises()
    expect(hidden.find('[data-testid="conversions-upload"]').exists()).toBe(false)

    permissions.granted.add('book_dock_access')
    permissions.granted.add('library_upload')
    uploads.upload.mockResolvedValue(null)
    const wrapper = mountView()
    await flushPromises()

    const track = new File(['x'], '01.mp3')
    Object.defineProperty(track, 'webkitRelativePath', { value: 'Book/01.mp3' })
    const input = wrapper.get('[data-testid="conversions-folder-input"]')
    Object.defineProperty(input.element, 'files', { value: [track] })
    await input.trigger('change')
    await flushPromises()

    expect(uploads.upload).toHaveBeenCalledWith([{ file: track, path: 'Book/01.mp3' }])
    expect(toast.success).toHaveBeenCalled()
  })

  it('says why an upload failed', async () => {
    permissions.granted.add('book_dock_access')
    permissions.granted.add('library_upload')
    api.getConversions.mockResolvedValue(makeOverview([]))
    uploads.upload.mockResolvedValue({ kind: 'tooLarge', name: 'Big.m4b', limitMb: 500 })
    const wrapper = mountView()
    await flushPromises()

    const input = wrapper.get('[data-testid="conversions-files-input"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'Big.m4b')] })
    await input.trigger('change')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('conversions.upload.tooLarge {"name":"Big.m4b","limit":"500"}')
  })
})
