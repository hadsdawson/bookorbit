<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { CONVERSION_CONCURRENCY_MAX, CONVERSION_CONCURRENCY_MIN, type ConversionSettings } from '@bookorbit/types'

import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { errorMessage } from '@/lib/api-json'
import { getConversions, saveConversionSettings } from '../api/conversions'
import { useConversionStatus } from '../composables/useConversionStatus'

const { t } = useI18n()
const { setEnabled } = useConversionStatus()
const settings = ref<ConversionSettings | null>(null)
const convertPath = ref('')
const saving = ref(false)
const concurrencyChoices = Array.from(
  { length: CONVERSION_CONCURRENCY_MAX - CONVERSION_CONCURRENCY_MIN + 1 },
  (_, index) => CONVERSION_CONCURRENCY_MIN + index,
)

async function load(): Promise<void> {
  try {
    const overview = await getConversions()
    settings.value = overview.settings
    convertPath.value = overview.convertPath
  } catch (error) {
    toast.error(errorMessage(error, 'conversions.errors.load'))
  }
}

async function save(next: ConversionSettings): Promise<void> {
  saving.value = true
  try {
    settings.value = await saveConversionSettings(next)
    setEnabled(settings.value.enabled)
  } catch (error) {
    toast.error(errorMessage(error, 'conversions.errors.save'))
  } finally {
    saving.value = false
  }
}

function handleEnabledChange(enabled: boolean): void {
  if (settings.value) void save({ ...settings.value, enabled })
}

function handleConcurrencyChange(event: Event): void {
  const concurrency = Number((event.target as HTMLSelectElement).value)
  if (settings.value) void save({ ...settings.value, concurrency })
}

onMounted(load)
</script>

<template>
  <section v-if="settings" aria-labelledby="conversion-settings-heading" class="space-y-2">
    <h2 id="conversion-settings-heading" class="settings-group-label">
      {{ t('conversions.settings.title') }}
    </h2>
    <div class="settings-card">
      <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
        <div class="min-w-0">
          <p class="settings-label">{{ t('conversions.settings.enabled') }}</p>
          <p class="settings-hint">{{ t(settings.enabled ? 'conversions.settings.enabledHint' : 'conversions.settings.disabledHint') }}</p>
        </div>
        <ToggleSwitch
          :model-value="settings.enabled"
          :disabled="saving"
          class="self-start md:self-auto md:ml-4"
          data-testid="conversion-enabled"
          @update:model-value="handleEnabledChange"
        />
      </div>

      <template v-if="settings.enabled">
        <div class="flex flex-col gap-3 border-t border-border/60 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">{{ t('conversions.settings.concurrency') }}</p>
            <p class="settings-hint">{{ t('conversions.settings.concurrencyHint') }}</p>
          </div>
          <select
            class="select-field w-40 shrink-0 md:ml-4"
            :aria-label="t('conversions.settings.concurrency')"
            :value="settings.concurrency"
            :disabled="saving"
            data-testid="conversion-concurrency"
            @change="handleConcurrencyChange"
          >
            <option v-for="count in concurrencyChoices" :key="count" :value="count">
              {{ t('conversions.settings.concurrencyOption', { count }) }}
            </option>
          </select>
        </div>

        <div class="border-t border-border/60 px-4 py-3.5 bg-card md:px-5 md:py-4">
          <p class="settings-label">{{ t('conversions.settings.folder') }}</p>
          <p class="settings-hint mb-2">{{ t('conversions.settings.folderHint') }}</p>
          <code
            data-testid="conversion-path"
            class="block mt-1 px-3 py-2 rounded-md bg-muted text-foreground text-xs font-mono break-all select-all"
            >{{ convertPath }}</code
          >
          <p class="settings-hint mt-2">
            {{ t('conversions.settings.changePathPrefix') }}
            <code class="text-xs font-mono">CONVERT_PATH</code>
            {{ t('conversions.settings.changePathSuffix') }}
          </p>
        </div>
      </template>
    </div>
  </section>
</template>
