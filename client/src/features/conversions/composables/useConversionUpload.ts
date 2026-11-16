import { computed, ref } from 'vue'

import { getValidToken } from '@/lib/api'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { cancelConversionUpload, finishConversionUpload, startConversionUpload } from '../api/conversions'

export const CONVERTIBLE_ACCEPT = '.mp3,.m4a,.m4b'

export interface PickedFile {
  file: File
  /** Where it sits inside what was picked: the file name, or `Folder/CD1/01.mp3` for a folder. */
  path: string
}

export type UploadFailure = { kind: 'tooLarge'; name: string; limitMb: number } | { kind: 'failed'; name: string; status: number }

/** The files a picker returned, minus hidden ones such as .DS_Store. A folder keeps its covers and metadata. */
export function pickedFiles(list: FileList | File[]): PickedFile[] {
  return Array.from(list)
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
    .filter((picked) => !picked.path.split('/').some((part) => part.startsWith('.')))
}

const uploading = ref(false)
const totalBytes = ref(0)
const sentBytes = ref(0)
const fileIndex = ref(0)
const fileCount = ref(0)

/** Fork: sends picked files or a folder to the Convert folder, one file at a time, as one upload. */
export function useConversionUpload() {
  const { maxUploadSizeMb } = useAppInfo()
  const percent = computed(() => (totalBytes.value > 0 ? Math.min(100, Math.round((sentBytes.value / totalBytes.value) * 100)) : 0))

  async function upload(files: PickedFile[]): Promise<UploadFailure | null> {
    if (uploading.value || files.length === 0) return null
    const limitMb = maxUploadSizeMb.value
    const tooBig = files.find((picked) => picked.file.size > limitMb * 1024 * 1024)
    if (tooBig) return { kind: 'tooLarge', name: tooBig.path, limitMb }

    uploading.value = true
    totalBytes.value = files.reduce((sum, picked) => sum + picked.file.size, 0)
    sentBytes.value = 0
    fileCount.value = files.length
    fileIndex.value = 0
    let batchId: string | null = null
    try {
      batchId = (await startConversionUpload()).batchId
      for (const picked of files) {
        fileIndex.value += 1
        const before = sentBytes.value
        const status = await sendFile(batchId, picked, (loaded) => {
          sentBytes.value = before + Math.min(loaded, picked.file.size)
        })
        if (status !== 204) {
          await cancelConversionUpload(batchId).catch(() => {})
          return status === 413 ? { kind: 'tooLarge', name: picked.path, limitMb } : { kind: 'failed', name: picked.path, status }
        }
        sentBytes.value = before + picked.file.size
      }
      await finishConversionUpload(batchId)
      return null
    } catch {
      if (batchId) await cancelConversionUpload(batchId).catch(() => {})
      return { kind: 'failed', name: '', status: 0 }
    } finally {
      uploading.value = false
    }
  }

  return { uploading, percent, fileIndex, fileCount, upload }
}

async function sendFile(batchId: string, picked: PickedFile, onProgress: (loaded: number) => void): Promise<number> {
  const token = await getValidToken()
  return new Promise<number>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1/conversions/uploads/${encodeURIComponent(batchId)}/files?path=${encodeURIComponent(picked.path)}`)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onloadend = () => resolve(xhr.status)
    const form = new FormData()
    form.append('file', picked.file)
    xhr.send(form)
  })
}
