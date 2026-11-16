<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import { FileAudio, FolderUp, Loader2, RotateCcw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Permission, type ConversionJob, type ConversionOverview } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatDateTime, formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import { getConversions, retryConversion } from '../api/conversions'
import { useConversionStatus } from '../composables/useConversionStatus'
import { CONVERTIBLE_ACCEPT, pickedFiles, useConversionUpload, type UploadFailure } from '../composables/useConversionUpload'

const BUSY_POLL_MS = 2_000
const IDLE_POLL_MS = 10_000

const STATUS_CLASSES: Record<ConversionJob['status'], string> = {
  queued: 'bg-muted text-muted-foreground',
  converting: 'bg-primary/15 text-primary',
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  waiting: 'bg-warning/15 text-warning',
  skipped: 'bg-muted text-muted-foreground',
}

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { setEnabled } = useConversionStatus()
const { uploading, percent: uploadPercent, fileIndex, fileCount, upload } = useConversionUpload()
const canUpload = computed(() => hasPermission(Permission.BookDockAccess) && hasPermission(Permission.LibraryUpload))
const filesInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const overview = ref<ConversionOverview | null>(null)
const loading = ref(true)
const retrying = ref<string | null>(null)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let active = false

const enabled = computed(() => overview.value?.settings.enabled ?? false)
const canManage = computed(() => hasPermission(Permission.ManageBookDock))
const jobs = computed(() => overview.value?.jobs ?? [])
const busy = computed(() => jobs.value.some((job) => job.status === 'queued' || job.status === 'converting'))
const rows = computed(() =>
  jobs.value.map((job) => ({
    job,
    statusLabel: t(`conversions.status.${job.status}`),
    statusClass: STATUS_CLASSES[job.status],
    method: methodLabel(job),
    reason: job.reason ? t(`conversions.reasons.${job.reason}`) : null,
    output: job.status === 'done' && job.outputName ? t('conversions.landed', { name: job.outputName }) : null,
    finished: job.finishedAt ? formatDateTime(new Date(job.finishedAt)) : null,
    progressLabel: job.progress !== null ? t('conversions.progress', { percent: formatNumber(job.progress) }) : null,
  })),
)

function methodLabel(job: ConversionJob): string | null {
  const kbps = job.bitrate ? formatNumber(Math.round(job.bitrate / 1000)) : null
  if (job.trackCount) {
    const tracks = formatNumber(job.trackCount)
    return job.method === 'encode' && kbps ? t('conversions.method.joinEncode', { tracks, kbps }) : t('conversions.method.joinCopy', { tracks })
  }
  if (job.method === 'encode' && kbps) return t('conversions.method.encode', { kbps })
  if (job.method) return t(`conversions.method.${job.method}`)
  return null
}

function uploadFailureMessage(failure: UploadFailure): string {
  if (failure.kind === 'tooLarge') return t('conversions.upload.tooLarge', { name: failure.name, limit: formatNumber(failure.limitMb) })
  return failure.name ? t('conversions.upload.failedFile', { name: failure.name }) : t('conversions.errors.upload')
}

async function handlePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = input.files ? pickedFiles(input.files) : []
  input.value = ''
  if (files.length === 0) return
  const failure = await upload(files)
  if (failure) {
    toast.error(uploadFailureMessage(failure))
    return
  }
  toast.success(t('conversions.upload.done', { count: files.length }))
  await refresh()
  schedule()
}

function handleChooseFiles(): void {
  filesInput.value?.click()
}

function handleChooseFolder(): void {
  folderInput.value?.click()
}

async function refresh(): Promise<void> {
  try {
    overview.value = await getConversions()
    setEnabled(overview.value.settings.enabled)
  } catch (error) {
    toast.error(errorMessage(error, 'conversions.errors.load'))
  } finally {
    loading.value = false
  }
}

function schedule(): void {
  if (pollTimer) clearTimeout(pollTimer)
  if (!active) return
  pollTimer = setTimeout(handlePoll, busy.value ? BUSY_POLL_MS : IDLE_POLL_MS)
}

async function handlePoll(): Promise<void> {
  await refresh()
  schedule()
}

async function handleRetry(job: ConversionJob): Promise<void> {
  retrying.value = job.id
  try {
    await retryConversion(job.id)
    await refresh()
    schedule()
  } catch (error) {
    toast.error(errorMessage(error, 'conversions.errors.retry'))
  } finally {
    retrying.value = null
  }
}

function handleShow(): void {
  if (active) return
  active = true
  void handlePoll()
}

function handleHide(): void {
  active = false
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

onMounted(handleShow)
onActivated(handleShow)
onDeactivated(handleHide)
onUnmounted(handleHide)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-3xl space-y-4">
      <header class="space-y-1">
        <h1 class="text-base font-semibold text-foreground">{{ t('conversions.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('conversions.description') }}</p>
      </header>

      <p v-if="loading" class="text-sm text-muted-foreground" role="status">{{ t('common.loading') }}</p>

      <section v-else-if="!enabled" class="rounded-lg border border-border/70 bg-card/50 p-4" data-testid="conversions-off">
        <p class="text-sm text-foreground">{{ t('conversions.off') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t(canManage ? 'conversions.offHintManage' : 'conversions.offHint') }}
          <RouterLink v-if="canManage" :to="{ name: 'settings-admin-book-dock' }" class="text-primary underline-offset-2 hover:underline">
            {{ t('conversions.openSettings') }}
          </RouterLink>
        </p>
      </section>

      <template v-else-if="overview">
        <section v-if="canUpload" class="rounded-lg border border-border/70 bg-card/50 p-4 space-y-3" data-testid="conversions-upload">
          <div class="space-y-1">
            <h2 class="text-sm font-semibold text-foreground">{{ t('conversions.upload.title') }}</h2>
            <p class="text-sm text-muted-foreground">{{ t('conversions.upload.hint') }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" :disabled="uploading" data-testid="conversions-upload-files" @click="handleChooseFiles">
              <FileAudio aria-hidden="true" />
              {{ t('conversions.upload.files') }}
            </Button>
            <Button variant="outline" size="sm" :disabled="uploading" data-testid="conversions-upload-folder" @click="handleChooseFolder">
              <FolderUp aria-hidden="true" />
              {{ t('conversions.upload.folder') }}
            </Button>
          </div>
          <input
            ref="filesInput"
            type="file"
            multiple
            :accept="CONVERTIBLE_ACCEPT"
            class="hidden"
            data-testid="conversions-files-input"
            @change="handlePicked"
          />
          <input ref="folderInput" type="file" webkitdirectory class="hidden" data-testid="conversions-folder-input" @change="handlePicked" />
          <div v-if="uploading" class="space-y-1" role="status">
            <p class="text-xs text-muted-foreground">
              {{
                t('conversions.upload.progress', {
                  current: formatNumber(fileIndex),
                  total: formatNumber(fileCount),
                  percent: formatNumber(uploadPercent),
                })
              }}
            </p>
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary transition-[width] duration-300" :style="{ width: `${uploadPercent}%` }" />
            </div>
          </div>
        </section>

        <section class="rounded-lg border border-border/70 bg-card/50 p-4 space-y-2">
          <h2 class="text-sm font-semibold text-foreground">{{ t('conversions.folderTitle') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('conversions.folderHint') }}</p>
          <code class="block px-3 py-2 rounded-md bg-muted text-foreground text-xs font-mono break-all select-all" data-testid="conversions-path">{{
            overview.convertPath
          }}</code>
        </section>

        <section class="rounded-lg border border-border/70 bg-card/50 p-4">
          <h2 class="text-sm font-semibold text-foreground">{{ t('conversions.listTitle') }}</h2>
          <p v-if="rows.length === 0" class="mt-3 text-sm text-muted-foreground" data-testid="conversions-none">{{ t('conversions.none') }}</p>

          <ul v-else class="mt-3 divide-y divide-border/70">
            <li v-for="row in rows" :key="row.job.id" class="space-y-1.5 py-3" data-testid="conversion-job">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0 space-y-0.5">
                  <p class="text-sm font-medium text-foreground wrap-break-word">{{ row.job.name }}</p>
                  <p v-if="row.method" class="text-xs text-muted-foreground">{{ row.method }}</p>
                  <p v-if="row.output" class="text-xs text-muted-foreground break-all">{{ row.output }}</p>
                  <p v-if="row.reason" class="text-xs text-muted-foreground">{{ row.reason }}</p>
                  <p v-if="row.job.detail" class="text-xs text-muted-foreground font-mono break-all">{{ row.job.detail }}</p>
                  <p v-if="row.finished" class="text-xs text-muted-foreground">{{ row.finished }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="row.statusClass" data-testid="conversion-status">
                    {{ row.statusLabel }}
                  </span>
                  <Button
                    v-if="row.job.status === 'failed'"
                    variant="outline"
                    size="sm"
                    :disabled="retrying !== null"
                    data-testid="conversion-retry"
                    @click="handleRetry(row.job)"
                  >
                    <Loader2 v-if="retrying === row.job.id" class="animate-spin" aria-hidden="true" />
                    <RotateCcw v-else aria-hidden="true" />
                    {{ t('conversions.retry') }}
                  </Button>
                </div>
              </div>
              <div v-if="row.job.status === 'converting' && row.job.progress !== null" class="flex items-center gap-2">
                <div
                  class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  :aria-valuenow="row.job.progress"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="row.job.name"
                >
                  <div class="h-full rounded-full bg-primary transition-[width] duration-500" :style="{ width: `${row.job.progress}%` }" />
                </div>
                <span class="w-10 text-end text-xs tabular-nums text-muted-foreground">{{ row.progressLabel }}</span>
              </div>
            </li>
          </ul>
        </section>

        <p class="text-xs text-muted-foreground">{{ t('conversions.footnote') }}</p>
      </template>
    </div>
  </div>
</template>
