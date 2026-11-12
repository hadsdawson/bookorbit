import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BACKUP_SETTINGS, type BackupOverview } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))
const downloadMock = vi.hoisted(() => vi.fn<(url: string, name: string) => Promise<void>>())
vi.mock('@/lib/download', () => ({ downloadFromUrl: downloadMock }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))

import BackupsSettings from '../BackupsSettings.vue'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const BACKUP = {
  name: 'bookorbit-backup-20261112T080000Z-scheduled.zip',
  kind: 'scheduled' as const,
  createdAt: '2026-11-12T08:00:00.000Z',
  size: 2_500_000,
  appVersion: 'v3.8.0',
}

function overview(extra: Partial<BackupOverview> = {}): BackupOverview {
  return {
    settings: { ...DEFAULT_BACKUP_SETTINGS, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    backups: [BACKUP],
    location: '/backups',
    locationInsideAppData: false,
    running: null,
    pendingRestore: null,
    lastError: null,
    lastRestore: null,
    ...extra,
  }
}

function buttonWith(text: string): HTMLButtonElement {
  return [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(text))!
}

describe('BackupsSettings', () => {
  beforeEach(() => {
    apiMock.mockReset()
    downloadMock.mockReset().mockResolvedValue()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('lists backups with their kind, size and version', async () => {
    apiMock.mockResolvedValueOnce(json(overview()))
    mount(BackupsSettings, { attachTo: document.body })
    await flushPromises()

    const text = document.body.textContent ?? ''
    expect(text).toContain('Scheduled')
    expect(text).toContain('v3.8.0')
    expect(text).toContain('/backups')
    expect(text).not.toContain('inside BookOrbit')
  })

  it('warns when backups sit inside the app data folder', async () => {
    apiMock.mockResolvedValueOnce(json(overview({ location: '/data/backups', locationInsideAppData: true })))
    mount(BackupsSettings, { attachTo: document.body })
    await flushPromises()
    expect(document.body.textContent).toContain("inside BookOrbit's own data folder")
  })

  it('saves a changed schedule and keep count', async () => {
    apiMock.mockResolvedValueOnce(json(overview()))
    const wrapper = mount(BackupsSettings, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('select').setValue('weekly')
    await wrapper.find('input[type="time"]').setValue('03:30')
    await wrapper.find('input[type="number"]').setValue('4')
    apiMock.mockImplementationOnce((_url, init) => Promise.resolve(json(JSON.parse(String(init?.body)))))
    buttonWith('Save').click()
    await flushPromises()

    const [url, init] = apiMock.mock.calls.at(-1)!
    expect(url).toBe('/api/v1/backups/settings')
    expect(JSON.parse(String(init?.body))).toMatchObject({ frequency: 'weekly', time: '03:30', keep: 4 })
  })

  it('downloads a backup through a plain link', async () => {
    apiMock.mockResolvedValueOnce(json(overview()))
    mount(BackupsSettings, { attachTo: document.body })
    await flushPromises()
    buttonWith('Download').click()
    expect(downloadMock).toHaveBeenCalledWith(`/api/v1/backups/${BACKUP.name}/download`, BACKUP.name)
  })

  it('asks for RESTORE to be typed, then restarts and waits for BookOrbit to come back', async () => {
    vi.useFakeTimers()
    apiMock.mockResolvedValueOnce(json(overview()))
    mount(BackupsSettings, { attachTo: document.body })
    await flushPromises()

    buttonWith('Restore').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Anything changed since then is lost')
    const confirm = buttonWith('Restore and restart')
    expect(confirm.disabled).toBe(true)

    const phrase = document.body.querySelector<HTMLInputElement>('[role="alertdialog"] input, [role="dialog"] input')!
    phrase.value = 'RESTORE'
    phrase.dispatchEvent(new Event('input'))
    await flushPromises()
    apiMock.mockResolvedValueOnce(json({ restarting: true }, 202))
    buttonWith('Restore and restart').click()
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(`/api/v1/backups/${BACKUP.name}/restore`, { method: 'POST' })
    expect(document.body.textContent).toContain('Restoring and restarting')

    apiMock.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(document.body.textContent).toContain('Restoring and restarting')

    apiMock.mockResolvedValueOnce(
      json(overview({ lastRestore: { name: BACKUP.name, ok: true, finishedAt: '2026-11-12T13:00:00.000Z', safetyBackup: 'x' } })),
    )
    await vi.advanceTimersByTimeAsync(3_000)
    await flushPromises()
    expect(document.body.textContent).toContain('Backup restored on')
    expect(document.body.textContent).toContain('Before restore')
  })

  it('shows why the last backup failed', async () => {
    apiMock.mockResolvedValueOnce(json(overview({ lastError: 'pg_dump could not start' })))
    mount(BackupsSettings, { attachTo: document.body })
    await flushPromises()
    expect(document.body.textContent).toContain('The last backup failed')
    expect(document.body.textContent).toContain('pg_dump could not start')
  })
})
