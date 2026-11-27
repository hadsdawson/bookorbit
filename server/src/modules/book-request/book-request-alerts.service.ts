import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BOOK_REQUEST_ALERT_SETTING_KEYS, MAX_BOOK_REQUEST_ALERT_EMAILS, Permission } from '@bookorbit/types';
import type {
  BookRequestAlertChannel,
  BookRequestAlertSettings,
  BookRequestAlertTestResult,
  StoredBookRequestMediaKind,
  UpdateBookRequestAlertSettingsPayload,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { DEV_CLIENT_ORIGIN } from '../../config/dev-client-origin';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { SystemMailService } from '../email/system-mail.service';
import { RequestCredentialService } from './request-credential.service';

const KEYS = BOOK_REQUEST_ALERT_SETTING_KEYS;
const DISCORD_TIMEOUT_MS = 10_000;
const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);
const DISCORD_COLOR = 0x5865f2;

export interface NewRequestAlert {
  requester: Pick<RequestUser, 'id' | 'name' | 'isSuperuser' | 'permissions'>;
  title: string;
  mediaKinds: StoredBookRequestMediaKind[];
  /** Approved on the way in, by permission or because the requester fulfils it themselves. */
  approved: boolean;
}

interface AlertMessage {
  subject: string;
  lines: string[];
  link: string | null;
}

interface StoredAlertSettings {
  discordEnabled: boolean;
  discordWebhook: string | null;
  emailEnabled: boolean;
  emailTo: string[];
  includeAdminRequests: boolean;
}

/**
 * Fork. Tells admins about new book requests by Discord and email, so a request does not wait on
 * somebody happening to open the app. Alerts are best effort: a failed send is logged and never
 * fails the request that caused it.
 */
@Injectable()
export class BookRequestAlertService {
  private readonly logger = new Logger(BookRequestAlertService.name);

  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly credentials: RequestCredentialService,
    private readonly config: ConfigService,
    @Optional() private readonly systemMail?: SystemMailService,
  ) {}

  async getSettings(): Promise<BookRequestAlertSettings> {
    const stored = await this.readStored();
    return {
      discordEnabled: stored.discordEnabled,
      discordWebhookSet: stored.discordWebhook !== null,
      emailEnabled: stored.emailEnabled,
      emailTo: stored.emailTo,
      includeAdminRequests: stored.includeAdminRequests,
      emailProviderReady: (await this.systemMail?.isConfigured()) ?? false,
      encryptionConfigured: this.credentials.isConfigured(),
    };
  }

  async updateSettings(payload: UpdateBookRequestAlertSettingsPayload): Promise<BookRequestAlertSettings> {
    if (payload.discordWebhookUrl !== undefined) {
      if (payload.discordWebhookUrl === null || payload.discordWebhookUrl.trim() === '') {
        await this.appSettings.setValue(KEYS.DISCORD_WEBHOOK, '');
      } else {
        const url = normalizeDiscordWebhook(payload.discordWebhookUrl);
        await this.appSettings.setValue(KEYS.DISCORD_WEBHOOK, this.credentials.encrypt(url));
      }
    }
    if (payload.discordEnabled !== undefined) {
      await this.appSettings.setValue(KEYS.DISCORD_ENABLED, String(payload.discordEnabled));
    }
    if (payload.emailEnabled !== undefined) {
      await this.appSettings.setValue(KEYS.EMAIL_ENABLED, String(payload.emailEnabled));
    }
    if (payload.emailTo !== undefined) {
      const addresses = normalizeEmails(payload.emailTo);
      await this.appSettings.setValue(KEYS.EMAIL_TO, JSON.stringify(addresses));
    }
    if (payload.includeAdminRequests !== undefined) {
      await this.appSettings.setValue(KEYS.INCLUDE_ADMIN_REQUESTS, String(payload.includeAdminRequests));
    }
    return this.getSettings();
  }

  /** Sends a sample alert through one channel and says plainly what happened. */
  async sendTest(channel: BookRequestAlertChannel): Promise<BookRequestAlertTestResult> {
    const stored = await this.readStored();
    const message: AlertMessage = {
      subject: 'Test alert from BookOrbit',
      lines: ['This is a test. New book requests will be announced here.'],
      link: this.requestsLink(),
    };
    try {
      if (channel === 'discord') {
        if (!stored.discordWebhook) return { channel, ok: false, message: 'Save a Discord webhook link first.' };
        await this.sendDiscord(stored.discordWebhook, message);
        return { channel, ok: true, message: 'Sent. Check your Discord channel.' };
      }
      if (stored.emailTo.length === 0) return { channel, ok: false, message: 'Add at least one email address first.' };
      await this.sendEmail(stored.emailTo, message);
      return { channel, ok: true, message: `Sent to ${stored.emailTo.join(', ')}. Check your inbox (and spam folder).` };
    } catch (error) {
      return { channel, ok: false, message: error instanceof Error ? error.message : 'Sending failed' };
    }
  }

  /** Never throws and never waits on the network: the request is already made. */
  announce(alert: NewRequestAlert): void {
    void this.deliver(alert).catch((error: unknown) => {
      this.logger.warn(
        `[book_request.alert] [fail] userId=${alert.requester.id} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - book request alert failed`,
      );
    });
  }

  private async deliver(alert: NewRequestAlert): Promise<void> {
    const stored = await this.readStored();
    const discord = stored.discordEnabled && stored.discordWebhook !== null;
    const email = stored.emailEnabled && stored.emailTo.length > 0;
    if (!discord && !email) return;
    if (!stored.includeAdminRequests && isRequestAdmin(alert.requester)) return;

    const startedAt = Date.now();
    this.logger.log(`[book_request.alert] [start] userId=${alert.requester.id} discord=${discord} email=${email} - book request alert started`);
    const message = this.buildMessage(alert);
    const sends: Array<Promise<void>> = [];
    if (discord) sends.push(this.sendDiscord(stored.discordWebhook!, message));
    if (email) sends.push(this.sendEmail(stored.emailTo, message));
    const results = await Promise.allSettled(sends);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    for (const failure of failures) {
      const reason: unknown = failure.reason;
      this.logger.warn(
        `[book_request.alert] [fail] userId=${alert.requester.id} durationMs=${Date.now() - startedAt} errorClass=${reason instanceof Error ? reason.name : 'Error'} error="${sanitizeLogValue(reason instanceof Error ? reason.message : String(reason))}" - book request alert channel failed`,
      );
    }
    this.logger.log(
      `[book_request.alert] [end] userId=${alert.requester.id} durationMs=${Date.now() - startedAt} sent=${results.length - failures.length} failed=${failures.length} - book request alert completed`,
    );
  }

  private buildMessage(alert: NewRequestAlert): AlertMessage {
    const media =
      alert.mediaKinds.length > 1 ? 'as an ebook and an audiobook' : alert.mediaKinds[0] === 'audiobook' ? 'as an audiobook' : 'as an ebook';
    return {
      subject: `New book request: ${alert.title}`,
      lines: [
        `${alert.requester.name} requested "${alert.title}" ${media}.`,
        alert.approved ? 'It was approved automatically and is being looked for.' : 'It is waiting for your approval.',
      ],
      link: this.requestsLink(),
    };
  }

  /** Only when APP_URL is set: the built-in default points at a development server, not the NAS. */
  private requestsLink(): string | null {
    const appUrl = (this.config.get<string>('app.appUrl') ?? '').replace(/\/+$/, '');
    if (!appUrl || appUrl === DEV_CLIENT_ORIGIN) return null;
    return `${appUrl}/requests?tab=all`;
  }

  private async sendDiscord(webhook: string, message: AlertMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'BookOrbit',
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: message.subject,
              description: message.lines.join('\n'),
              color: DISCORD_COLOR,
              ...(message.link ? { url: message.link } : {}),
              timestamp: new Date().toISOString(),
            },
          ],
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('Discord did not answer within 10 seconds.', { cause: error });
      throw new Error('Could not reach Discord. Check that the NAS can reach the internet.', { cause: error });
    }
    if (response.ok) return;
    throw new Error(describeDiscordStatus(response.status));
  }

  private async sendEmail(to: string[], message: AlertMessage): Promise<void> {
    if (!this.systemMail) throw new Error('Email is not available on this server.');
    const text = [...message.lines, ...(message.link ? ['', `Open requests: ${message.link}`] : [])].join('\n');
    const html = renderEmailHtml(message);
    await this.systemMail.sendAdminAlert(to, message.subject, text, html);
  }

  private async readStored(): Promise<StoredAlertSettings> {
    const values = await this.appSettings.getValues(Object.values(KEYS));
    return {
      discordEnabled: values.get(KEYS.DISCORD_ENABLED) === 'true',
      discordWebhook: this.readWebhook(values.get(KEYS.DISCORD_WEBHOOK)),
      emailEnabled: values.get(KEYS.EMAIL_ENABLED) === 'true',
      emailTo: parseEmails(values.get(KEYS.EMAIL_TO)),
      includeAdminRequests: values.get(KEYS.INCLUDE_ADMIN_REQUESTS) === 'true',
    };
  }

  /** A webhook nobody can decrypt any more reads as none, which the settings page then shows. */
  private readWebhook(stored: string | undefined): string | null {
    if (!stored) return null;
    try {
      return this.credentials.decrypt(stored);
    } catch {
      return null;
    }
  }
}

function isRequestAdmin(user: NewRequestAlert['requester']): boolean {
  return user.isSuperuser || user.permissions.includes(Permission.ManageBookRequests);
}

/** Only Discord's own webhook addresses: anything else would let this form post to any server. */
export function normalizeDiscordWebhook(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException('That is not a valid link. Copy the webhook URL from Discord and paste it here.');
  }
  if (url.protocol !== 'https:' || !DISCORD_HOSTS.has(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) {
    throw new BadRequestException('That does not look like a Discord webhook link. It should start with https://discord.com/api/webhooks/');
  }
  url.hash = '';
  return url.toString();
}

export function normalizeEmails(raw: string[]): string[] {
  const addresses = [...new Set(raw.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0))];
  if (addresses.length > MAX_BOOK_REQUEST_ALERT_EMAILS) {
    throw new BadRequestException(`Up to ${MAX_BOOK_REQUEST_ALERT_EMAILS} email addresses can get alerts.`);
  }
  return addresses;
}

function parseEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
  } catch {
    return [];
  }
}

function describeDiscordStatus(status: number): string {
  if (status === 401 || status === 403) return 'Discord refused the webhook. Create a new one and paste it in again.';
  if (status === 404) return 'Discord says this webhook no longer exists. It may have been deleted; create a new one.';
  if (status === 429) return 'Discord is limiting messages right now. Try again in a minute.';
  return `Discord answered with an error (HTTP ${status}).`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderEmailHtml(message: AlertMessage): string {
  const paragraphs = message.lines
    .map((line) => `<p style="margin:0 0 12px;font-size:14px;color:#3f3f46;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join('');
  const button = message.link
    ? `<a href="${escapeHtml(message.link)}" style="display:inline-block;margin-top:8px;padding:10px 20px;background:#18181b;color:#ffffff;font-size:14px;text-decoration:none;border-radius:6px;">Open requests</a>`
    : '';
  return `<!DOCTYPE html><html lang="en"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;padding:24px 28px;">
<tr><td><p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">${escapeHtml(message.subject)}</p>${paragraphs}${button}</td></tr>
</table></td></tr></table></body></html>`;
}
