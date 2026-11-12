import { onScopeDispose, ref } from 'vue'
import type { BackupInfo, BackupOverview, BackupSettings } from '@bookorbit/types'
import { api } from '@/lib/api'
import { downloadFromUrl } from '@/lib/download'

const RESTART_POLL_MS = 3_000
/** How long to wait for BookOrbit to come back after a restore before saying something is wrong. */
const RESTART_GIVE_UP_MS = 10 * 60_000

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] }
    const message = Array.isArray(body.message) ? body.message.join(' ') : body.message
    return message || fallback
  } catch {
    return fallback
  }
}

/** Everything the Backups page shows and does, against /api/v1/backups. */
export function useBackups() {
  const overview = ref<BackupOverview | null>(null)
  const loading = ref(true)
  const busy = ref<'save' | 'create' | 'upload' | 'restore' | 'delete' | null>(null)
  const error = ref<string | null>(null)
  /** Set while BookOrbit restarts into a restore; cleared once it answers again. */
  const restarting = ref<string | null>(null)
  const restartTimedOut = ref(false)
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<boolean> {
    try {
      const res = await api('/api/v1/backups')
      if (!res.ok) throw new Error(await readError(res, 'Could not load backups'))
      overview.value = (await res.json()) as BackupOverview
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      loading.value = false
    }
  }

  async function run<T>(kind: NonNullable<typeof busy.value>, action: () => Promise<T>): Promise<T | null> {
    busy.value = kind
    error.value = null
    try {
      return await action()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busy.value = null
    }
  }

  function saveSettings(settings: BackupSettings) {
    return run('save', async () => {
      const res = await api('/api/v1/backups/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not save the backup settings'))
      const saved = (await res.json()) as BackupSettings
      if (overview.value) overview.value = { ...overview.value, settings: saved }
      return saved
    })
  }

  function createNow() {
    return run('create', async () => {
      const res = await api('/api/v1/backups', { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res, 'The backup failed'))
      const backup = (await res.json()) as BackupInfo
      await load()
      return backup
    })
  }

  function upload(file: File) {
    return run('upload', async () => {
      const form = new FormData()
      form.append('file', file)
      const res = await api('/api/v1/backups/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await readError(res, 'Could not upload that backup'))
      const backup = (await res.json()) as BackupInfo
      await load()
      return backup
    })
  }

  function remove(name: string) {
    return run('delete', async () => {
      const res = await api(`/api/v1/backups/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readError(res, 'Could not delete that backup'))
      await load()
      return true
    })
  }

  function download(name: string) {
    return downloadFromUrl(`/api/v1/backups/${encodeURIComponent(name)}/download`, name)
  }

  function restore(name: string) {
    return run('restore', async () => {
      const res = await api(`/api/v1/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res, 'That backup cannot be restored'))
      restarting.value = name
      restartTimedOut.value = false
      waitForRestart(Date.now())
      return true
    })
  }

  /** Waits for BookOrbit to stop, restore and answer again, then shows how the restore went. */
  function waitForRestart(startedAt: number) {
    pollTimer = setTimeout(async () => {
      pollTimer = null
      let back = false
      try {
        const res = await api('/api/v1/backups')
        if (res.ok) {
          const next = (await res.json()) as BackupOverview
          // Still the old process if the restore it asked for is waiting.
          back = next.pendingRestore === null
          if (back) overview.value = next
        }
      } catch {
        // Not back yet.
      }
      if (back) {
        restarting.value = null
      } else if (Date.now() - startedAt > RESTART_GIVE_UP_MS) {
        restartTimedOut.value = true
      } else {
        waitForRestart(startedAt)
      }
    }, RESTART_POLL_MS)
  }

  onScopeDispose(() => {
    if (pollTimer) clearTimeout(pollTimer)
  })

  return { overview, loading, busy, error, restarting, restartTimedOut, load, saveSettings, createNow, upload, remove, download, restore }
}
