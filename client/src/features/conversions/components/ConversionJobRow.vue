<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, RotateCcw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { ConversionJob } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber } from '@/i18n/formatters'
import { durationParts, lengthParts, tookSeconds } from '../lib/conversion-time'

const props = defineProps<{ job: ConversionJob; retrying: boolean; retryDisabled: boolean }>()
const emit = defineEmits<{ retry: [ConversionJob] }>()

const { t } = useI18n()

const STATUS_CLASSES: Record<ConversionJob['status'], string> = {
  queued: 'bg-muted text-muted-foreground',
  converting: 'bg-primary/15 text-primary',
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  waiting: 'bg-warning/15 text-warning',
  skipped: 'bg-muted text-muted-foreground',
}

function spokenDuration(seconds: number): string {
  const parts = durationParts(seconds)
  if (parts.kind === 'underMinute') return t('conversions.time.underMinute')
  if (parts.kind === 'minutes') return t('conversions.time.minutes', { minutes: formatNumber(parts.minutes) })
  return t('conversions.time.hours', { hours: formatNumber(parts.hours), minutes: formatNumber(parts.minutes) })
}

function spokenLength(ms: number): string {
  const parts = lengthParts(ms)
  const values = { hours: formatNumber(parts.hours), minutes: formatNumber(parts.minutes), seconds: formatNumber(parts.seconds) }
  return parts.hours > 0 ? t('conversions.time.lengthHours', values) : t('conversions.time.lengthMinutes', values)
}

const statusLabel = computed(() =>
  props.job.status === 'converting' && props.job.phase ? t(`conversions.phase.${props.job.phase}`) : t(`conversions.status.${props.job.status}`),
)

const lengthCheck = computed(() =>
  props.job.status === 'done' && props.job.checkedDurationMs !== null
    ? t('conversions.lengthChecked', { length: spokenLength(props.job.checkedDurationMs) })
    : null,
)

const showProgress = computed(() => props.job.status === 'converting' && props.job.phase !== 'measuring' && props.job.progress !== null)

const speedLabel = computed(() => (props.job.speed ? t('conversions.time.speed', { speed: formatNumber(props.job.speed) }) : null))

const method = computed(() => {
  const job = props.job
  const kbps = job.bitrate ? formatNumber(Math.round(job.bitrate / 1000)) : null
  if (job.trackCount) {
    const tracks = formatNumber(job.trackCount)
    return job.method === 'encode' && kbps ? t('conversions.method.joinEncode', { tracks, kbps }) : t('conversions.method.joinCopy', { tracks })
  }
  if (job.method === 'encode' && kbps) return t('conversions.method.encode', { kbps })
  if (job.method) return t(`conversions.method.${job.method}`)
  return null
})

const timing = computed(() => {
  const job = props.job
  if (job.status === 'converting') {
    if (job.phase === 'measuring') return t('conversions.time.measuring')
    if (job.etaSeconds === null) return t('conversions.time.estimating')
    const left = t('conversions.time.left', { time: spokenDuration(job.etaSeconds) })
    return speedLabel.value ? `${left} · ${speedLabel.value}` : left
  }
  if (job.status === 'done') {
    const took = tookSeconds(job.startedAt, job.finishedAt)
    if (took === null) return null
    const label = t('conversions.time.took', { time: spokenDuration(took) })
    return speedLabel.value ? `${label} · ${speedLabel.value}` : label
  }
  return null
})

const reason = computed(() => (props.job.reason ? t(`conversions.reasons.${props.job.reason}`) : null))
const output = computed(() => (props.job.status === 'done' && props.job.outputName ? t('conversions.landed', { name: props.job.outputName }) : null))
const finished = computed(() => (props.job.finishedAt ? formatDateTime(new Date(props.job.finishedAt)) : null))
const progressLabel = computed(() => (props.job.progress !== null ? t('conversions.progress', { percent: formatNumber(props.job.progress) }) : null))

function handleRetry(): void {
  emit('retry', props.job)
}
</script>

<template>
  <li class="space-y-1.5 py-3" data-testid="conversion-job">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 space-y-0.5">
        <p class="text-sm font-medium text-foreground wrap-break-word">{{ job.name }}</p>
        <p v-if="method" class="text-xs text-muted-foreground">{{ method }}</p>
        <p v-if="timing" class="text-xs text-muted-foreground" data-testid="conversion-timing">{{ timing }}</p>
        <p v-if="lengthCheck" class="text-xs text-muted-foreground" data-testid="conversion-length-check">{{ lengthCheck }}</p>
        <p v-if="output" class="text-xs text-muted-foreground break-all">{{ output }}</p>
        <p v-if="reason" class="text-xs text-muted-foreground">{{ reason }}</p>
        <p v-if="job.detail" class="text-xs text-muted-foreground font-mono break-all">{{ job.detail }}</p>
        <p v-if="finished" class="text-xs text-muted-foreground">{{ finished }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS_CLASSES[job.status]" data-testid="conversion-status">
          {{ statusLabel }}
        </span>
        <Button
          v-if="job.status === 'failed'"
          variant="outline"
          size="sm"
          :disabled="retryDisabled"
          data-testid="conversion-retry"
          @click="handleRetry"
        >
          <Loader2 v-if="retrying" class="animate-spin" aria-hidden="true" />
          <RotateCcw v-else aria-hidden="true" />
          {{ t('conversions.retry') }}
        </Button>
      </div>
    </div>
    <div v-if="showProgress" class="flex items-center gap-2">
      <div
        class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        :aria-valuenow="job.progress ?? 0"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="job.name"
      >
        <div class="h-full rounded-full bg-primary transition-[width] duration-500" :style="{ width: `${job.progress}%` }" />
      </div>
      <span class="w-10 text-end text-xs tabular-nums text-muted-foreground">{{ progressLabel }}</span>
    </div>
  </li>
</template>
