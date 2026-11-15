<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  NEW_RELEASE_DELIVERIES,
  NEW_RELEASE_FORMATS,
  Permission,
  REQUEST_LANGUAGE_CODES,
  type NewReleaseDelivery,
  type NewReleaseFormat,
  type NewReleasesServerSettings,
} from '@bookorbit/types'

import { usePermissions } from '@/features/auth/composables/usePermissions'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsRow from '@/features/settings/components/SettingsRow.vue'
import { errorMessage } from '@/lib/api-json'
import { getNewReleasesServerSettings, saveNewReleasesServerSettings } from '../api/new-releases'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const allowed = computed(() => hasPermission(Permission.ManageBookRequests))
const settings = ref<NewReleasesServerSettings | null>(null)
const saving = ref(false)

async function save(next: NewReleasesServerSettings) {
  saving.value = true
  try {
    settings.value = await saveNewReleasesServerSettings(next)
    toast.success(t('newReleases.server.saved'))
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.saveSettings'))
  } finally {
    saving.value = false
  }
}

function handleFormatChange(event: Event) {
  if (!settings.value) return
  void save({ ...settings.value, defaultFormat: (event.target as HTMLSelectElement).value as NewReleaseFormat })
}

// Fork: which language listed books must be in; "any" lists every language.
const languageOptions = computed(() => {
  const names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' })
  return REQUEST_LANGUAGE_CODES.map((code) => ({ code, label: names.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label))
})

function handleLanguageChange(event: Event) {
  if (!settings.value) return
  void save({ ...settings.value, language: (event.target as HTMLSelectElement).value })
}

function handleLanguageStrictChange(value: boolean) {
  if (!settings.value) return
  void save({ ...settings.value, languageStrict: value })
}

function handleDeliveryChange(event: Event) {
  if (!settings.value) return
  void save({ ...settings.value, defaultDelivery: (event.target as HTMLSelectElement).value as NewReleaseDelivery })
}

onMounted(async () => {
  if (!allowed.value) return
  try {
    settings.value = await getNewReleasesServerSettings()
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.loadServerSettings'))
  }
})
</script>

<template>
  <div v-if="allowed && settings" class="settings-card" data-testid="new-releases-server-settings">
    <div class="settings-card-header">
      <span class="settings-card-title">{{ t('newReleases.server.title') }}</span>
    </div>
    <p class="settings-hint settings-prose bg-card px-4 py-3 md:px-5">{{ t('newReleases.server.hint') }}</p>

    <SettingsRow :label="t('newReleases.server.format')" :hint="t('newReleases.server.formatHint')" control-id="new-releases-default-format">
      <select
        id="new-releases-default-format"
        :value="settings.defaultFormat"
        :disabled="saving"
        class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        @change="handleFormatChange"
      >
        <option v-for="format in NEW_RELEASE_FORMATS" :key="format" :value="format">{{ t(`newReleases.server.formats.${format}`) }}</option>
      </select>
    </SettingsRow>

    <SettingsRow :label="t('newReleases.server.delivery')" :hint="t('newReleases.server.deliveryHint')" control-id="new-releases-default-delivery">
      <select
        id="new-releases-default-delivery"
        :value="settings.defaultDelivery"
        :disabled="saving"
        class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        @change="handleDeliveryChange"
      >
        <option v-for="delivery in NEW_RELEASE_DELIVERIES" :key="delivery" :value="delivery">{{ t(`newReleases.delivery.${delivery}`) }}</option>
      </select>
    </SettingsRow>

    <SettingsRow :label="t('newReleases.server.language')" :hint="t('newReleases.server.languageHint')" control-id="new-releases-language">
      <select
        id="new-releases-language"
        :value="settings.language"
        :disabled="saving"
        class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        @change="handleLanguageChange"
      >
        <option value="any">{{ t('newReleases.server.anyLanguage') }}</option>
        <option v-for="option in languageOptions" :key="option.code" :value="option.code">{{ option.label }}</option>
      </select>
    </SettingsRow>

    <SettingsRow
      v-if="settings.language !== 'any'"
      :label="t('newReleases.server.languageStrict')"
      :hint="t('newReleases.server.languageStrictHint')"
      control-id="new-releases-language-strict"
    >
      <ToggleSwitch
        id="new-releases-language-strict"
        :model-value="settings.languageStrict"
        :disabled="saving"
        @update:model-value="handleLanguageStrictChange"
      />
    </SettingsRow>
  </div>
</template>
