import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import { activateI18nLocale, i18n } from '@/i18n'
import type { TreeFile } from '@/features/book/composables/useBookFileTree'
import FileDetailCard from '../FileDetailCard.vue'

const FILE = {
  id: 7,
  format: 'epub',
  role: 'content',
  sizeBytes: 1000,
  absolutePath: '/lib/Dune/dune.epub',
  createdAt: '2026-11-20T12:00:00.000Z',
  filename: 'dune.epub',
  fileHash: null,
  contentVersion: '1',
  durationSeconds: null,
  mediaOverlay: null,
  formatKey: 'epub',
  editionKey: 'epub',
  group: 'ebook',
  leaf: 'dune.epub',
  display: 'dune.epub',
  track: null,
  progress: null,
  openable: true,
  isAudio: false,
} as unknown as TreeFile

function render(pathCopied: boolean) {
  return mount(FileDetailCard, {
    props: {
      file: FILE,
      audioFiles: [],
      isMultiTrackAudio: false,
      runtimeSeconds: null,
      isWriteTarget: false,
      canDownload: true,
      canEdit: true,
      canDelete: false,
      isPinnedPrimary: false,
      primaryBusy: false,
      pathCopied,
    },
  })
}

describe('FileDetailCard copy path', () => {
  beforeAll(async () => {
    await activateI18nLocale('en')
  })

  it('asks to copy the path when the copy button is pressed', async () => {
    const wrapper = render(false)
    await wrapper.get('[data-test="copy-path-button"]').trigger('click')
    expect(wrapper.emitted('copyPath')?.[0]?.[0]).toMatchObject({ id: 7 })
    expect(wrapper.find('[data-test="path-copied-label"]').exists()).toBe(false)
  })

  it('shows a check and a Copied label right after the path is copied', () => {
    const wrapper = render(true)
    expect(wrapper.get('[data-test="path-copied-label"]').text()).toBe(i18n.global.t('book.detail.files.copied'))
    expect(wrapper.get('[data-test="copy-path-button"]').classes()).toContain('text-success')
  })
})
