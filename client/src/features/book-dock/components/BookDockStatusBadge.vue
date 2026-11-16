<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Loader2 } from '@lucide/vue'
import type { BookDockFileStatus, BookDockProcessing } from '@bookorbit/types'

import { formatNumber } from '@/i18n/formatters'
import { SLOW_STEP_MS, minutesSince, useProcessingClock } from '../lib/processing-time'

const props = defineProps<{
  status: BookDockFileStatus
  /** Fork: where an unfinished file stands in line; older servers leave it out. */
  processing?: BookDockProcessing | null
  /** Fork: when the file last changed, which for an unfinished file is when its current step began. */
  since?: string
}>()

const { t } = useI18n()
const now = useProcessingClock()

const styles: Record<BookDockFileStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  extracting: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  fetching: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  ready: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  error: 'bg-red-500/15 text-red-600 dark:text-red-400',
}
const STUCK_STYLE = 'bg-red-500/15 text-red-600 dark:text-red-400'
const SLOW_STYLE = 'bg-amber-500/15 text-amber-600 dark:text-amber-400'

const labels = computed<Record<BookDockFileStatus, string>>(() => ({
  pending: t('bookDock.status.pending'),
  extracting: t('bookDock.status.extracting'),
  fetching: t('bookDock.status.fetching'),
  ready: t('bookDock.status.ready'),
  error: t('bookDock.status.error'),
}))

const minutes = computed(() => (props.since ? minutesSince(props.since, now.value) : 0))
const slow = computed(() => props.processing === 'running' && minutes.value * 60_000 >= SLOW_STEP_MS)
const elapsed = computed(() =>
  minutes.value < 1 ? t('bookDock.processing.underAMinute') : t('bookDock.processing.minutes', { minutes: formatNumber(minutes.value) }),
)

const view = computed(() => {
  if (props.processing === 'stuck') {
    return { label: t('bookDock.processing.stuck'), style: STUCK_STYLE, spin: false, warn: true, hint: t('bookDock.processing.stuckHint') }
  }
  if (props.processing === 'waiting') {
    return { label: t('bookDock.processing.waiting'), style: styles.pending, spin: false, warn: false, hint: null }
  }
  if (props.processing === 'running') {
    const step = props.status === 'fetching' ? t('bookDock.processing.lookingUp') : t('bookDock.processing.reading')
    return {
      label: t('bookDock.processing.step', { step, elapsed: elapsed.value }),
      style: slow.value ? SLOW_STYLE : styles[props.status],
      spin: !slow.value,
      warn: slow.value,
      hint: slow.value ? t('bookDock.processing.slowHint') : null,
    }
  }
  return {
    label: labels.value[props.status],
    style: styles[props.status],
    spin: props.status === 'extracting' || props.status === 'fetching',
    warn: false,
    hint: null,
  }
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
    :class="view.style"
    :title="view.hint ?? undefined"
    data-testid="book-dock-status"
  >
    <Loader2 v-if="view.spin" class="size-2.5 animate-spin" />
    <AlertTriangle v-else-if="view.warn" class="size-2.5" aria-hidden="true" />
    {{ view.label }}
  </span>
</template>
