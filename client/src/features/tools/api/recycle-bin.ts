import type { RecycleBinEmptyResult, RecycleBinOverview, RecycleBinRestoreResult, RecycleBinSettings } from '@bookorbit/types'

import { apiJson, apiSend, jsonBody } from '@/lib/api-json'

const BASE = '/api/v1/recycle-bin'

export function getRecycleBin(page: number, pageSize: number): Promise<RecycleBinOverview> {
  return apiJson(`${BASE}?page=${page}&pageSize=${pageSize}`, undefined, 'tools.recycleBin.errors.load')
}

export function saveRecycleBinSettings(settings: RecycleBinSettings): Promise<RecycleBinSettings> {
  return apiJson(`${BASE}/settings`, jsonBody('PUT', settings), 'tools.recycleBin.errors.save')
}

export function restoreRecycleBinEntry(id: string): Promise<RecycleBinRestoreResult> {
  return apiJson(`${BASE}/entries/${encodeURIComponent(id)}/restore`, { method: 'POST' }, 'tools.recycleBin.errors.restore')
}

export function deleteRecycleBinEntry(id: string): Promise<void> {
  return apiSend(`${BASE}/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'tools.recycleBin.errors.delete')
}

export function emptyRecycleBin(): Promise<RecycleBinEmptyResult> {
  return apiJson(`${BASE}/entries`, { method: 'DELETE' }, 'tools.recycleBin.errors.empty')
}
