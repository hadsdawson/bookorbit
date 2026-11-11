import { describe, expect, it } from 'vitest'

import { folderFilesTurnedOn } from '../folder-files'

describe('folderFilesTurnedOn', () => {
  const off = { fileWriteFolderCovers: 'off', fileWriteMetadataJson: false } as const

  it('is true when covers or the JSON file are switched on', () => {
    expect(folderFilesTurnedOn(off, { ...off, fileWriteFolderCovers: 'audiobook' })).toBe(true)
    expect(folderFilesTurnedOn(off, { ...off, fileWriteMetadataJson: true })).toBe(true)
  })

  it('is true when more covers are asked for than before', () => {
    expect(folderFilesTurnedOn({ ...off, fileWriteFolderCovers: 'ebook' }, { ...off, fileWriteFolderCovers: 'both' })).toBe(true)
  })

  it('is false for saves that leave them as they were or turn them off', () => {
    expect(folderFilesTurnedOn(off, off)).toBe(false)
    expect(folderFilesTurnedOn({ fileWriteFolderCovers: 'both', fileWriteMetadataJson: true }, off)).toBe(false)
    expect(
      folderFilesTurnedOn(
        { fileWriteFolderCovers: 'both', fileWriteMetadataJson: true },
        { fileWriteFolderCovers: 'both', fileWriteMetadataJson: true },
      ),
    ).toBe(false)
  })
})
