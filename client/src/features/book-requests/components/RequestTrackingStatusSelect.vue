<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BOOK_REQUEST_TRACKING_STATUSES } from '@bookorbit/types'
import type { BookRequestItem, BookRequestTrackingStatus } from '@bookorbit/types'

/**
 * The hand-set tracking status on one request. A select when the viewer may change it, plain text
 * otherwise, so somebody watching a request they cannot drive still sees why it is waiting.
 */
const props = defineProps<{
  request: BookRequestItem
  editable: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  change: [request: BookRequestItem, trackingStatus: BookRequestTrackingStatus | null]
}>()

const { t } = useI18n()

const TONES: Record<BookRequestTrackingStatus, string> = {
  format_not_available: 'text-amber-600 dark:text-amber-400',
  not_yet_released: 'text-sky-600 dark:text-sky-400',
  missing: 'text-rose-600 dark:text-rose-400',
}

const tone = computed(() => (props.request.trackingStatus ? TONES[props.request.trackingStatus] : 'text-muted-foreground'))

const label = computed(() => t(`bookRequests.trackingStatus.${props.request.trackingStatus ?? 'none'}`))
const mediaLabel = computed(() => t(`bookRequests.mediaKind.${props.request.mediaKind}`))

function handleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('change', props.request, value === '' ? null : (value as BookRequestTrackingStatus))
}
</script>

<template>
  <select
    v-if="editable"
    :value="request.trackingStatus ?? ''"
    :disabled="busy"
    :aria-label="t('bookRequests.table.trackingLabel', { title: `${request.title} (${mediaLabel})` })"
    class="h-7 w-full max-w-52 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
    :class="tone"
    @change="handleChange"
  >
    <option value="">{{ t('bookRequests.trackingStatus.none') }}</option>
    <option v-for="status in BOOK_REQUEST_TRACKING_STATUSES" :key="status" :value="status">
      {{ t(`bookRequests.trackingStatus.${status}`) }}
    </option>
  </select>
  <span v-else class="text-xs" :class="tone">{{ request.trackingStatus ? label : '-' }}</span>
</template>
