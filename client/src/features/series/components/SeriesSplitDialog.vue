<script setup lang="ts">
import { computed, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Loader2, X } from '@lucide/vue'
import type { SplitSeriesBooksResult } from '@bookorbit/types'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useSeriesSplit, type SplitAuthorGroup } from '../composables/useSeriesSplit'

/** Fork. Pick some of a series' books and move them into a new series. */
const props = defineProps<{ open: boolean; seriesId: number | null; seriesName: string }>()
const emit = defineEmits<{ close: []; split: [result: SplitSeriesBooksResult] }>()

const { t } = useI18n()
const split = useSeriesSplit(toRef(props, 'seriesId'), toRef(props, 'seriesName'))

watch(
  () => props.open,
  (open) => {
    if (open) void split.open()
  },
  { immediate: true },
)

const allSelected = computed(() => split.total.value > 0 && split.selectedCount.value >= split.total.value)

function handleClose() {
  if (split.submitting.value) return
  emit('close')
}

function handleToggle(bookId: number) {
  split.toggle(bookId)
}

function handleToggleGroup(group: SplitAuthorGroup) {
  split.toggleGroup(group)
}

function handleLoadMore() {
  void split.loadMore()
}

async function handleSubmit() {
  if (!split.canSubmit.value) return
  try {
    const result = await split.submit()
    emit('split', result)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('series.split.failed'))
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-2 sm:p-4" @click.self="handleClose">
    <div
      class="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      role="dialog"
      aria-modal="true"
      :aria-label="t('series.split.title')"
      data-testid="series-split-dialog"
    >
      <div class="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 class="text-base font-semibold">{{ t('series.split.title') }}</h3>
        <button
          type="button"
          class="text-muted-foreground transition-colors hover:text-foreground"
          :aria-label="t('common.close')"
          @click="handleClose"
        >
          <X class="size-5" />
        </button>
      </div>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <p class="text-sm text-muted-foreground">{{ t('series.split.description') }}</p>

        <div v-if="split.authorGroups.value.length > 1" class="space-y-1.5">
          <p class="text-xs font-medium text-muted-foreground">{{ t('series.split.byAuthor') }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="group in split.authorGroups.value"
              :key="group.name"
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
              :class="
                split.isGroupSelected(group)
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-input text-muted-foreground hover:text-foreground'
              "
              :aria-pressed="split.isGroupSelected(group)"
              data-testid="series-split-author"
              @click="handleToggleGroup(group)"
            >
              {{ group.name }} ({{ group.bookIds.length }})
            </button>
          </div>
        </div>

        <ul class="divide-y divide-border rounded-lg border border-border" data-testid="series-split-books">
          <li v-for="row in split.rows.value" :key="row.id">
            <label class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
              <input
                type="checkbox"
                class="rounded-xs accent-primary"
                :checked="split.isSelected(row.id)"
                data-testid="series-split-book"
                @change="handleToggle(row.id)"
              />
              <BookCoverImage :book-id="row.id" type="thumbnail" class="h-10 w-7 shrink-0 rounded-xs bg-muted object-cover" alt="" />
              <span class="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">{{ row.seriesIndex ? `#${row.seriesIndex}` : '-' }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-foreground">{{ row.title || t('series.split.untitled') }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{ row.authors.join(', ') }}</span>
              </span>
            </label>
          </li>
        </ul>
        <div v-if="split.loading.value" class="flex justify-center py-2">
          <Loader2 class="size-5 animate-spin text-muted-foreground" :aria-label="t('common.loading')" />
        </div>
        <p v-else-if="split.error.value" class="text-sm text-destructive" role="alert">{{ t('series.split.loadFailed') }}</p>
        <button
          v-else-if="split.hasMore.value"
          type="button"
          class="w-full rounded-lg border border-input py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          @click="handleLoadMore"
        >
          {{ t('series.split.loadMore', { shown: split.rows.value.length, total: split.total.value }) }}
        </button>

        <label class="block space-y-1">
          <span class="text-sm text-muted-foreground">{{ t('series.split.newName') }}</span>
          <input
            v-model="split.name.value"
            type="text"
            maxlength="500"
            class="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="series-split-name"
          />
          <span class="block text-xs text-muted-foreground">{{ t('series.split.nameHint') }}</span>
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input v-model="split.writeFiles.value" type="checkbox" class="rounded-xs accent-primary" />
          {{ t('series.split.writeFiles') }}
        </label>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-5 py-3">
        <span class="text-xs" :class="allSelected ? 'text-destructive' : 'text-muted-foreground'" aria-live="polite">
          {{ allSelected ? t('series.split.keepOne') : t('series.split.selected', { count: split.selectedCount.value }) }}
        </span>
        <div class="flex gap-2">
          <button type="button" class="h-9 rounded-lg px-4 text-sm font-medium transition-colors hover:bg-muted" @click="handleClose">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            :disabled="!split.canSubmit.value"
            data-testid="series-split-submit"
            @click="handleSubmit"
          >
            {{ split.submitting.value ? t('series.split.splitting') : t('series.split.submit', { count: split.selectedCount.value }) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
