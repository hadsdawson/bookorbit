<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AGE_RATING_FILTER_VALUES, type AgeRatingFilterValue } from '@bookorbit/types'

import { AGE_RATING_LABEL_KEYS } from '@/lib/age-rating'

defineProps<{ label: string; hint: string; testId: string }>()
const values = defineModel<AgeRatingFilterValue[]>({ required: true })

const { t } = useI18n()

function isOn(rating: AgeRatingFilterValue): boolean {
  return values.value.includes(rating)
}

function toggle(rating: AgeRatingFilterValue): void {
  values.value = isOn(rating) ? values.value.filter((value) => value !== rating) : [...values.value, rating]
}
</script>

<template>
  <div class="space-y-1.5" role="group" :aria-label="label" :data-testid="testId">
    <p class="settings-label block text-xs">{{ label }}</p>
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="rating in AGE_RATING_FILTER_VALUES"
        :key="rating"
        type="button"
        class="h-7 rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :class="isOn(rating) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'"
        :aria-pressed="isOn(rating)"
        :data-rating="rating"
        @click="toggle(rating)"
      >
        {{ t(AGE_RATING_LABEL_KEYS[rating]) }}
      </button>
    </div>
    <p class="settings-hint">{{ hint }}</p>
  </div>
</template>
