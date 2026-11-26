<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import type { SeriesWaitingBook } from '@bookorbit/types'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import SeriesChoice from '@/features/book/components/series-choice/SeriesChoice.vue'

defineProps<{
  items: SeriesWaitingBook[]
  isBusy: (book: SeriesWaitingBook) => boolean
  rowKey: (book: SeriesWaitingBook) => string
}>()

const emit = defineEmits<{ pick: [book: SeriesWaitingBook, seriesId: number]; startNew: [book: SeriesWaitingBook] }>()

const { t } = useI18n()

function handlePick(book: SeriesWaitingBook, seriesId: number) {
  emit('pick', book, seriesId)
}

function handleStartNew(book: SeriesWaitingBook) {
  emit('startNew', book)
}

function seriesLabel(book: SeriesWaitingBook) {
  return book.seriesIndex ? `${book.seriesName} #${book.seriesIndex}` : book.seriesName
}
</script>

<template>
  <ul class="flex flex-col gap-2" data-testid="waiting-books-list">
    <li v-for="book in items" :key="rowKey(book)" class="flex gap-3 rounded-lg border border-border bg-card p-3" data-testid="waiting-book-row">
      <BookCoverImage :book-id="book.bookId" type="thumbnail" class="h-16 w-11 shrink-0 rounded-xs bg-muted object-cover" alt="" />
      <div class="min-w-0 flex-1 space-y-1.5">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <RouterLink
            :to="{ name: 'book-detail', params: { bookId: book.bookId } }"
            class="truncate text-sm font-semibold text-foreground hover:underline"
            >{{ book.title || t('tools.seriesCheck.untitled') }}</RouterLink
          >
          <span v-if="book.authors.length" class="truncate text-xs text-muted-foreground">{{ book.authors.join(', ') }}</span>
          <Loader2 v-if="isBusy(book)" class="size-3.5 animate-spin text-muted-foreground" :aria-label="t('common.loading')" />
        </div>
        <p class="text-xs text-muted-foreground">{{ t('tools.seriesCheck.waitingFor', { series: seriesLabel(book) }) }}</p>
        <SeriesChoice
          flush
          :series-name="book.seriesName"
          :series-id="null"
          :new-series="false"
          :edited="true"
          :disabled="isBusy(book)"
          @pick="handlePick(book, $event)"
          @start-new="handleStartNew(book)"
        />
      </div>
    </li>
  </ul>
</template>
