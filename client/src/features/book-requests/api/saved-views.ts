import type { BookRequestSavedView, BookRequestSavedViewFilters } from '@bookorbit/types'
import { api } from '@/lib/api'

const BASE = '/api/v1/book-request-saved-views'

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}))
  return new Error((body as { message?: string }).message ?? fallback)
}

export async function listSavedViews(): Promise<BookRequestSavedView[]> {
  const res = await api(BASE)
  if (!res.ok) throw await failure(res, 'Failed to load saved views')
  return res.json()
}

export async function saveSavedView(name: string, filters: BookRequestSavedViewFilters): Promise<BookRequestSavedView> {
  const res = await api(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, filters }),
  })
  if (!res.ok) throw await failure(res, 'Failed to save view')
  return res.json()
}

export async function deleteSavedView(id: number): Promise<void> {
  const res = await api(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await failure(res, 'Failed to delete view')
}
