import { api } from '@/lib/api'

export async function refetchBookDockMetadata(fileId: number): Promise<boolean> {
  const response = await api(`/api/v1/book-dock/files/${fileId}/refetch-metadata`, {
    method: 'POST',
  })
  return response.ok
}

/** Fork: splits an item merged in Book Dock back into its separate files. */
export async function unmergeBookDockFile(fileId: number): Promise<boolean> {
  const response = await api(`/api/v1/book-dock/files/${fileId}/unmerge`, { method: 'POST' })
  return response.ok
}
