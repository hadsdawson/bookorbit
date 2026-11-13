<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from '@lucide/vue'
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

/** The same pill tones as the State column, so the two read as one family. */
const TONES: Record<BookRequestTrackingStatus, string> = {
  format_not_available: 'border-warning/40 bg-warning/10 text-warning',
  not_yet_released: 'border-info/40 bg-info/10 text-info',
  missing: 'border-destructive/40 bg-destructive/10 text-destructive',
}

/** Unset is a dashed outline: an empty slot to fill rather than a status of its own. */
const UNSET_TONE = 'border-dashed border-border bg-transparent text-muted-foreground'

const tone = computed(() => (props.request.trackingStatus ? TONES[props.request.trackingStatus] : UNSET_TONE))

const INKS: Record<BookRequestTrackingStatus, string> = {
  format_not_available: 'text-warning',
  not_yet_released: 'text-info',
  missing: 'text-destructive',
}

const ink = computed(() => (props.request.trackingStatus ? INKS[props.request.trackingStatus] : 'text-muted-foreground'))

const label = computed(() => t(`bookRequests.trackingStatus.${props.request.trackingStatus ?? 'none'}`))
const mediaLabel = computed(() => t(`bookRequests.mediaKind.${props.request.mediaKind}`))

function handleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('change', props.request, value === '' ? null : (value as BookRequestTrackingStatus))
}
</script>

<template>
  <span v-if="editable" class="relative inline-flex max-w-full min-w-0 items-center">
    <span class="pointer-events-none absolute start-2 size-1.5 rounded-full bg-current" :class="ink" aria-hidden="true" />
    <select
      :value="request.trackingStatus ?? ''"
      :disabled="busy"
      :aria-label="t('bookRequests.table.trackingLabel', { title: `${request.title} (${mediaLabel})` })"
      class="field-sizing-content h-[22px] max-w-full min-w-0 cursor-pointer appearance-none truncate rounded-full border ps-5 pe-6 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:opacity-60"
      :class="tone"
      @change="handleChange"
    >
      <option value="" class="bg-popover text-popover-foreground">{{ t('bookRequests.trackingStatus.none') }}</option>
      <option v-for="status in BOOK_REQUEST_TRACKING_STATUSES" :key="status" :value="status" class="bg-popover text-popover-foreground">
        {{ t(`bookRequests.trackingStatus.${status}`) }}
      </option>
    </select>
    <ChevronDown :size="12" class="pointer-events-none absolute end-2" :class="ink" aria-hidden="true" />
  </span>
  <span
    v-else-if="request.trackingStatus"
    class="inline-flex h-[22px] max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap"
    :class="tone"
  >
    <span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    <span class="truncate">{{ label }}</span>
  </span>
  <span v-else class="text-xs text-muted-foreground">-</span>
</template>
