import type { CommunityRatingsRefreshSchedule, CommunityRatingsRefreshStatus } from '@bookorbit/types'

import { apiJson, jsonBody } from '@/lib/api-json'

const BASE = '/api/v1/community-ratings-refresh'

export function getCommunityRatingsRefreshStatus(): Promise<CommunityRatingsRefreshStatus> {
  return apiJson(BASE, undefined, 'tools.communityRatings.errors.load')
}

export function setCommunityRatingsRefreshSchedule(schedule: CommunityRatingsRefreshSchedule): Promise<CommunityRatingsRefreshStatus> {
  return apiJson(`${BASE}/schedule`, jsonBody('PUT', { schedule }), 'tools.communityRatings.errors.save')
}

export function startCommunityRatingsRefresh(): Promise<CommunityRatingsRefreshStatus> {
  return apiJson(`${BASE}/run`, { method: 'POST' }, 'tools.communityRatings.errors.start')
}

export function cancelCommunityRatingsRefresh(): Promise<CommunityRatingsRefreshStatus> {
  return apiJson(`${BASE}/run`, { method: 'DELETE' }, 'tools.communityRatings.errors.stop')
}
