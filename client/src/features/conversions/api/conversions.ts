import type { ConversionJob, ConversionOverview, ConversionSettings, ConversionStatus } from '@bookorbit/types'

import { apiJson, apiSend, jsonBody } from '@/lib/api-json'

const BASE = '/api/v1/conversions'

export function getConversionStatus(): Promise<ConversionStatus> {
  return apiJson(`${BASE}/status`, undefined, 'conversions.errors.load')
}

export function getConversions(): Promise<ConversionOverview> {
  return apiJson(BASE, undefined, 'conversions.errors.load')
}

export function saveConversionSettings(settings: ConversionSettings): Promise<ConversionSettings> {
  return apiJson(`${BASE}/settings`, jsonBody('PUT', settings), 'conversions.errors.save')
}

export function retryConversion(id: string): Promise<ConversionJob> {
  return apiJson(`${BASE}/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }, 'conversions.errors.retry')
}

export function startConversionUpload(): Promise<{ batchId: string }> {
  return apiJson(`${BASE}/uploads`, { method: 'POST' }, 'conversions.errors.upload')
}

export function finishConversionUpload(batchId: string): Promise<{ items: number }> {
  return apiJson(`${BASE}/uploads/${encodeURIComponent(batchId)}/finish`, { method: 'POST' }, 'conversions.errors.upload')
}

export function cancelConversionUpload(batchId: string): Promise<void> {
  return apiSend(`${BASE}/uploads/${encodeURIComponent(batchId)}`, { method: 'DELETE' }, 'conversions.errors.upload')
}
