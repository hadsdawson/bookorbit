<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { AlertCircle, Library, Loader2, PartyPopper } from '@lucide/vue'
import type { SeriesReviewView, SeriesWaitingBook } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import MixedSeriesList from '../components/MixedSeriesList.vue'
import WaitingBooksList from '../components/WaitingBooksList.vue'
import { useMixedSeries, useWaitingSeriesBooks } from '../composables/useSeriesCheck'

type Section = 'mixed' | 'waiting'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const canUseTool = computed(() => hasPermission('library_edit_metadata'))

const section = ref<Section>('mixed')
const mixed = useMixedSeries()
const waiting = useWaitingSeriesBooks()

const sections = computed(() => [
  { key: 'mixed' as const, label: t('tools.seriesCheck.sections.mixed'), count: mixed.loaded.value ? mixed.counts.value.open : null },
  { key: 'waiting' as const, label: t('tools.seriesCheck.sections.waiting'), count: waiting.loaded.value ? waiting.total.value : null },
])

const views = computed(() => [
  { key: 'open' as const, label: t('tools.seriesCheck.views.open', { count: mixed.counts.value.open }) },
  { key: 'fine' as const, label: t('tools.seriesCheck.views.fine', { count: mixed.counts.value.fine }) },
])

const active = computed(() => (section.value === 'mixed' ? mixed : waiting))
const isEmpty = computed(() => !active.value.loading.value && active.value.loaded.value && active.value.items.value.length === 0)

onMounted(() => {
  if (!canUseTool.value) return
  void mixed.load()
  void waiting.load()
})

function isSection(key: Section) {
  return section.value === key
}

function isView(key: SeriesReviewView) {
  return mixed.view.value === key
}

function handleSection(key: Section) {
  section.value = key
}

function handleView(key: SeriesReviewView) {
  void mixed.setView(key)
}

function handleRetry() {
  void active.value.load()
}

async function handleFine(seriesId: number, fine: boolean) {
  const done = await mixed.setFine(seriesId, fine)
  if (!done) toast.error(t('tools.seriesCheck.fineFailed'))
}

async function handlePick(book: SeriesWaitingBook, seriesId: number) {
  const done = await waiting.resolve(book, { seriesId })
  if (!done) toast.error(t('tools.seriesCheck.pickFailed'))
}

async function handleStartNew(book: SeriesWaitingBook) {
  const done = await waiting.resolve(book, { newSeries: true })
  if (!done) toast.error(t('tools.seriesCheck.pickFailed'))
}

function handlePreviousPage() {
  void active.value.setPage(active.value.page.value - 1)
}

function handleNextPage() {
  void active.value.setPage(active.value.page.value + 1)
}
</script>

<template>
  <div v-if="!canUseTool" role="alert" class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
    {{ t('tools.seriesCheck.noPermission') }}
  </div>
  <div v-else class="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto pr-1">
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-foreground">{{ t('tools.seriesCheck.title') }}</h2>
      <p class="max-w-2xl text-sm text-muted-foreground">{{ t('tools.seriesCheck.description') }}</p>
    </div>

    <div class="flex flex-wrap items-center gap-2" role="tablist">
      <button
        v-for="item in sections"
        :key="item.key"
        type="button"
        role="tab"
        class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors"
        :class="isSection(item.key) ? 'border-primary bg-primary/10 text-foreground' : 'border-input text-muted-foreground hover:text-foreground'"
        :aria-selected="isSection(item.key)"
        :data-testid="`series-check-section-${item.key}`"
        @click="handleSection(item.key)"
      >
        {{ item.label }}
        <span v-if="item.count !== null" class="rounded-full bg-muted px-1.5 text-xs">{{ item.count }}</span>
      </button>
    </div>

    <div v-if="section === 'mixed'" class="flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-lg border border-input p-0.5">
        <button
          v-for="item in views"
          :key="item.key"
          type="button"
          class="h-7 rounded-md px-2.5 text-xs font-medium transition-colors"
          :class="isView(item.key) ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="isView(item.key)"
          :data-testid="`series-check-view-${item.key}`"
          @click="handleView(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
      <p class="text-xs text-muted-foreground">{{ t('tools.seriesCheck.splitHint') }}</p>
    </div>
    <p v-else class="text-xs text-muted-foreground">{{ t('tools.seriesCheck.waitingHint') }}</p>

    <div
      v-if="active.error.value"
      role="alert"
      class="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <span class="flex items-center gap-2"><AlertCircle class="size-4 shrink-0" aria-hidden="true" />{{ t('tools.seriesCheck.loadFailed') }}</span>
      <Button variant="outline" size="sm" @click="handleRetry">{{ t('common.retry') }}</Button>
    </div>

    <div v-if="active.loading.value && !active.loaded.value" class="flex flex-1 items-center justify-center py-10">
      <Loader2 class="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span class="sr-only">{{ t('common.loading') }}</span>
    </div>

    <div
      v-else-if="isEmpty"
      class="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-center"
      data-testid="series-check-empty"
    >
      <div class="flex size-12 items-center justify-center rounded-full bg-muted/70">
        <PartyPopper v-if="section === 'waiting' || isView('open')" class="size-5 text-muted-foreground" aria-hidden="true" />
        <Library v-else class="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p class="text-sm font-medium text-foreground">
        {{ section === 'waiting' ? t('tools.seriesCheck.empty.waiting') : t(`tools.seriesCheck.empty.${mixed.view.value}`) }}
      </p>
    </div>

    <MixedSeriesList v-else-if="section === 'mixed'" :items="mixed.items.value" :is-busy="mixed.isBusy" @fine="handleFine" />
    <WaitingBooksList
      v-else
      :items="waiting.items.value"
      :is-busy="waiting.isBusy"
      :row-key="waiting.waitingKey"
      @pick="handlePick"
      @start-new="handleStartNew"
    />

    <nav v-if="active.totalPages.value > 1" class="flex items-center justify-center gap-3" :aria-label="t('tools.seriesCheck.pagination')">
      <Button variant="outline" size="sm" :disabled="active.page.value <= 1 || active.loading.value" @click="handlePreviousPage">
        {{ t('common.previous') }}
      </Button>
      <span class="text-sm text-muted-foreground">
        {{ t('tools.seriesCheck.page', { page: active.page.value, total: active.totalPages.value }) }}
      </span>
      <Button variant="outline" size="sm" :disabled="active.page.value >= active.totalPages.value || active.loading.value" @click="handleNextPage">
        {{ t('common.next') }}
      </Button>
    </nav>
  </div>
</template>
