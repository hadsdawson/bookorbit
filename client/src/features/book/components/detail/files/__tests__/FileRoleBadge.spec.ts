import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FileRoleBadge from '../FileRoleBadge.vue'

function label(props: { role: string; fileName?: string; hasAudio?: boolean }): string | null {
  const wrapper = mount(FileRoleBadge, { props })
  return wrapper.find('span').exists() ? wrapper.text() : null
}

describe('FileRoleBadge', () => {
  it('names which cover a folder cover file is', () => {
    expect(label({ role: 'cover', fileName: 'cover-ebook.jpg', hasAudio: true })).toBe('Ebook cover')
    expect(label({ role: 'cover', fileName: 'cover.jpg', hasAudio: true })).toBe('Audiobook cover')
    expect(label({ role: 'cover', fileName: 'cover.jpg', hasAudio: false })).toBe('Ebook cover')
    expect(label({ role: 'cover', fileName: 'folder.jpg', hasAudio: true })).toBe('Cover')
  })

  it('marks the metadata file and leaves ordinary files unlabelled', () => {
    expect(label({ role: 'content', fileName: 'metadata.json' })).toBe('Metadata')
    expect(label({ role: 'supplement', fileName: 'Metadata.JSON' })).toBe('Metadata')
    expect(label({ role: 'content', fileName: 'Book.epub' })).toBeNull()
    expect(label({ role: 'primary', fileName: 'Book.m4b' })).toBeNull()
    expect(label({ role: 'supplement', fileName: 'map.pdf' })).toBe('Supplement')
  })
})
