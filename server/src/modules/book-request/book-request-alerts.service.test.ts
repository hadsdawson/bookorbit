import { BadRequestException } from '@nestjs/common';
import { BOOK_REQUEST_ALERT_SETTING_KEYS as KEYS, Permission } from '@bookorbit/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookRequestAlertService, normalizeDiscordWebhook, normalizeEmails } from './book-request-alerts.service';

const WEBHOOK = 'https://discord.com/api/webhooks/123/abc';

function makeService(stored: Record<string, string> = {}, options: { appUrl?: string; mailReady?: boolean } = {}) {
  const values = new Map(Object.entries(stored));
  const appSettings = {
    getValues: vi.fn((keys: string[]) => Promise.resolve(new Map(keys.filter((key) => values.has(key)).map((key) => [key, values.get(key)!])))),
    setValue: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
  };
  const credentials = {
    isConfigured: vi.fn().mockReturnValue(true),
    encrypt: vi.fn((plain: string) => `enc:${plain}`),
    decrypt: vi.fn((cipher: string) => cipher.replace(/^enc:/, '')),
  };
  const config = { get: vi.fn().mockReturnValue(options.appUrl ?? 'https://books.example.com') };
  const systemMail = {
    isConfigured: vi.fn().mockResolvedValue(options.mailReady ?? true),
    sendAdminAlert: vi.fn().mockResolvedValue(undefined),
  };
  const service = new BookRequestAlertService(appSettings as never, credentials as never, config as never, systemMail as never);
  return { service, appSettings, credentials, systemMail, values };
}

const reader = { id: 7, name: 'Reader', isSuperuser: false, permissions: [Permission.BookRequestAccess] };

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeDiscordWebhook', () => {
  it('accepts a Discord webhook link', () => {
    expect(normalizeDiscordWebhook(`  ${WEBHOOK}  `)).toBe(WEBHOOK);
  });

  it('refuses anything that is not a Discord webhook', () => {
    expect(() => normalizeDiscordWebhook('https://example.com/api/webhooks/1/x')).toThrow(BadRequestException);
    expect(() => normalizeDiscordWebhook('http://discord.com/api/webhooks/1/x')).toThrow(BadRequestException);
    expect(() => normalizeDiscordWebhook('https://discord.com/channels/1')).toThrow(BadRequestException);
    expect(() => normalizeDiscordWebhook('not a link')).toThrow(BadRequestException);
  });
});

describe('normalizeEmails', () => {
  it('trims, lowercases and drops repeats and blanks', () => {
    expect(normalizeEmails([' Me@Example.com', 'me@example.com', '', 'you@example.com'])).toEqual(['me@example.com', 'you@example.com']);
  });
});

describe('BookRequestAlertService settings', () => {
  it('encrypts a new webhook and never returns it', async () => {
    const { service, values } = makeService();

    const settings = await service.updateSettings({ discordWebhookUrl: WEBHOOK, discordEnabled: true, emailTo: ['me@example.com'] });

    expect(values.get(KEYS.DISCORD_WEBHOOK)).toBe(`enc:${WEBHOOK}`);
    expect(settings).toMatchObject({ discordEnabled: true, discordWebhookSet: true, emailTo: ['me@example.com'], emailProviderReady: true });
    expect(JSON.stringify(settings)).not.toContain('webhooks');
  });

  it('removes the webhook when cleared', async () => {
    const { service } = makeService({ [KEYS.DISCORD_WEBHOOK]: `enc:${WEBHOOK}` });

    const settings = await service.updateSettings({ discordWebhookUrl: null });

    expect(settings.discordWebhookSet).toBe(false);
  });
});

describe('BookRequestAlertService.announce', () => {
  it('posts to Discord and emails for a new request, with a link to the requests page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { service, systemMail } = makeService({
      [KEYS.DISCORD_ENABLED]: 'true',
      [KEYS.DISCORD_WEBHOOK]: `enc:${WEBHOOK}`,
      [KEYS.EMAIL_ENABLED]: 'true',
      [KEYS.EMAIL_TO]: JSON.stringify(['me@example.com']),
    });

    service.announce({ requester: reader, title: 'Dune', mediaKinds: ['ebook'], approved: true });
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(WEBHOOK, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { embeds: Array<{ description: string; url: string }> };
    expect(body.embeds[0]!.description).toContain('Reader requested "Dune" as an ebook.');
    expect(body.embeds[0]!.description).toContain('approved automatically');
    expect(body.embeds[0]!.url).toBe('https://books.example.com/requests?tab=all');
    expect(systemMail.sendAdminAlert).toHaveBeenCalledWith(
      ['me@example.com'],
      'New book request: Dune',
      expect.stringContaining('Reader'),
      expect.any(String),
    );
  });

  it('stays quiet for requests made by admins unless asked not to', async () => {
    const { service, systemMail } = makeService({ [KEYS.EMAIL_ENABLED]: 'true', [KEYS.EMAIL_TO]: JSON.stringify(['me@example.com']) });

    service.announce({ requester: { ...reader, isSuperuser: true }, title: 'Dune', mediaKinds: ['ebook'], approved: true });
    await flush();

    expect(systemMail.sendAdminAlert).not.toHaveBeenCalled();
  });

  it('sends nothing when no channel is turned on', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service, systemMail } = makeService({ [KEYS.DISCORD_WEBHOOK]: `enc:${WEBHOOK}`, [KEYS.EMAIL_TO]: JSON.stringify(['me@example.com']) });

    service.announce({ requester: reader, title: 'Dune', mediaKinds: ['ebook'], approved: false });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(systemMail.sendAdminAlert).not.toHaveBeenCalled();
  });

  it('leaves the link out when APP_URL is the development default', async () => {
    const { service, systemMail } = makeService(
      { [KEYS.EMAIL_ENABLED]: 'true', [KEYS.EMAIL_TO]: JSON.stringify(['me@example.com']) },
      { appUrl: 'http://localhost:6263' },
    );

    service.announce({ requester: reader, title: 'Dune', mediaKinds: ['ebook', 'audiobook'], approved: false });
    await flush();

    const [, , text] = systemMail.sendAdminAlert.mock.calls[0]! as [string[], string, string];
    expect(text).toContain('as an ebook and an audiobook');
    expect(text).toContain('waiting for your approval');
    expect(text).not.toContain('localhost');
  });

  it('never throws when a channel fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { service } = makeService({ [KEYS.DISCORD_ENABLED]: 'true', [KEYS.DISCORD_WEBHOOK]: `enc:${WEBHOOK}` });

    expect(() => service.announce({ requester: reader, title: 'Dune', mediaKinds: ['ebook'], approved: true })).not.toThrow();
    await flush();
  });
});

describe('BookRequestAlertService.sendTest', () => {
  it('explains a deleted Discord webhook in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const { service } = makeService({ [KEYS.DISCORD_WEBHOOK]: `enc:${WEBHOOK}` });

    const result = await service.sendTest('discord');

    expect(result).toEqual({ channel: 'discord', ok: false, message: expect.stringContaining('no longer exists') });
  });

  it('asks for an address before testing email', async () => {
    const { service } = makeService();

    expect(await service.sendTest('email')).toMatchObject({ ok: false, message: 'Add at least one email address first.' });
  });

  it('reports a successful email test', async () => {
    const { service, systemMail } = makeService({ [KEYS.EMAIL_TO]: JSON.stringify(['me@example.com']) });

    const result = await service.sendTest('email');

    expect(result.ok).toBe(true);
    expect(systemMail.sendAdminAlert).toHaveBeenCalledWith(['me@example.com'], 'Test alert from BookOrbit', expect.any(String), expect.any(String));
  });
});
