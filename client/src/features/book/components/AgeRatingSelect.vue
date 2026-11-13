<script setup lang="ts">
import { AGE_RATINGS, isAgeRating, type AgeRating } from '@bookorbit/types'
import { useI18n } from 'vue-i18n'

import { AGE_RATING_LABEL_KEYS } from '@/lib/age-rating'

defineProps<{ modelValue: AgeRating | null; disabled?: boolean; selectClass?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: AgeRating | null] }>()

const { t } = useI18n()
const NOT_RATED_OPTION = ''

function handleChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  const value = raw === NOT_RATED_OPTION ? null : Number(raw)
  emit('update:modelValue', isAgeRating(value) ? value : null)
}
</script>

<template>
  <select
    :value="modelValue === null ? NOT_RATED_OPTION : String(modelValue)"
    :disabled="disabled"
    :class="selectClass"
    data-testid="age-rating-select"
    @change="handleChange"
  >
    <option :value="NOT_RATED_OPTION">{{ t('ageRating.notRated') }}</option>
    <option v-for="rating in AGE_RATINGS" :key="rating" :value="String(rating)">{{ t(AGE_RATING_LABEL_KEYS[rating]) }}</option>
  </select>
</template>
