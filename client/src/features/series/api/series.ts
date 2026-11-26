import { api } from '@/lib/api'
import type { SeriesBooksPage, SeriesPage, SplitSeriesBooksRequest, SplitSeriesBooksResult } from '@bookorbit/types'
import type { CompletionStatus, SeriesBookSort, SeriesListSort, SortDirection } from '../types/series'

type ListSeriesParams = {
  q?: string
  page: number
  size: number
  sort: SeriesListSort
  order: SortDirection
  libraryId?: number | null
  completionStatus?: CompletionStatus | null
  author?: string | null
}

type ListSeriesBooksParams = {
  page: number
  size: number
  sort: SeriesBookSort
  order: SortDirection
  libraryId?: number | null
  /** Folds linked editions into one card. Servers without editions support reject it. */
  collapseLinked?: boolean
}

function toQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '')
  return new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
}

export async function fetchSeries(params: ListSeriesParams): Promise<SeriesPage> {
  const qs = toQuery(params)
  const res = await api(`/api/v1/series?${qs}`)
  if (!res.ok) throw new Error(`Failed to fetch series: ${res.status}`)
  return res.json()
}

export async function fetchSeriesBooks(seriesId: number, params: ListSeriesBooksParams): Promise<SeriesBooksPage> {
  const qs = toQuery({ ...params, collapseLinked: params.collapseLinked ? 'true' : undefined })
  const res = await api(`/api/v1/series/${seriesId}/books?${qs}`)
  if (!res.ok) throw new Error(`Failed to fetch series books: ${res.status}`)
  return res.json()
}

/** Fork. Moves the chosen books of a series into a new series. */
export async function splitSeriesBooks(body: SplitSeriesBooksRequest): Promise<SplitSeriesBooksResult> {
  const res = await api('/api/v1/entity-manager/series/split-books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(data?.message ?? `Failed to split series: ${res.status}`)
  }
  return res.json()
}
