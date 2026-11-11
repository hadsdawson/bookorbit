import type { Library } from '@bookorbit/types'

type FolderFilesSettings = Pick<Library, 'fileWriteFolderCovers' | 'fileWriteMetadataJson'>

/** True when a save switched on folder covers or metadata.json that were off before, so existing books need a decision. */
export function folderFilesTurnedOn(before: FolderFilesSettings, after: FolderFilesSettings): boolean {
  const coversNow = after.fileWriteFolderCovers !== 'off' && after.fileWriteFolderCovers !== before.fileWriteFolderCovers
  const jsonNow = after.fileWriteMetadataJson && !before.fileWriteMetadataJson
  return coversNow || jsonNow
}
