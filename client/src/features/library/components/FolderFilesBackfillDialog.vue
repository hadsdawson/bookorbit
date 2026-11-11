<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { describeEstimate, useFolderFilesBackfill } from '../composables/useFolderFilesBackfill'

const props = defineProps<{ libraryId: number; libraryName: string }>()
const emit = defineEmits<{ close: []; finished: [written: number] }>()

const { t } = useI18n()
const backfill = useFolderFilesBackfill(props.libraryId)
const { estimate, status, loading, error } = backfill

const timeText = computed(() => {
  if (!estimate.value) return ''
  const range = describeEstimate(estimate.value.estimatedSeconds)
  return t(`library.folderFilesBackfill.time.${range.key}`, { low: formatNumber(range.low), high: formatNumber(range.high) })
})
const started = computed(() => status.value !== null)
const running = computed(() => status.value?.running === true)
const finished = computed(() => status.value !== null && !status.value.running)

onMounted(async () => {
  await backfill.loadEstimate()
  if (estimate.value && estimate.value.books === 0) emit('close')
})

watch(finished, (done) => {
  if (done && status.value) emit('finished', status.value.written)
})

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

function handleForwardOnly() {
  emit('close')
}

function handleWriteAll() {
  void backfill.start()
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <FolderOpen class="size-5 text-primary" aria-hidden="true" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground">{{ t('library.folderFilesBackfill.title') }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              <template v-if="estimate">
                {{ t('library.folderFilesBackfill.body', { name: libraryName, count: estimate.books }) }}
              </template>
              <template v-else>{{ t('library.folderFilesBackfill.loading') }}</template>
            </DialogDescription>
          </div>
        </div>

        <div v-if="loading" class="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('library.folderFilesBackfill.loading') }}
        </div>

        <template v-else-if="estimate && !started">
          <ul class="mt-5 list-disc space-y-2 ps-5 text-sm text-foreground">
            <li>
              <span class="font-medium">{{ t('library.folderFilesBackfill.timeLabel') }}</span>
              {{ timeText }} {{ t('library.folderFilesBackfill.background') }}
            </li>
            <li>{{ t('library.folderFilesBackfill.replaces') }}</li>
            <li v-if="estimate.sharedFolderBooks > 0">
              {{ t('library.folderFilesBackfill.shared', { count: estimate.sharedFolderBooks }) }}
            </li>
            <li>{{ t('library.folderFilesBackfill.otherApps') }}</li>
            <li>{{ t('library.folderFilesBackfill.readOnly') }}</li>
            <li>{{ t('library.folderFilesBackfill.later') }}</li>
          </ul>
        </template>

        <div v-else-if="started && status" class="mt-5 text-sm text-foreground" role="status" aria-live="polite">
          <p v-if="running" class="flex items-center gap-2">
            <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ t('library.folderFilesBackfill.progress', { done: formatNumber(status.processed), total: formatNumber(status.total) }) }}
          </p>
          <p v-else>
            {{
              t('library.folderFilesBackfill.done', {
                written: formatNumber(status.written),
                unchanged: formatNumber(status.unchanged),
                skipped: formatNumber(status.skipped + status.failed),
              })
            }}
          </p>
          <p v-if="running" class="mt-2 text-xs text-muted-foreground">{{ t('library.folderFilesBackfill.closeAnytime') }}</p>
        </div>

        <p v-if="error" class="mt-4 text-sm text-destructive">{{ t('library.folderFilesBackfill.error') }}</p>

        <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <template v-if="!started">
            <Button variant="outline" :disabled="loading" @click="handleForwardOnly">{{ t('library.folderFilesBackfill.forwardOnly') }}</Button>
            <Button :disabled="loading || !estimate" @click="handleWriteAll">{{ t('library.folderFilesBackfill.writeAll') }}</Button>
          </template>
          <Button v-else @click="handleClose">{{ t('common.close') }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
