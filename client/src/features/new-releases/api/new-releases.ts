import type { NewReleasesOverview, ReleaseFollow, ReleaseFollowKind, ReleaseFollowPage } from '@bookorbit/types'

import { apiJson, apiSend, jsonBody } from '@/lib/api-json'

const BASE = '/api/v1/new-releases'

export function getNewReleases(): Promise<NewReleasesOverview> {
  return apiJson(BASE, undefined, 'newReleases.errors.load')
}

export function listReleaseFollows(query: {
  kind?: ReleaseFollowKind
  search?: string
  offset?: number
  limit?: number
}): Promise<ReleaseFollowPage> {
  const params = new URLSearchParams()
  if (query.kind) params.set('kind', query.kind)
  if (query.search) params.set('search', query.search)
  if (query.offset) params.set('offset', String(query.offset))
  if (query.limit) params.set('limit', String(query.limit))
  const suffix = params.toString()
  return apiJson(`${BASE}/follows${suffix ? `?${suffix}` : ''}`, undefined, 'newReleases.errors.loadFollows')
}

export async function findReleaseFollow(kind: ReleaseFollowKind, name: string): Promise<ReleaseFollow | null> {
  const params = new URLSearchParams({ kind, name })
  const body = await apiJson<{ follow: ReleaseFollow | null }>(
    `${BASE}/follows/find?${params.toString()}`,
    undefined,
    'newReleases.errors.loadFollows',
  )
  return body.follow
}

export function followForReleases(input: { kind: ReleaseFollowKind; name: string; authorId?: number; seriesId?: number }): Promise<ReleaseFollow> {
  return apiJson(`${BASE}/follows`, jsonBody('POST', input), 'newReleases.errors.follow')
}

export function followAllForReleases(kind: ReleaseFollowKind): Promise<{ added: number }> {
  return apiJson(`${BASE}/follows/all`, jsonBody('POST', { kind }), 'newReleases.errors.followAll')
}

export function unfollowForReleases(id: number): Promise<void> {
  return apiSend(`${BASE}/follows/${id}`, { method: 'DELETE' }, 'newReleases.errors.unfollow')
}

export function setNewReleaseHidden(id: number, hidden: boolean): Promise<void> {
  return apiSend(`${BASE}/${id}/state`, jsonBody('PUT', { state: hidden ? 'dismissed' : null }), 'newReleases.errors.hide')
}
