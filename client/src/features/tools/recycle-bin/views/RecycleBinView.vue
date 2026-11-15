<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  RECYCLE_BIN_KEEP_DAYS_MAX,
  RECYCLE_BIN_KEEP_DAYS_MIN,
  type RecycleBinEntry,
  type RecycleBinOverview,
  type RecycleBinSettings,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatDate, formatDateTime, formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { deleteRecycleBinEntry, emptyRecycleBin, getRecycleBin, restoreRecycleBinEntry, saveRecycleBinSettings } from '../../api/recycle-bin'

const PAGE_SIZE = 25
const KEEP_DAY_CHOICES = [7, 14, 30, 60, 90]

type BusyAction = 'restore' | 'delete' | 'empty' | 'settings'

const { t } = useI18n()
const overview = ref<RecycleBinOverview | null>(null)
const loading = ref(true)
const busy = ref<BusyAction | null>(null)
const page = ref(1)
const deleteTarget = ref<RecycleBinEntry | null>(null)
const emptyOpen = ref(false)

const settings = computed(() => overview.value?.settings ?? null)
const entries = computed(() => overview.value?.entries ?? [])
const total = computed(() => overview.value?.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const keepDayChoices = computed(() => {
  const current = settings.value?.keepDays
  const choices = current && !KEEP_DAY_CHOICES.includes(current) ? [...KEEP_DAY_CHOICES, current] : KEEP_DAY_CHOICES
  return choices.filter((days) => days >= RECYCLE_BIN_KEEP_DAYS_MIN && days <= RECYCLE_BIN_KEEP_DAYS_MAX).sort((a, b) => a - b)
})
const rows = computed(() =>
  entries.value.map((entry) => ({
    entry,
    title: entry.title || entry.files[0]?.relPath || t('tools.recycleBin.untitled'),
    kind: t(entry.kind === 'file' ? 'tools.recycleBin.kindFile' : 'tools.recycleBin.kindBook'),
    summary: t('tools.recycleBin.entrySummary', {
      count: entry.files.length,
      size: formatBytes(entry.sizeBytes),
      library: entry.libraryName ?? entry.libraryFolderPath,
    }),
    deleted: entry.deletedBy
      ? t('tools.recycleBin.deletedBy', { at: formatDateTime(new Date(entry.deletedAt)), name: entry.deletedBy })
      : t('tools.recycleBin.deletedAt', { at: formatDateTime(new Date(entry.deletedAt)) }),
    expires: t('tools.recycleBin.expires', { date: formatDate(new Date(entry.expiresAt)) }),
    firstPath: entry.files[0]?.relPath ?? '',
  })),
)
const pageLabel = computed(() => t('tools.recycleBin.page', { page: formatNumber(page.value), pages: formatNumber(pageCount.value) }))
const deleteDescription = computed(() =>
  deleteTarget.value ? t('tools.recycleBin.deleteBody', { title: deleteTarget.value.title || t('tools.recycleBin.untitled') }) : '',
)
const emptyDescription = computed(() => t('tools.recycleBin.emptyBody', { count: total.value }))

function message(error: unknown, fallbackKey: string): string {
  return error instanceof Error ? error.message : t(fallbackKey)
}

async function refresh(): Promise<void> {
  try {
    const next = await getRecycleBin(page.value, PAGE_SIZE)
    const lastPage = Math.max(1, Math.ceil(next.total / PAGE_SIZE))
    if (page.value > lastPage) {
      page.value = lastPage
      overview.value = await getRecycleBin(lastPage, PAGE_SIZE)
    } else {
      overview.value = next
    }
  } catch (error) {
    toast.error(message(error, 'tools.recycleBin.errors.load'))
  } finally {
    loading.value = false
  }
}

async function saveSettings(next: RecycleBinSettings): Promise<void> {
  busy.value = 'settings'
  try {
    await saveRecycleBinSettings(next)
    await refresh()
  } catch (error) {
    toast.error(message(error, 'tools.recycleBin.errors.save'))
  } finally {
    busy.value = null
  }
}

function handleEnabledChange(enabled: boolean): void {
  if (settings.value) void saveSettings({ ...settings.value, enabled })
}

function handleKeepDaysChange(event: Event): void {
  const keepDays = Number((event.target as HTMLSelectElement).value)
  if (settings.value) void saveSettings({ ...settings.value, keepDays })
}

async function handleRestore(entry: RecycleBinEntry): Promise<void> {
  busy.value = 'restore'
  try {
    const result = await restoreRecycleBinEntry(entry.id)
    if (result.conflicts.length > 0) {
      toast.warning(t('tools.recycleBin.restoredWithConflicts', { restored: result.restored, conflicts: result.conflicts.length }))
    } else {
      toast.success(t('tools.recycleBin.restored', { count: result.restored }))
    }
    await refresh()
  } catch (error) {
    toast.error(message(error, 'tools.recycleBin.errors.restore'))
  } finally {
    busy.value = null
  }
}

function handleAskDelete(entry: RecycleBinEntry): void {
  deleteTarget.value = entry
}

function handleCancelDelete(): void {
  deleteTarget.value = null
}

async function handleConfirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  busy.value = 'delete'
  try {
    await deleteRecycleBinEntry(target.id)
    deleteTarget.value = null
    await refresh()
  } catch (error) {
    toast.error(message(error, 'tools.recycleBin.errors.delete'))
  } finally {
    busy.value = null
  }
}

function handleAskEmpty(): void {
  emptyOpen.value = true
}

function handleCancelEmpty(): void {
  emptyOpen.value = false
}

async function handleConfirmEmpty(): Promise<void> {
  busy.value = 'empty'
  try {
    const result = await emptyRecycleBin()
    emptyOpen.value = false
    if (result.failed > 0) toast.warning(t('tools.recycleBin.emptiedWithFailures', { removed: result.removed, failed: result.failed }))
    else toast.success(t('tools.recycleBin.emptied', { count: result.removed }))
    await refresh()
  } catch (error) {
    toast.error(message(error, 'tools.recycleBin.errors.empty'))
  } finally {
    busy.value = null
  }
}

function handlePreviousPage(): void {
  if (page.value <= 1) return
  page.value -= 1
  void refresh()
}

function handleNextPage(): void {
  if (page.value >= pageCount.value) return
  page.value += 1
  void refresh()
}

function handleShow(): void {
  void refresh()
}

onMounted(handleShow)
onActivated(handleShow)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-3xl space-y-4">
      <header class="space-y-1">
        <h1 class="text-base font-semibold text-foreground">{{ t('tools.recycleBin.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('tools.recycleBin.description') }}</p>
      </header>

      <p v-if="loading" class="text-sm text-muted-foreground" role="status">{{ t('common.loading') }}</p>

      <template v-else-if="settings">
        <section class="space-y-4 rounded-lg border border-border/70 bg-card/50 p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0 space-y-1">
              <h2 class="text-sm font-semibold text-foreground">{{ t('tools.recycleBin.enabledTitle') }}</h2>
              <p class="text-sm text-muted-foreground">
                {{ t(settings.enabled ? 'tools.recycleBin.enabledHint' : 'tools.recycleBin.disabledHint') }}
              </p>
            </div>
            <ToggleSwitch
              :model-value="settings.enabled"
              :disabled="busy !== null"
              class="shrink-0 self-start sm:self-auto"
              data-testid="recycle-bin-enabled"
              @update:model-value="handleEnabledChange"
            />
          </div>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0 space-y-1">
              <h2 class="text-sm font-semibold text-foreground">{{ t('tools.recycleBin.keepTitle') }}</h2>
              <p class="text-sm text-muted-foreground">{{ t('tools.recycleBin.keepHint') }}</p>
            </div>
            <select
              class="select-field w-36 shrink-0"
              :aria-label="t('tools.recycleBin.keepTitle')"
              :value="settings.keepDays"
              :disabled="busy !== null"
              data-testid="recycle-bin-keep-days"
              @change="handleKeepDaysChange"
            >
              <option v-for="days in keepDayChoices" :key="days" :value="days">{{ t('tools.recycleBin.keepDays', { count: days }) }}</option>
            </select>
          </div>
        </section>

        <section class="rounded-lg border border-border/70 bg-card/50 p-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-foreground">{{ t('tools.recycleBin.itemsTitle', { count: total }) }}</h2>
            <Button
              v-if="total > 0"
              variant="outline"
              size="sm"
              class="shrink-0"
              :disabled="busy !== null"
              data-testid="recycle-bin-empty"
              @click="handleAskEmpty"
            >
              <Trash2 aria-hidden="true" />
              {{ t('tools.recycleBin.empty') }}
            </Button>
          </div>

          <p v-if="total === 0" class="mt-3 text-sm text-muted-foreground" data-testid="recycle-bin-none">{{ t('tools.recycleBin.none') }}</p>

          <ul v-else class="mt-3 divide-y divide-border/70">
            <li
              v-for="row in rows"
              :key="row.entry.id"
              class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="recycle-bin-entry"
            >
              <div class="min-w-0 space-y-0.5">
                <p class="text-sm font-medium text-foreground wrap-break-word">
                  {{ row.title }}
                  <span class="ms-1 text-xs font-normal text-muted-foreground">{{ row.kind }}</span>
                </p>
                <p class="text-xs text-muted-foreground">{{ row.summary }}</p>
                <p v-if="row.firstPath" class="text-xs text-muted-foreground break-all">{{ row.firstPath }}</p>
                <p class="text-xs text-muted-foreground">{{ row.deleted }} · {{ row.expires }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <Button variant="outline" size="sm" :disabled="busy !== null" data-testid="recycle-bin-restore" @click="handleRestore(row.entry)">
                  <Loader2 v-if="busy === 'restore'" class="animate-spin" aria-hidden="true" />
                  <RotateCcw v-else aria-hidden="true" />
                  {{ t('tools.recycleBin.restore') }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="busy !== null"
                  :aria-label="t('tools.recycleBin.deleteForever')"
                  data-testid="recycle-bin-delete"
                  @click="handleAskDelete(row.entry)"
                >
                  <Trash2 class="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          </ul>

          <div v-if="pageCount > 1" class="mt-3 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" :disabled="page <= 1" :aria-label="t('tools.recycleBin.previousPage')" @click="handlePreviousPage">
              <ChevronLeft class="size-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
            <span class="text-xs text-muted-foreground">{{ pageLabel }}</span>
            <Button variant="ghost" size="sm" :disabled="page >= pageCount" :aria-label="t('tools.recycleBin.nextPage')" @click="handleNextPage">
              <ChevronRight class="size-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        </section>

        <p class="text-xs text-muted-foreground">{{ t('tools.recycleBin.restoreNote') }}</p>
      </template>
    </div>
  </div>

  <ConfirmDialog
    :open="deleteTarget !== null"
    :title="t('tools.recycleBin.deleteTitle')"
    :description="deleteDescription"
    :confirm-label="t('tools.recycleBin.deleteForever')"
    :busy="busy === 'delete'"
    destructive
    @confirm="handleConfirmDelete"
    @cancel="handleCancelDelete"
  />

  <ConfirmDialog
    :open="emptyOpen"
    :title="t('tools.recycleBin.emptyTitle')"
    :description="emptyDescription"
    :confirm-label="t('tools.recycleBin.empty')"
    :busy="busy === 'empty'"
    destructive
    @confirm="handleConfirmEmpty"
    @cancel="handleCancelEmpty"
  />
</template>
