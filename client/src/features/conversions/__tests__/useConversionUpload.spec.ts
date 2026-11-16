import { describe, expect, it } from 'vitest'

import { pickedFiles } from '../composables/useConversionUpload'

function file(name: string, relativePath = ''): File {
  const picked = new File(['x'], name)
  Object.defineProperty(picked, 'webkitRelativePath', { value: relativePath })
  return picked
}

describe('pickedFiles', () => {
  it('keeps where each file sits in a picked folder and drops hidden files', () => {
    const result = pickedFiles([file('01.mp3', 'Book/CD1/01.mp3'), file('cover.jpg', 'Book/cover.jpg'), file('.DS_Store', 'Book/.DS_Store')])
    expect(result.map((picked) => picked.path)).toEqual(['Book/CD1/01.mp3', 'Book/cover.jpg'])
  })

  it('uses the file name for files picked on their own', () => {
    expect(pickedFiles([file('Book.m4a')]).map((picked) => picked.path)).toEqual(['Book.m4a'])
  })
})
