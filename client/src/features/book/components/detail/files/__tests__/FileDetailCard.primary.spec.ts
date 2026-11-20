import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import { activateI18nLocale, i18n } from '@/i18n'
import type { TreeFile } from '@/features/book/composables/useBookFileTree'
import FileDetailCard from '../FileDetailCard.vue'

function file(overrides: Partial<TreeFile> = {}): TreeFile {
  return {
    id: 7,
    format: 'm4b',
    role: 'content',
    sizeBytes: 1000,
    absolutePath: '/lib/Dune/dune.m4b',
    createdAt: '2026-11-20T12:00:00.000Z',
    filename: 'dune.m4b',
    fileHash: null,
    contentVersion: '1',
    durationSeconds: 3600,
    mediaOverlay: null,
    formatKey: 'm4b',
    editionKey: 'm4b',
    group: 'audiobook',
    leaf: 'dune.m4b',
    display: 'dune.m4b',
    track: null,
    progress: null,
    openable: true,
    isAudio: true,
    ...overrides,
  } as unknown as TreeFile
}

function render(props: { file: TreeFile; canEdit?: boolean; isPinnedPrimary?: boolean }) {
  return mount(FileDetailCard, {
    props: {
      file: props.file,
      audioFiles: [],
      isMultiTrackAudio: false,
      runtimeSeconds: null,
      isWriteTarget: false,
      canDownload: true,
      canEdit: props.canEdit ?? true,
      canDelete: false,
      isPinnedPrimary: props.isPinnedPrimary ?? false,
      primaryBusy: false,
    },
  })
}

describe('FileDetailCard primary format controls', () => {
  beforeAll(async () => {
    await activateI18nLocale('en')
  })

  it('offers to make an alternate file the primary format', async () => {
    const wrapper = render({ file: file() })
    await wrapper.get('[data-testid="make-primary"]').trigger('click')
    expect(wrapper.emitted('makePrimary')?.[0]?.[0]).toMatchObject({ id: 7 })
    expect(wrapper.text()).toContain(i18n.global.t('book.detail.files.makePrimary'))
  })

  it('lets a pinned primary go back to the library order', async () => {
    const wrapper = render({ file: file({ role: 'primary' }), isPinnedPrimary: true })
    expect(wrapper.find('[data-testid="make-primary"]').exists()).toBe(false)
    await wrapper.get('[data-testid="use-priority"]').trigger('click')
    expect(wrapper.emitted('usePriority')).toHaveLength(1)
  })

  it('shows nothing for a primary that was not pinned, or to someone who cannot edit', () => {
    expect(
      render({ file: file({ role: 'primary' }) })
        .find('[data-testid="primary-format-controls"]')
        .exists(),
    ).toBe(true)
    expect(
      render({ file: file({ role: 'primary' }) })
        .find('[data-testid="use-priority"]')
        .exists(),
    ).toBe(false)
    expect(render({ file: file(), canEdit: false }).find('[data-testid="primary-format-controls"]').exists()).toBe(false)
  })
})
