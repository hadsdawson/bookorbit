<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  CONVERSION_CONCURRENCY_MAX,
  CONVERSION_CONCURRENCY_MIN,
  CONVERSION_SPEEDS,
  type ConversionSettings,
  type ConversionSpeed,
} from '@bookorbit/types'

import { errorMessage } from '@/lib/api-json'
import { saveConversionSettings } from '../api/conversions'

const props = defineProps<{ settings: ConversionSettings }>()
const emit = defineEmits<{ saved: [ConversionSettings] }>()

const { t } = useI18n()
const saving = ref(false)
const concurrencyChoices = Array.from(
  { length: CONVERSION_CONCURRENCY_MAX - CONVERSION_CONCURRENCY_MIN + 1 },
  (_, index) => CONVERSION_CONCURRENCY_MIN + index,
)

async function save(next: ConversionSettings): Promise<void> {
  saving.value = true
  try {
    emit('saved', await saveConversionSettings(next))
  } catch (error) {
    toast.error(errorMessage(error, 'conversions.errors.save'))
  } finally {
    saving.value = false
  }
}

function handleSpeedChange(event: Event): void {
  void save({ ...props.settings, speed: (event.target as HTMLSelectElement).value as ConversionSpeed })
}

function handleConcurrencyChange(event: Event): void {
  void save({ ...props.settings, concurrency: Number((event.target as HTMLSelectElement).value) })
}
</script>

<template>
  <section class="space-y-4 rounded-lg border border-border/70 bg-card/50 p-4" data-testid="conversion-tuning">
    <h2 class="text-sm font-semibold text-foreground">{{ t('conversions.tuning.title') }}</h2>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-medium text-foreground">{{ t('conversions.tuning.speed') }}</p>
        <p class="text-sm text-muted-foreground">{{ t(`conversions.tuning.speedHint.${settings.speed}`) }}</p>
      </div>
      <select
        class="select-field w-40 shrink-0"
        :aria-label="t('conversions.tuning.speed')"
        :value="settings.speed"
        :disabled="saving"
        data-testid="conversion-speed"
        @change="handleSpeedChange"
      >
        <option v-for="speed in CONVERSION_SPEEDS" :key="speed" :value="speed">{{ t(`conversions.tuning.speedOption.${speed}`) }}</option>
      </select>
    </div>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-medium text-foreground">{{ t('conversions.tuning.concurrency') }}</p>
        <p class="text-sm text-muted-foreground">{{ t('conversions.tuning.concurrencyHint') }}</p>
      </div>
      <select
        class="select-field w-40 shrink-0"
        :aria-label="t('conversions.tuning.concurrency')"
        :value="settings.concurrency"
        :disabled="saving"
        data-testid="conversion-concurrency"
        @change="handleConcurrencyChange"
      >
        <option v-for="count in concurrencyChoices" :key="count" :value="count">
          {{ t('conversions.tuning.concurrencyOption', { count }) }}
        </option>
      </select>
    </div>
  </section>
</template>
