<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { Loader2, RefreshCw, Square } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { COMMUNITY_RATINGS_REFRESH_SCHEDULES, type CommunityRatingsRefreshSchedule, type CommunityRatingsRefreshStatus } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber } from '@/i18n/formatters'
import {
  cancelCommunityRatingsRefresh,
  getCommunityRatingsRefreshStatus,
  setCommunityRatingsRefreshSchedule,
  startCommunityRatingsRefresh,
} from '../../api/community-ratings'

const POLL_MS = 3_000

const { t } = useI18n()
const status = ref<CommunityRatingsRefreshStatus | null>(null)
const loading = ref(true)
const busy = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let visible = false

const schedules = COMMUNITY_RATINGS_REFRESH_SCHEDULES
const running = computed(() => status.value?.running ?? false)
const run = computed(() => status.value?.run ?? null)
const progressStyle = computed(() => {
  const total = run.value?.total ?? 0
  const percent = total > 0 ? Math.min(100, Math.round(((run.value?.processed ?? 0) / total) * 100)) : 0
  return { width: `${percent}%` }
})
const lastRunLabel = computed(() => {
  const last = run.value
  if (!last?.finishedAt) return null
  return t(last.cancelled ? 'tools.communityRatings.lastRunStopped' : 'tools.communityRatings.lastRun', {
    at: formatDateTime(new Date(last.finishedAt)),
    processed: formatNumber(last.processed),
    updated: formatNumber(last.updated),
    failed: formatNumber(last.failed),
  })
})
const nextRunLabel = computed(() => {
  const next = status.value?.nextScheduledAt
  return next ? t('tools.communityRatings.nextRun', { at: formatDateTime(new Date(next)) }) : null
})

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll(): void {
  stopPolling()
  if (visible && running.value) pollTimer = setTimeout(refresh, POLL_MS)
}

function apply(next: CommunityRatingsRefreshStatus): void {
  status.value = next
  schedulePoll()
}

async function refresh(): Promise<void> {
  try {
    apply(await getCommunityRatingsRefreshStatus())
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('tools.communityRatings.errors.load'))
  } finally {
    loading.value = false
  }
}

async function act(action: () => Promise<CommunityRatingsRefreshStatus>): Promise<void> {
  busy.value = true
  try {
    apply(await action())
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('tools.communityRatings.errors.save'))
  } finally {
    busy.value = false
  }
}

function handleScheduleChange(event: Event): void {
  const schedule = (event.target as HTMLSelectElement).value as CommunityRatingsRefreshSchedule
  void act(() => setCommunityRatingsRefreshSchedule(schedule))
}

function handleRun(): void {
  void act(startCommunityRatingsRefresh)
}

function handleStop(): void {
  void act(cancelCommunityRatingsRefresh)
}

function show(): void {
  visible = true
  void refresh()
}

function hide(): void {
  visible = false
  stopPolling()
}

onMounted(show)
onActivated(show)
onDeactivated(hide)
onBeforeUnmount(hide)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-3xl space-y-4">
      <header class="space-y-1">
        <h1 class="text-base font-semibold text-foreground">{{ t('tools.communityRatings.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('tools.communityRatings.description') }}</p>
      </header>

      <p v-if="loading" class="text-sm text-muted-foreground" role="status">{{ t('common.loading') }}</p>

      <template v-else-if="status">
        <section class="rounded-lg border border-border/70 bg-card/50 p-4" data-testid="community-ratings-run">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 space-y-1">
              <h2 class="text-sm font-semibold text-foreground">{{ t('tools.communityRatings.runTitle') }}</h2>
              <p class="text-sm text-muted-foreground">
                {{ t('tools.communityRatings.bookCount', { count: status.booksWithRatings }) }}
              </p>
            </div>
            <Button
              v-if="running"
              variant="outline"
              size="sm"
              class="shrink-0"
              :disabled="busy"
              data-testid="community-ratings-stop"
              @click="handleStop"
            >
              <Square aria-hidden="true" />
              {{ t('tools.communityRatings.stop') }}
            </Button>
            <Button
              v-else
              variant="outline"
              size="sm"
              class="shrink-0"
              :disabled="busy || status.booksWithRatings === 0"
              data-testid="community-ratings-start"
              @click="handleRun"
            >
              <Loader2 v-if="busy" class="animate-spin" aria-hidden="true" />
              <RefreshCw v-else aria-hidden="true" />
              {{ t('tools.communityRatings.run') }}
            </Button>
          </div>

          <div v-if="running && run" class="mt-3 space-y-1.5" role="status" aria-live="polite">
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary transition-[width] duration-300" :style="progressStyle" />
            </div>
            <p class="text-xs text-muted-foreground">
              {{
                t('tools.communityRatings.progress', {
                  processed: formatNumber(run.processed),
                  total: formatNumber(run.total),
                  updated: formatNumber(run.updated),
                })
              }}
            </p>
            <p class="text-xs text-muted-foreground">{{ t('tools.communityRatings.slowNote') }}</p>
          </div>
          <p v-else-if="lastRunLabel" class="mt-3 text-xs text-muted-foreground" data-testid="community-ratings-last-run">{{ lastRunLabel }}</p>
        </section>

        <section class="rounded-lg border border-border/70 bg-card/50 p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0 space-y-1">
              <h2 class="text-sm font-semibold text-foreground">{{ t('tools.communityRatings.scheduleTitle') }}</h2>
              <p class="text-sm text-muted-foreground">{{ t('tools.communityRatings.scheduleHint') }}</p>
              <p v-if="nextRunLabel" class="text-xs text-muted-foreground">{{ nextRunLabel }}</p>
            </div>
            <select
              class="select-field w-36 shrink-0"
              :aria-label="t('tools.communityRatings.scheduleTitle')"
              :value="status.schedule"
              :disabled="busy"
              data-testid="community-ratings-schedule"
              @change="handleScheduleChange"
            >
              <option v-for="schedule in schedules" :key="schedule" :value="schedule">
                {{ t(`tools.communityRatings.schedules.${schedule}`) }}
              </option>
            </select>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
