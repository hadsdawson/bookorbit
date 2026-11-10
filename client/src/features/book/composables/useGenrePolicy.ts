import { computed, ref } from 'vue'
import { matchAllowedGenre, normalizeAllowedGenres, type GenrePolicy, type UpdateGenrePolicyPayload } from '@bookorbit/types'
import { api } from '@/lib/api'

const ENDPOINT = '/api/v1/genre-policy'

const policy = ref<GenrePolicy>({ enabled: false, genres: [] })
const loaded = ref(false)
let inFlight: Promise<void> | null = null

function normalize(value: unknown): GenrePolicy {
  const raw = (value ?? {}) as Partial<GenrePolicy>
  return {
    enabled: raw.enabled === true,
    genres: Array.isArray(raw.genres) ? normalizeAllowedGenres(raw.genres.filter((genre): genre is string => typeof genre === 'string')) : [],
  }
}

/**
 * The server's allowed-genre list, shared by every editor on the page. Reloaded on each `load` so a
 * change made in settings reaches an editor opened afterwards.
 */
export function useGenrePolicy() {
  const restricted = computed(() => policy.value.enabled)

  function load(): Promise<void> {
    inFlight ??= (async () => {
      try {
        const res = await api(ENDPOINT)
        if (res.ok) policy.value = normalize(await res.json())
      } catch {
        // Unknown leaves editors unrestricted; the server still drops genres outside the list.
      } finally {
        loaded.value = true
        inFlight = null
      }
    })()
    return inFlight
  }

  async function save(payload: UpdateGenrePolicyPayload): Promise<boolean> {
    try {
      const res = await api(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return false
      policy.value = normalize(await res.json())
      return true
    } catch {
      return false
    }
  }

  /** The allowed spelling of a typed genre, or null while restricted and it is not on the list. */
  function acceptGenre(raw: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    return restricted.value ? matchAllowedGenre(trimmed, policy.value.genres) : trimmed
  }

  /** Allowed genres containing the query, for a picker that may only offer those. */
  async function searchAllowed(query: string): Promise<string[]> {
    const needle = query.trim().toLowerCase()
    return policy.value.genres.filter((genre) => !needle || genre.toLowerCase().includes(needle)).slice(0, 20)
  }

  return { policy, loaded, restricted, load, save, acceptGenre, searchAllowed }
}
