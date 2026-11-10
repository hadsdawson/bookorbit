import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (path: string, init?: RequestInit) => api(path, init) }))

import { useGenrePolicy } from '../useGenrePolicy'

function respond(body: unknown) {
  api.mockResolvedValue({ ok: true, json: async () => body } as Response)
}

describe('useGenrePolicy', () => {
  beforeEach(() => api.mockReset())

  it('accepts any genre while the list is off', async () => {
    respond({ enabled: false, genres: ['Fantasy'] })
    const policy = useGenrePolicy()
    await policy.load()
    expect(policy.acceptGenre(' Horror ')).toBe('Horror')
  })

  it('accepts only listed genres, in their listed spelling, while on', async () => {
    respond({ enabled: true, genres: ['Science Fiction', 'Fantasy'] })
    const policy = useGenrePolicy()
    await policy.load()
    expect(policy.acceptGenre('science fiction')).toBe('Science Fiction')
    expect(policy.acceptGenre('Horror')).toBeNull()
  })

  it('suggests listed genres containing what was typed', async () => {
    respond({ enabled: true, genres: ['Science Fiction', 'Fantasy', 'Historical Fiction'] })
    const policy = useGenrePolicy()
    await policy.load()
    await expect(policy.searchAllowed('fic')).resolves.toEqual(['Science Fiction', 'Historical Fiction'])
  })

  it('saves and adopts what the server returns', async () => {
    const policy = useGenrePolicy()
    respond({ enabled: true, genres: ['Romance'] })
    await expect(policy.save({ enabled: true, genres: ['romance '] })).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/v1/genre-policy', expect.objectContaining({ method: 'PUT' }))
    expect(policy.policy.value).toEqual({ enabled: true, genres: ['Romance'] })
  })
})
