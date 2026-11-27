<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookRequestAlertChannel, UpdateBookRequestAlertSettingsPayload } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { Button } from '@/components/ui/button'
import SettingsRow from './components/SettingsRow.vue'
import { useRequestAlerts } from '@/features/book-requests/composables/useRequestAlerts'

const { t } = useI18n()
const { settings, loading, loadFailed, fetchSettings, save, sendTest } = useRequestAlerts()

const webhookInput = ref('')
const emailInput = ref('')
const testing = ref<BookRequestAlertChannel | null>(null)

watch(
  () => settings.value.emailTo,
  (next) => {
    emailInput.value = next.join(', ')
  },
)

onMounted(fetchSettings)

function stateLabel(enabled: boolean) {
  return enabled ? t('settings.system.requests.alerts.stateOn') : t('settings.system.requests.alerts.stateOff')
}

async function apply(payload: UpdateBookRequestAlertSettingsPayload): Promise<boolean> {
  const failure = await save(payload)
  if (failure === null) return true
  toast.error(failure || t('settings.system.requests.alerts.saveFailed'))
  return false
}

function handleDiscordToggle(value: boolean) {
  void apply({ discordEnabled: value })
}

function handleEmailToggle(value: boolean) {
  void apply({ emailEnabled: value })
}

function handleIncludeAdminsToggle(value: boolean) {
  void apply({ includeAdminRequests: value })
}

async function handleSaveWebhook() {
  const url = webhookInput.value.trim()
  if (!url) return
  if (await apply({ discordWebhookUrl: url, ...(settings.value.discordWebhookSet ? {} : { discordEnabled: true }) })) {
    webhookInput.value = ''
    toast.success(t('settings.system.requests.alerts.saved'))
  }
}

async function handleRemoveWebhook() {
  if (await apply({ discordWebhookUrl: null, discordEnabled: false })) toast.success(t('settings.system.requests.alerts.saved'))
}

async function handleSaveEmails() {
  const addresses = emailInput.value
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const turnOn = addresses.length > 0 && settings.value.emailTo.length === 0 && !settings.value.emailEnabled
  if (await apply({ emailTo: addresses, ...(turnOn ? { emailEnabled: true } : {}) })) toast.success(t('settings.system.requests.alerts.saved'))
}

async function runTest(channel: BookRequestAlertChannel) {
  testing.value = channel
  try {
    const result = await sendTest(channel)
    if (result.ok) toast.success(result.message)
    else toast.error(result.message || t('settings.system.requests.alerts.testFailed'))
  } finally {
    testing.value = null
  }
}

function handleTestDiscord() {
  void runTest('discord')
}

function handleTestEmail() {
  void runTest('email')
}
</script>

<template>
  <div v-if="loading" class="settings-loading-state">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
    <span class="sr-only">{{ t('settings.system.requests.alerts.loading') }}</span>
  </div>

  <section v-else aria-labelledby="request-alerts-heading" class="space-y-3">
    <h2 id="request-alerts-heading" class="sr-only">{{ t('settings.system.requests.alerts.title') }}</h2>

    <p v-if="loadFailed" role="alert" class="text-sm text-destructive">{{ t('settings.system.requests.alerts.loadFailed') }}</p>
    <p class="settings-hint settings-prose">{{ t('settings.system.requests.alerts.intro') }}</p>

    <div class="settings-card">
      <div class="settings-card-header">
        <span class="settings-card-title">{{ t('settings.system.requests.alerts.discordTitle') }}</span>
        <span class="settings-state-pill">{{ stateLabel(settings.discordEnabled && settings.discordWebhookSet) }}</span>
      </div>

      <SettingsRow :label="t('settings.system.requests.alerts.discordToggle')" :hint="t('settings.system.requests.alerts.discordHint')">
        <ToggleSwitch
          :model-value="settings.discordEnabled"
          :disabled="!settings.discordWebhookSet"
          :aria-label="t('settings.system.requests.alerts.discordToggle')"
          @update:model-value="handleDiscordToggle"
        />
      </SettingsRow>

      <div class="space-y-2 bg-card px-4 py-3 md:px-5">
        <label for="request-alerts-webhook" class="settings-label block">{{ t('settings.system.requests.alerts.webhookLabel') }}</label>
        <p class="settings-hint settings-prose">{{ t('settings.system.requests.alerts.webhookHint') }}</p>
        <p v-if="!settings.encryptionConfigured" role="alert" class="settings-hint text-destructive">
          {{ t('settings.system.requests.alerts.encryptionMissing') }}
        </p>
        <p v-else-if="settings.discordWebhookSet" class="settings-hint text-foreground">{{ t('settings.system.requests.alerts.webhookSaved') }}</p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="request-alerts-webhook"
            v-model="webhookInput"
            type="url"
            autocomplete="off"
            :placeholder="t('settings.system.requests.alerts.webhookPlaceholder')"
            :disabled="!settings.encryptionConfigured"
            class="input-field min-w-0 flex-1"
          />
          <div class="flex gap-2">
            <Button size="sm" :disabled="!webhookInput.trim() || !settings.encryptionConfigured" @click="handleSaveWebhook">
              {{ t('settings.system.requests.alerts.saveWebhook') }}
            </Button>
            <Button v-if="settings.discordWebhookSet" size="sm" variant="outline" :disabled="testing !== null" @click="handleTestDiscord">
              <Loader2 v-if="testing === 'discord'" class="size-3.5 animate-spin" />
              {{ t('settings.system.requests.alerts.sendTest') }}
            </Button>
            <Button v-if="settings.discordWebhookSet" size="sm" variant="outline" @click="handleRemoveWebhook">
              {{ t('settings.system.requests.alerts.removeWebhook') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <span class="settings-card-title">{{ t('settings.system.requests.alerts.emailTitle') }}</span>
        <span class="settings-state-pill">{{ stateLabel(settings.emailEnabled && settings.emailTo.length > 0) }}</span>
      </div>

      <SettingsRow :label="t('settings.system.requests.alerts.emailToggle')" :hint="t('settings.system.requests.alerts.emailHint')">
        <ToggleSwitch
          :model-value="settings.emailEnabled"
          :aria-label="t('settings.system.requests.alerts.emailToggle')"
          @update:model-value="handleEmailToggle"
        />
      </SettingsRow>

      <p v-if="!settings.emailProviderReady" role="status" class="settings-hint settings-prose bg-card px-4 pb-3 text-warning md:px-5">
        {{ t('settings.system.requests.alerts.emailNoProvider') }}
      </p>

      <div class="space-y-2 bg-card px-4 py-3 md:px-5">
        <label for="request-alerts-email" class="settings-label block">{{ t('settings.system.requests.alerts.emailToLabel') }}</label>
        <p class="settings-hint settings-prose">{{ t('settings.system.requests.alerts.emailToHint') }}</p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="request-alerts-email"
            v-model="emailInput"
            type="text"
            inputmode="email"
            autocomplete="email"
            :placeholder="t('settings.system.requests.alerts.emailPlaceholder')"
            class="input-field min-w-0 flex-1"
          />
          <div class="flex gap-2">
            <Button size="sm" @click="handleSaveEmails">{{ t('settings.system.requests.alerts.saveEmails') }}</Button>
            <Button
              v-if="settings.emailTo.length > 0"
              size="sm"
              variant="outline"
              :disabled="testing !== null || !settings.emailProviderReady"
              @click="handleTestEmail"
            >
              <Loader2 v-if="testing === 'email'" class="size-3.5 animate-spin" />
              {{ t('settings.system.requests.alerts.sendTest') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <span class="settings-card-title">{{ t('settings.system.requests.alerts.optionsTitle') }}</span>
      </div>
      <SettingsRow :label="t('settings.system.requests.alerts.includeAdmins')" :hint="t('settings.system.requests.alerts.includeAdminsHint')">
        <ToggleSwitch
          :model-value="settings.includeAdminRequests"
          :aria-label="t('settings.system.requests.alerts.includeAdmins')"
          @update:model-value="handleIncludeAdminsToggle"
        />
      </SettingsRow>
    </div>

    <p class="settings-hint settings-prose">{{ t('settings.system.requests.alerts.noLink') }}</p>
  </section>
</template>
