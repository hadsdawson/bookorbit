/**
 * Fork. Alerts for new book requests sent outside the app, so an admin hears about a request
 * without having BookOrbit open. Stored in `app_settings`; the Discord webhook is encrypted.
 */
export const BOOK_REQUEST_ALERT_SETTING_KEYS = {
  DISCORD_ENABLED: "book_request_alerts.discord_enabled",
  DISCORD_WEBHOOK: "book_request_alerts.discord_webhook_enc",
  EMAIL_ENABLED: "book_request_alerts.email_enabled",
  EMAIL_TO: "book_request_alerts.email_to",
  INCLUDE_ADMIN_REQUESTS: "book_request_alerts.include_admin_requests",
} as const;

export const MAX_BOOK_REQUEST_ALERT_EMAILS = 10;

export const BOOK_REQUEST_ALERT_CHANNELS = ["discord", "email"] as const;
export type BookRequestAlertChannel = (typeof BOOK_REQUEST_ALERT_CHANNELS)[number];

export interface BookRequestAlertSettings {
  discordEnabled: boolean;
  /** The webhook itself is never sent back to the browser, only whether one is saved. */
  discordWebhookSet: boolean;
  emailEnabled: boolean;
  emailTo: string[];
  /** Off by default: an admin who files a request already knows about it. */
  includeAdminRequests: boolean;
  /** Whether a system mail provider exists, which email alerts are sent through. */
  emailProviderReady: boolean;
  /** Whether the server can encrypt the webhook, which saving one needs. */
  encryptionConfigured: boolean;
}

export interface UpdateBookRequestAlertSettingsPayload {
  discordEnabled?: boolean;
  /** A new webhook replaces the saved one; null removes it; omitted keeps it. */
  discordWebhookUrl?: string | null;
  emailEnabled?: boolean;
  emailTo?: string[];
  includeAdminRequests?: boolean;
}

export interface BookRequestAlertTestResult {
  channel: BookRequestAlertChannel;
  ok: boolean;
  message: string;
}
