import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(path: string, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))

import RequestAlertsPanel from '../RequestAlertsPanel.vue'

const baseSettings = {
  discordEnabled: false,
  discordWebhookSet: false,
  emailEnabled: false,
  emailTo: [] as string[],
  includeAdminRequests: false,
  emailProviderReady: true,
  encryptionConfigured: true,
}

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

describe('RequestAlertsPanel', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('saves a pasted webhook and turns Discord on with it', async () => {
    apiMock.mockImplementation((_path, init) =>
      init?.method === 'PUT' ? json({ ...baseSettings, discordEnabled: true, discordWebhookSet: true }) : json(baseSettings),
    )
    const wrapper = mount(RequestAlertsPanel)
    await flushPromises()

    await wrapper.find('#request-alerts-webhook').setValue('https://discord.com/api/webhooks/1/abc')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save link')!
      .trigger('click')
    await flushPromises()

    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1]!.body as string)).toEqual({ discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc', discordEnabled: true })
    expect(wrapper.text()).toContain('A webhook is saved')
  })

  it('says when there is no system mail provider for email alerts', async () => {
    apiMock.mockImplementation(() => json({ ...baseSettings, emailProviderReady: false }))
    const wrapper = mount(RequestAlertsPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('No system mail provider is set yet')
  })

  it('splits typed addresses before saving them', async () => {
    apiMock.mockImplementation((_path, init) =>
      init?.method === 'PUT' ? json({ ...baseSettings, emailEnabled: true, emailTo: ['a@x.com', 'b@x.com'] }) : json(baseSettings),
    )
    const wrapper = mount(RequestAlertsPanel)
    await flushPromises()

    await wrapper.find('#request-alerts-email').setValue('a@x.com, b@x.com')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save addresses')!
      .trigger('click')
    await flushPromises()

    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1]!.body as string)).toEqual({ emailTo: ['a@x.com', 'b@x.com'], emailEnabled: true })
  })
})
