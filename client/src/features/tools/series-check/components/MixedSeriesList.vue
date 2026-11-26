<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, RotateCcw } from '@lucide/vue'
import type { SeriesReviewItem } from '@bookorbit/types'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'

defineProps<{
  items: SeriesReviewItem[]
  isBusy: (seriesId: number) => boolean
}>()

const emit = defineEmits<{ fine: [seriesId: number, fine: boolean] }>()

const { t } = useI18n()

function authorLine(item: SeriesReviewItem) {
  if (item.authors.length === 0) return t('tools.seriesCheck.noAuthors')
  const names = item.authors.join(', ')
  return item.moreAuthorCount > 0 ? t('tools.seriesCheck.moreAuthors', { names, count: item.moreAuthorCount }) : names
}

function handleFine(item: SeriesReviewItem) {
  emit('fine', item.id, !item.markedFine)
}
</script>

<template>
  <ul class="flex flex-col gap-2" data-testid="mixed-series-list">
    <li
      v-for="item in items"
      :key="item.id"
      class="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center"
      data-testid="mixed-series-row"
    >
      <div class="flex shrink-0 gap-1">
        <BookCoverImage
          v-for="bookId in item.coverBookIds"
          :key="bookId"
          :book-id="bookId"
          type="thumbnail"
          class="h-14 w-10 rounded-xs bg-muted object-cover"
          alt=""
        />
        <div v-if="item.coverBookIds.length === 0" class="h-14 w-10 rounded-xs bg-muted" aria-hidden="true" />
      </div>
      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <RouterLink
            :to="{ name: 'series-detail', params: { seriesId: item.id } }"
            class="truncate text-sm font-semibold text-foreground hover:underline"
            >{{ item.name }}</RouterLink
          >
          <span class="text-xs text-muted-foreground"> {{ t('tools.seriesCheck.bookCount', { count: item.bookCount }) }} · #{{ item.id }} </span>
        </div>
        <p class="truncate text-xs text-muted-foreground">{{ authorLine(item) }}</p>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-if="item.reasons.includes('repeatedNumber')"
            class="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"
            data-testid="reason-repeated"
          >
            {{ t('tools.seriesCheck.reasons.repeatedNumber', { numbers: item.repeatedNumbers.map((n) => `#${n}`).join(', ') }) }}
          </span>
          <span
            v-if="item.reasons.includes('unrelatedAuthors')"
            class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            data-testid="reason-unrelated"
          >
            {{ t('tools.seriesCheck.reasons.unrelatedAuthors') }}
          </span>
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <RouterLink
          :to="{ name: 'series-detail', params: { seriesId: item.id } }"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:bg-muted"
        >
          <ExternalLink class="size-3.5" aria-hidden="true" />
          {{ t('tools.seriesCheck.openSeries') }}
        </RouterLink>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
          :disabled="isBusy(item.id)"
          data-testid="mixed-series-fine"
          @click="handleFine(item)"
        >
          <RotateCcw v-if="item.markedFine" class="size-3.5" aria-hidden="true" />
          <Check v-else class="size-3.5" aria-hidden="true" />
          {{ item.markedFine ? t('tools.seriesCheck.bringBack') : t('tools.seriesCheck.looksFine') }}
        </button>
      </div>
    </li>
  </ul>
</template>
