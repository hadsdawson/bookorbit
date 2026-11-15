<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import type { AuthorNameLink, BookCard } from '@bookorbit/types'

import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import type { AuthorBookSort, SortDirection } from '../types/author'
import { useAuthorBooks } from '../composables/useAuthorBooks'

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'move-to-library' | 'delete'

/**
 * Fork: the books credited to one pen name, under the person's own books on their page. Loads a
 * page at a time on request rather than on scroll, so it never competes with the main list.
 */
const props = defineProps<{
  penName: AuthorNameLink
  viewMode: 'grid' | 'list'
  coverSize: number
  gridGap: number
  sort: AuthorBookSort
  order: SortDirection
  libraryId: number | null
  collapseSeries: boolean
}>()
const emit = defineEmits<{ action: [book: BookCard, action: BookActionType] }>()

const { t } = useI18n()
const route = useRoute()
const penNameId = computed(() => props.penName.id)
const books = useAuthorBooks(penNameId)
const { items, bookTotal, loading, error, hasMore, load } = books

function syncQuery() {
  books.sort.value = props.sort
  books.order.value = props.order
  books.libraryId.value = props.libraryId
  books.collapseSeries.value = props.collapseSeries
}

function handleAction(book: BookCard, action: BookActionType) {
  emit('action', book, action)
}

function handleShowMore() {
  void load()
}

function handleBookUpdate(updated: BookCard) {
  items.value = items.value.map((book) => (book.id === updated.id ? updated : book))
}

// A pen name with no books yet has nothing to fetch, and the server answers it as not found.
const hasBooks = computed(() => props.penName.bookCount > 0)

function reload() {
  if (!hasBooks.value) return
  syncQuery()
  void load(true)
}

watch(() => [props.penName.id, props.penName.bookCount, props.sort, props.order, props.libraryId, props.collapseSeries], reload)

// Arriving from a pen name's own link lands on its section.
async function scrollIntoViewIfLinked() {
  if (route.hash !== `#pen-name-${props.penName.id}`) return
  await nextTick()
  document.getElementById(`pen-name-${props.penName.id}`)?.scrollIntoView({ block: 'start' })
}

onMounted(async () => {
  if (hasBooks.value) {
    syncQuery()
    await load(true)
  }
  await scrollIntoViewIfLinked()
})
</script>

<template>
  <section :id="`pen-name-${penName.id}`" class="mt-8 scroll-mt-20" :data-testid="`pen-name-section-${penName.id}`">
    <h2 class="mb-3 text-sm font-semibold text-foreground">
      {{ t('author.detail.penNameSection.heading', { name: penName.name }) }}
      <span class="ml-1 text-xs font-normal text-muted-foreground">{{
        t('author.index.bookCount', { count: hasBooks ? bookTotal || penName.bookCount : 0 })
      }}</span>
    </h2>

    <div v-if="error && hasBooks" class="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {{ error }}
    </div>

    <p v-if="!hasBooks || (!loading && items.length === 0 && !error)" class="text-xs text-muted-foreground" data-testid="pen-name-empty">
      {{ t('author.detail.penNameSection.empty') }}
    </p>

    <VirtualBookGrid
      v-if="viewMode === 'grid' && items.length > 0"
      :books="items"
      :cover-size="coverSize"
      :grid-gap="gridGap"
      :virtualized="false"
      @action="handleAction"
      @update:book="handleBookUpdate"
    />

    <div v-if="viewMode === 'list' && items.length > 0" class="flex flex-col divide-y divide-border">
      <BookListRow v-for="book in items" :key="book.id" :book="book" @action="handleAction(book, $event)" />
    </div>

    <div class="mt-3 flex h-8 items-center justify-center">
      <span v-if="loading" class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
      <button
        v-else-if="hasMore"
        type="button"
        class="h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground hover:bg-muted"
        @click="handleShowMore"
      >
        {{ t('author.detail.penNameSection.showMore') }}
      </button>
    </div>
  </section>
</template>
