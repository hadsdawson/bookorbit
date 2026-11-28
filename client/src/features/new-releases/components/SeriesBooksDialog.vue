<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { BookOpen, Check, Clock, Loader2, Plus, X } from '@lucide/vue'
import type { NewReleaseRequestFormat, SeriesBookItem } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatDate, formatList } from '@/i18n/formatters'
import { useSeriesBooks } from '../composables/useSeriesBooks'
import FollowReleasesButton from './FollowReleasesButton.vue'

const { t } = useI18n()
const { open, target, prompted, result, loading, failed, busyKeys, bulkBusy, missing, canRequest, close, requestOne, requestAllMissing, retry } =
  useSeriesBooks()

const seriesName = computed(() => result.value?.seriesName ?? target.value?.name ?? '')
const books = computed(() => result.value?.books ?? [])
const noSources = computed(() => {
  const sources = result.value?.sources
  return !!sources && !sources.hardcover && !sources.audible
})
const formatsText = computed(() => formatList((result.value?.formats ?? []).map(formatName)))
const showList = computed(() => books.value.length > 0)
const hasComingSoon = computed(() => books.value.some((book) => book.comingSoon))
const showEmpty = computed(() => !loading.value && !failed.value && !!result.value && !noSources.value && books.value.length === 0)

function formatName(format: NewReleaseRequestFormat): string {
  return format === 'ebook' ? t('newReleases.seriesBooks.formatEbook') : t('newReleases.seriesBooks.formatAudiobook')
}

/** Dates are calendar days; read at noon so no time zone moves them to the day before. */
function dayText(day: string): string {
  return formatDate(new Date(`${day}T12:00:00`), { year: 'numeric', month: 'short', day: 'numeric' })
}

function dateLine(book: SeriesBookItem): string | null {
  if (book.releasedOn) return t('newReleases.seriesBooks.releasedOn', { date: dayText(book.releasedOn) })
  if (book.comingOn) return t('newReleases.seriesBooks.comingOn', { date: dayText(book.comingOn) })
  return null
}

function partlyText(book: SeriesBookItem): string | null {
  const asked = result.value?.formats.length ?? 0
  if (book.status !== 'missing' || book.missingFormats.length === 0 || book.missingFormats.length === asked) return null
  return t('newReleases.seriesBooks.partlyOwned', { formats: formatList(book.missingFormats.map(formatName)) })
}

function indexText(book: SeriesBookItem): string | null {
  return book.seriesIndex === null ? null : t('newReleases.seriesBooks.bookNumber', { number: book.seriesIndex })
}

function handleOpenChange(value: boolean) {
  if (!value) close()
}

function handleRequest(book: SeriesBookItem) {
  void requestOne(book.key)
}

function handleRequestAll() {
  void requestAllMissing()
}

function handleRetry() {
  retry()
}

function handleNavigate() {
  close()
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-testid="series-books-dialog"
      >
        <header class="flex items-start gap-3 border-b border-border px-5 pt-5 pb-4">
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-lg font-semibold [overflow-wrap:anywhere] text-foreground">
              {{
                prompted ? t('newReleases.seriesBooks.promptTitle', { name: seriesName }) : t('newReleases.seriesBooks.title', { name: seriesName })
              }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              {{ prompted ? t('newReleases.seriesBooks.promptSubtitle') : t('newReleases.seriesBooks.subtitle') }}
            </DialogDescription>
          </div>
          <DialogClose
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :aria-label="t('newReleases.seriesBooks.close')"
          >
            <X :size="16" aria-hidden="true" />
          </DialogClose>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <p v-if="loading && !showList" class="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 :size="16" class="animate-spin" aria-hidden="true" />
            {{ t('newReleases.seriesBooks.loading') }}
          </p>
          <div v-else-if="failed && !showList" class="py-6 text-sm text-muted-foreground">
            <p>{{ t('newReleases.seriesBooks.loadFailed') }}</p>
            <Button class="mt-3" variant="outline" size="sm" @click="handleRetry">{{ t('common.retry') }}</Button>
          </div>
          <p v-else-if="noSources && !showList" class="py-6 text-sm text-muted-foreground">{{ t('newReleases.seriesBooks.noSources') }}</p>
          <p v-else-if="showEmpty" class="py-6 text-sm text-muted-foreground">{{ t('newReleases.seriesBooks.empty') }}</p>

          <template v-if="showList">
            <p v-if="result?.failedSources.length" class="mb-2 text-xs text-muted-foreground">{{ t('newReleases.seriesBooks.partial') }}</p>
            <ul class="divide-y divide-border" data-testid="series-books-list">
              <li v-for="book in books" :key="book.key" class="flex items-center gap-3 py-2.5" data-testid="series-book">
                <div class="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  <img
                    v-if="book.coverUrl"
                    :src="book.coverUrl"
                    alt=""
                    class="h-full w-full object-cover"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                  <BookOpen v-else :size="16" class="text-muted-foreground" aria-hidden="true" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-xs text-muted-foreground tabular-nums">{{ indexText(book) }}</p>
                  <p class="truncate text-sm font-medium text-foreground" :title="book.title">{{ book.title }}</p>
                  <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span
                      v-if="book.comingSoon"
                      class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px font-medium text-primary"
                      data-testid="series-book-coming-soon"
                    >
                      <Clock :size="11" aria-hidden="true" />
                      {{ t('newReleases.seriesBooks.comingSoon') }}
                    </span>
                    <span v-if="dateLine(book)">{{ dateLine(book) }}</span>
                    <span v-if="partlyText(book)">{{ partlyText(book) }}</span>
                  </p>
                </div>
                <div class="shrink-0">
                  <RouterLink
                    v-if="book.status === 'owned' && book.ownedBookId"
                    :to="{ name: 'book-detail', params: { bookId: book.ownedBookId } }"
                    class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    @click="handleNavigate"
                  >
                    <Check :size="14" aria-hidden="true" />
                    {{ t('newReleases.seriesBooks.owned') }}
                  </RouterLink>
                  <RouterLink
                    v-else-if="book.status === 'requested' && book.requestId"
                    :to="{ name: 'book-request-detail', params: { id: book.requestId } }"
                    class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    @click="handleNavigate"
                  >
                    <Check :size="14" aria-hidden="true" />
                    {{ t('newReleases.seriesBooks.requested') }}
                  </RouterLink>
                  <span v-else-if="book.status !== 'missing'" class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Check :size="14" aria-hidden="true" />
                    {{ book.status === 'owned' ? t('newReleases.seriesBooks.owned') : t('newReleases.seriesBooks.requested') }}
                  </span>
                  <Button
                    v-else-if="canRequest"
                    variant="outline"
                    size="sm"
                    :disabled="busyKeys.size > 0"
                    data-testid="series-book-request"
                    @click="handleRequest(book)"
                  >
                    <Loader2 v-if="busyKeys.has(book.key)" :size="14" class="animate-spin" aria-hidden="true" />
                    <Plus v-else :size="14" aria-hidden="true" />
                    {{ t('newReleases.seriesBooks.request') }}
                  </Button>
                </div>
              </li>
            </ul>
          </template>
        </div>

        <footer class="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center">
          <div class="min-w-0 flex-1 space-y-1">
            <p v-if="formatsText" class="text-xs text-muted-foreground">{{ t('newReleases.seriesBooks.formats', { formats: formatsText }) }}</p>
            <p v-if="showList && missing.length === 0" class="text-xs text-muted-foreground">{{ t('newReleases.seriesBooks.allSet') }}</p>
            <p v-if="hasComingSoon" class="text-xs text-muted-foreground">{{ t('newReleases.seriesBooks.followHint') }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <FollowReleasesButton v-if="seriesName" kind="series" :name="seriesName" :series-id="result?.seriesId ?? undefined" />
            <Button
              v-if="canRequest && missing.length > 0"
              size="sm"
              :disabled="busyKeys.size > 0"
              data-testid="series-books-request-all"
              @click="handleRequestAll"
            >
              <Loader2 v-if="bulkBusy" :size="14" class="animate-spin" aria-hidden="true" />
              {{ t('newReleases.seriesBooks.requestAll', { count: missing.length }) }}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
