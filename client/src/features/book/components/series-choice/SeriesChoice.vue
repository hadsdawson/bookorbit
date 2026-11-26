<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, Images, Plus, TriangleAlert } from '@lucide/vue'
import type { SeriesNameMatch } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useSeriesNameMatches } from '@/features/book/composables/useSeriesNameMatches'

/**
 * Fork. Which series a series name means, when that is worth asking: several series share the name,
 * or a name just typed matches one and the person may want to check it or start another.
 */
const props = defineProps<{
  seriesName: string
  /** The series picked for this row; null when the name alone decides. */
  seriesId: number | null
  /** The row asks for a new series of this name. */
  newSeries: boolean
  /** The row was typed or changed in this edit, so a single match is shown for checking. */
  edited: boolean
  disabled?: boolean
  /** Line up with the field above instead of the series row's text box. */
  flush?: boolean
}>()

const emit = defineEmits<{ pick: [seriesId: number]; startNew: [] }>()

const { t } = useI18n()
const { matches } = useSeriesNameMatches(toRef(props, 'seriesName'))

const shown = computed(() => {
  if (!props.seriesName.trim() || matches.value.length === 0) return false
  if (matches.value.length > 1) return true
  return props.edited || props.newSeries
})

const needsPick = computed(() => matches.value.length > 1 && props.seriesId == null && !props.newSeries)

function isSelected(match: SeriesNameMatch) {
  if (props.newSeries) return false
  if (props.seriesId != null) return props.seriesId === match.id
  return matches.value.length === 1
}

function authorLine(match: SeriesNameMatch) {
  if (match.authors.length === 0) return t('book.detail.seriesMembership.choice.noAuthors')
  const names = match.authors.join(', ')
  return match.moreAuthorCount > 0 ? t('book.detail.seriesMembership.choice.moreAuthors', { names, count: match.moreAuthorCount }) : names
}

const openPreview = ref<number | null>(null)

function setPreview(id: number | null) {
  openPreview.value = id
}

function previewOpen(id: number) {
  return openPreview.value === id
}

function handlePreviewToggle(id: number, open: boolean) {
  openPreview.value = open ? id : null
}

function handlePick(id: number) {
  if (props.disabled) return
  emit('pick', id)
}

function handleStartNew() {
  if (props.disabled) return
  emit('startNew')
}

function seriesHref(id: number) {
  return `/series/${id}`
}
</script>

<template>
  <div v-if="shown" class="w-full" :class="flush ? '' : 'ps-10'" data-testid="series-choice">
    <p v-if="needsPick" class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning" role="status">
      <TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
      {{ t('book.detail.seriesMembership.choice.pickOne', { count: matches.length, name: seriesName.trim() }) }}
    </p>
    <p v-else-if="matches.length === 1 && !newSeries" class="mb-1.5 text-xs text-muted-foreground">
      {{ t('book.detail.seriesMembership.choice.joining') }}
    </p>
    <ul class="flex flex-col gap-1.5" :aria-label="t('book.detail.seriesMembership.choice.listLabel', { name: seriesName.trim() })">
      <li
        v-for="match in matches"
        :key="match.id"
        class="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
        :class="isSelected(match) ? 'border-primary/60 bg-primary/5' : 'border-border'"
        data-testid="series-choice-option"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
          :aria-pressed="isSelected(match)"
          :disabled="disabled"
          data-testid="series-choice-pick"
          @click="handlePick(match.id)"
        >
          <span
            class="flex size-4 shrink-0 items-center justify-center rounded-full border"
            :class="isSelected(match) ? 'border-primary bg-primary text-primary-foreground' : 'border-input'"
            aria-hidden="true"
          >
            <Check v-if="isSelected(match)" class="size-3" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-foreground">{{ authorLine(match) }}</span>
            <span class="block text-muted-foreground">
              {{ t('book.detail.seriesMembership.choice.bookCount', { count: match.bookCount }) }} · #{{ match.id }}
            </span>
          </span>
        </button>
        <Popover :open="previewOpen(match.id)" @update:open="handlePreviewToggle(match.id, $event)">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="series-choice-preview"
              @mouseenter="setPreview(match.id)"
              @mouseleave="setPreview(null)"
            >
              <Images class="size-3.5" aria-hidden="true" />
              {{ t('book.detail.seriesMembership.choice.preview') }}
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-2" side="top" @mouseenter="setPreview(match.id)" @mouseleave="setPreview(null)">
            <div v-if="match.coverBookIds.length > 0" class="flex gap-2" data-testid="series-choice-covers">
              <BookCoverImage
                v-for="bookId in match.coverBookIds"
                :key="bookId"
                :book-id="bookId"
                type="thumbnail"
                class="h-24 w-16 rounded-xs bg-muted object-cover"
                alt=""
              />
            </div>
            <p v-else class="px-1 text-xs text-muted-foreground">{{ t('book.detail.seriesMembership.choice.noCovers') }}</p>
          </PopoverContent>
        </Popover>
        <a
          :href="seriesHref(match.id)"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid="series-choice-view"
        >
          <ExternalLink class="size-3.5" aria-hidden="true" />
          {{ t('book.detail.seriesMembership.choice.view') }}
        </a>
      </li>
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed"
          :class="newSeries ? 'border-primary/60 bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'"
          :aria-pressed="newSeries"
          :disabled="disabled"
          data-testid="series-choice-new"
          @click="handleStartNew"
        >
          <Plus class="size-3.5 shrink-0" aria-hidden="true" />
          {{ t('book.detail.seriesMembership.choice.startNew', { name: seriesName.trim() }) }}
        </button>
      </li>
    </ul>
  </div>
</template>
