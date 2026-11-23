<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ListChecks, Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { LibraryScanChange, LibraryScanChangeType } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatNumber } from '@/i18n/formatters'
import { useScanChanges } from '../composables/useScanChanges'

const props = defineProps<{ libraryId: number; libraryName: string; jobId: number }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const changes = useScanChanges(props.libraryId, props.jobId)
const { items, total, truncated, loading, failed, type, hasMore } = changes

const FILTERS: Array<LibraryScanChangeType | null> = [null, 'added', 'updated', 'missing', 'restored']

const TYPE_STYLES: Record<LibraryScanChangeType, string> = {
  added: 'text-[var(--pill-success)]',
  updated: 'text-muted-foreground',
  missing: 'text-[var(--pill-warning)]',
  restored: 'text-primary',
}

onMounted(() => {
  void changes.load()
})

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

function filterLabel(filter: LibraryScanChangeType | null): string {
  return filter === null ? t('settings.admin.libraries.changes.filterAll') : t(`settings.admin.libraries.changes.type.${filter}`)
}

function selectFilter(filter: LibraryScanChangeType | null) {
  void changes.setType(filter)
}

function handleFilterClick(event: Event) {
  const value = (event.currentTarget as HTMLElement).dataset.filter ?? ''
  selectFilter(value === '' ? null : (value as LibraryScanChangeType))
}

function handleClose() {
  emit('close')
}

function handleLoadMore() {
  void changes.loadMore()
}

function bookTitle(change: LibraryScanChange): string {
  if (change.title) return change.title
  const folder = change.folderPath?.split(/[\\/]/).filter(Boolean).pop()
  return folder ?? t('settings.admin.libraries.changes.untitled')
}

function valueLabel(value: string | null): string {
  return value === null || value === '' ? t('settings.admin.libraries.changes.empty') : value
}

function timeLabel(change: LibraryScanChange): string {
  return t(`settings.admin.libraries.changes.time.${change.changeType}`, { time: formatDateTime(new Date(change.occurredAt)) })
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <ListChecks class="size-5 text-primary" aria-hidden="true" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground">{{ t('settings.admin.libraries.changes.title') }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              {{ t('settings.admin.libraries.changes.description', { name: libraryName }) }}
            </DialogDescription>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-1.5" role="group" :aria-label="t('settings.admin.libraries.changes.filterLabel')">
          <Button
            v-for="filter in FILTERS"
            :key="filter ?? 'all'"
            type="button"
            size="sm"
            :variant="type === filter ? 'default' : 'outline'"
            :aria-pressed="type === filter"
            :data-filter="filter ?? ''"
            @click="handleFilterClick"
          >
            {{ filterLabel(filter) }}
          </Button>
        </div>

        <p v-if="truncated" class="mt-3 text-xs text-[var(--pill-warning)]">
          {{ t('settings.admin.libraries.changes.truncated') }}
        </p>

        <div class="mt-4 min-h-0 flex-1 overflow-y-auto pe-1">
          <div v-if="loading && items.length === 0" class="space-y-2" aria-hidden="true">
            <Skeleton v-for="index in 4" :key="index" class="h-16 w-full" />
          </div>
          <p v-else-if="failed" role="alert" class="text-sm text-destructive">{{ t('settings.admin.libraries.changes.failed') }}</p>
          <p v-else-if="items.length === 0" class="py-6 text-center text-sm text-muted-foreground">
            {{ t('settings.admin.libraries.changes.none') }}
          </p>
          <ul v-else class="space-y-2">
            <li v-for="change in items" :key="change.id" class="rounded-md border border-border p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">{{ bookTitle(change) }}</p>
                  <p v-if="change.authors" class="truncate text-xs text-muted-foreground">{{ change.authors }}</p>
                </div>
                <span class="shrink-0 text-xs font-semibold uppercase tracking-wide" :class="TYPE_STYLES[change.changeType]">
                  {{ t(`settings.admin.libraries.changes.type.${change.changeType}`) }}
                </span>
              </div>
              <p class="mt-1 text-[11px] text-muted-foreground">{{ timeLabel(change) }}</p>
              <p v-if="change.folderPath" class="mt-0.5 break-all font-mono text-[11px] text-muted-foreground" dir="ltr">{{ change.folderPath }}</p>
              <ul v-if="change.fieldChanges.length > 0" class="mt-2 space-y-1.5 border-t border-border pt-2">
                <li v-for="(field, index) in change.fieldChanges" :key="index" class="text-xs">
                  <span class="font-medium text-foreground">{{ field.field }}</span>
                  <span class="mt-0.5 flex flex-wrap items-start gap-1.5">
                    <span class="break-words text-muted-foreground line-through decoration-muted-foreground/40">{{ valueLabel(field.old) }}</span>
                    <ArrowRight class="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span class="break-words text-foreground">{{ valueLabel(field.new) }}</span>
                  </span>
                </li>
              </ul>
            </li>
          </ul>
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <p class="text-xs text-muted-foreground">
            {{ t('settings.admin.libraries.changes.shown', { shown: formatNumber(items.length), total: formatNumber(total) }) }}
          </p>
          <div class="flex items-center gap-2">
            <Button v-if="hasMore" type="button" variant="outline" size="sm" :disabled="loading" @click="handleLoadMore">
              <Loader2 v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
              {{ t('settings.admin.libraries.changes.loadMore') }}
            </Button>
            <Button type="button" size="sm" @click="handleClose">{{ t('settings.admin.libraries.changes.close') }}</Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
