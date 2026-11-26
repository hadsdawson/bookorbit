import type { BookDetail, SeriesReviewPage, SeriesReviewView, SeriesWaitingPage } from '@bookorbit/types'
import { api } from '@/lib/api'

async function ensureOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what} failed: ${response.status}`)
  return response
}

export async function fetchMixedSeries(params: { view: SeriesReviewView; page: number; size: number }): Promise<SeriesReviewPage> {
  const qs = new URLSearchParams({ view: params.view, page: String(params.page), size: String(params.size) })
  return (await ensureOk(await api(`/api/v1/series-review/mixed?${qs}`), 'Loading series to check')).json()
}

export async function setSeriesMarkedFine(seriesId: number, fine: boolean): Promise<void> {
  await ensureOk(await api(`/api/v1/series-review/mixed/${seriesId}/fine`, { method: fine ? 'POST' : 'DELETE' }), 'Marking series')
}

export async function fetchWaitingBooks(params: { page: number; size: number }): Promise<SeriesWaitingPage> {
  const qs = new URLSearchParams({ page: String(params.page), size: String(params.size) })
  return (await ensureOk(await api(`/api/v1/series-review/waiting?${qs}`), 'Loading waiting books')).json()
}

export async function resolveWaitingSeries(body: {
  bookId: number
  displayOrder: number
  seriesId?: number
  newSeries?: boolean
}): Promise<BookDetail> {
  const response = await api('/api/v1/series-review/waiting/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await ensureOk(response, 'Choosing series')).json()
}
