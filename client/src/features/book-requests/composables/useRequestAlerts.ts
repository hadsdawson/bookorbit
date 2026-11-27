import { ref } from 'vue'
import { api } from '@/lib/api'
import type {
  BookRequestAlertChannel,
  BookRequestAlertSettings,
  BookRequestAlertTestResult,
  UpdateBookRequestAlertSettingsPayload,
} from '@bookorbit/types'

const BASE_PATH = '/api/v1/admin/book-request-alerts'

const EMPTY_SETTINGS: BookRequestAlertSettings = {
  discordEnabled: false,
  discordWebhookSet: false,
  emailEnabled: false,
  emailTo: [],
  includeAdminRequests: false,
  emailProviderReady: false,
  encryptionConfigured: true,
}

async function errorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(' ')
    return body.message ?? null
  } catch {
    return null
  }
}

/** Fork. Where new book requests are announced outside the app: Discord and email. */
export function useRequestAlerts() {
  const settings = ref<BookRequestAlertSettings>({ ...EMPTY_SETTINGS })
  const loading = ref(false)
  const loadFailed = ref(false)

  async function fetchSettings(): Promise<void> {
    loading.value = true
    loadFailed.value = false
    try {
      const res = await api(BASE_PATH)
      if (!res.ok) {
        loadFailed.value = true
        return
      }
      settings.value = (await res.json()) as BookRequestAlertSettings
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  /** Returns null on success, otherwise the reason the server gave. */
  async function save(payload: UpdateBookRequestAlertSettingsPayload): Promise<string | null> {
    try {
      const res = await api(BASE_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return (await errorMessage(res)) ?? ''
      settings.value = (await res.json()) as BookRequestAlertSettings
      return null
    } catch {
      return ''
    }
  }

  async function sendTest(channel: BookRequestAlertChannel): Promise<BookRequestAlertTestResult> {
    try {
      const res = await api(`${BASE_PATH}/test/${channel}`, { method: 'POST' })
      if (!res.ok) return { channel, ok: false, message: (await errorMessage(res)) ?? '' }
      return (await res.json()) as BookRequestAlertTestResult
    } catch {
      return { channel, ok: false, message: '' }
    }
  }

  return { settings, loading, loadFailed, fetchSettings, save, sendTest }
}
