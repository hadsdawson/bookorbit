import { ref } from 'vue'
import { BOOK_REQUEST_FORMAT_CHOICES, type BookRequestFormatChoice, type BookRequestFormatPolicy } from '@bookorbit/types'
import { api } from '@/lib/api'

const ENDPOINT = '/api/v1/book-requests/format-policy'

const policy = ref<BookRequestFormatPolicy>({ defaultFormat: null, locked: false })
let inFlight: Promise<void> | null = null

function normalize(value: unknown): BookRequestFormatPolicy {
  const raw = (value ?? {}) as Partial<BookRequestFormatPolicy>
  const defaultFormat = (BOOK_REQUEST_FORMAT_CHOICES as readonly unknown[]).includes(raw.defaultFormat)
    ? (raw.defaultFormat as BookRequestFormatChoice)
    : null
  return { defaultFormat, locked: defaultFormat !== null && raw.locked === true }
}

/** Fetched on every load rather than once, so a change in settings reaches an open requests page. */
export function useRequestFormatPolicy() {
  function load(): Promise<void> {
    inFlight ??= (async () => {
      try {
        const res = await api(ENDPOINT)
        if (res.ok) policy.value = normalize(await res.json())
      } catch {
        // Unknown policy leaves the form unlocked; the server still refuses a locked-out format.
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return { policy, load }
}
