<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Pencil } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookCard, BookQuery, BooksPage } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import RenameModal from '@/features/tools/entity-manager/components/RenameModal.vue'
import { usePublishers } from '../composables/usePublishers'

const PAGE_SIZE = 60

type BookActionType = 'quick-view' | 'add-to-collection' | 'move-to-library' | 'delete'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { portraitCoverSize, gridGap } = useDisplaySettings()
const { rename, working } = usePublishers()

const publisherName = computed(() => (typeof route.params.name === 'string' ? route.params.name : ''))
const books = ref<BookCard[]>([])
const total = ref(0)
const loading = ref(false)
const failed = ref(false)
const renaming = ref(false)
const quickViewBookId = ref<number | null>(null)
const quickViewOpen = ref(false)
const addToCollectionBookId = ref<number | null>(null)
const addToCollectionOpen = ref(false)
let nextPage = 0
let generation = 0

const coverSize = computed(() => Math.max(125, portraitCoverSize.value - 20))
const hasMore = computed(() => books.value.length < total.value)
const addToCollectionPayload = computed(() => ({ bookIds: addToCollectionBookId.value ? [addToCollectionBookId.value] : [] }))

async function loadPage(reset: boolean): Promise<void> {
  if (!publisherName.value) return
  const current = reset ? ++generation : generation
  if (reset) nextPage = 0
  loading.value = true
  try {
    const body: BookQuery = {
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: nextPage, size: PAGE_SIZE },
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'publisher', operator: 'eq', value: publisherName.value }] },
    }
    const response = await api('/api/v1/books/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (current !== generation) return
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: BooksPage = await response.json()
    if (current !== generation) return
    books.value = reset ? data.items : [...books.value, ...data.items]
    total.value = data.total
    nextPage = data.page + 1
    failed.value = false
  } catch {
    if (current !== generation) return
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

function reload(): void {
  void loadPage(true)
}

function handleLoadMore(): void {
  void loadPage(false)
}

function handleBack(): void {
  void router.push({ name: 'publishers' })
}

function handleRenameOpen(): void {
  renaming.value = true
}

function handleRenameCancel(): void {
  renaming.value = false
}

async function handleRenameConfirm(newName: string, writeFiles: boolean): Promise<void> {
  try {
    await rename(publisherName.value, newName, writeFiles)
    toast.success(t('publishers.renamed', { from: publisherName.value, to: newName }))
    renaming.value = false
    await router.replace({ name: 'publisher-detail', params: { name: newName } })
  } catch {
    toast.error(t('publishers.errors.rename'))
  }
}

function handleBookAction(book: BookCard, action: BookActionType): void {
  if (action === 'quick-view') {
    quickViewBookId.value = book.id
    quickViewOpen.value = true
  } else if (action === 'add-to-collection') {
    addToCollectionBookId.value = book.id
    addToCollectionOpen.value = true
  }
}

function handleQuickViewAction(action: BookActionType): void {
  if (quickViewBookId.value !== null) handleBookAction({ id: quickViewBookId.value } as BookCard, action)
}

// An edit made in the quick view can change a book's publisher, so the list is asked again on close.
function handleQuickViewOpenChange(open: boolean): void {
  quickViewOpen.value = open
  if (!open) reload()
}

function handleAddToCollectionOpenChange(open: boolean): void {
  addToCollectionOpen.value = open
  if (!open) addToCollectionBookId.value = null
}

function handleBookUpdate(updated: BookCard): void {
  books.value = books.value.map((book) => (book.id === updated.id ? updated : book))
}

watch(publisherName, reload, { immediate: true })
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden rounded-lg border border-border/70 bg-card/40 shadow-sm">
    <div class="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
      <Button size="sm" variant="ghost" data-testid="publisher-back" @click="handleBack">
        <ArrowLeft aria-hidden="true" />
        {{ t('publishers.title') }}
      </Button>
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-base font-semibold text-foreground" data-testid="publisher-name">{{ publisherName }}</h1>
        <p class="text-xs text-muted-foreground">{{ t('publishers.bookCount', { count: total }) }}</p>
      </div>
      <Button size="sm" variant="outline" :disabled="working" data-testid="publisher-rename" @click="handleRenameOpen">
        <Pencil aria-hidden="true" />
        {{ t('publishers.rename') }}
      </Button>
    </div>

    <main class="flex-1 overflow-y-auto px-4 py-4">
      <p v-if="failed" class="py-10 text-center text-sm text-muted-foreground">{{ t('publishers.errors.loadBooks') }}</p>
      <p v-else-if="loading && books.length === 0" class="py-10 text-center text-sm text-muted-foreground" role="status">{{ t('common.loading') }}</p>
      <p v-else-if="books.length === 0" class="py-10 text-center text-sm text-muted-foreground">{{ t('publishers.noBooks') }}</p>
      <template v-else>
        <VirtualBookGrid
          :books="books"
          :cover-size="coverSize"
          :grid-gap="gridGap"
          :virtualized="false"
          @action="handleBookAction"
          @update:book="handleBookUpdate"
        />
        <div v-if="hasMore" class="mt-4 flex justify-center">
          <Button size="sm" variant="outline" :disabled="loading" data-testid="publisher-load-more" @click="handleLoadMore">
            {{ t('publishers.loadMore') }}
          </Button>
        </div>
      </template>
    </main>

    <RenameModal v-if="renaming" :current-name="publisherName" :loading="working" @confirm="handleRenameConfirm" @cancel="handleRenameCancel" />
    <AddToCollectionSheet
      :open="addToCollectionOpen"
      :selection-payload="addToCollectionPayload"
      :selected-count="addToCollectionBookId ? 1 : 0"
      @update:open="handleAddToCollectionOpenChange"
    />
    <BookQuickView :book-id="quickViewBookId" :open="quickViewOpen" @update:open="handleQuickViewOpenChange" @action="handleQuickViewAction" />
  </div>
</template>
