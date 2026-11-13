<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'
import { Building2, Merge, Pencil, Search } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BrowseEntityItem, BrowseEntitySortBy, BrowseEntitySortOrder } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import RenameModal from '@/features/tools/entity-manager/components/RenameModal.vue'
import BrowseMergeModal from '@/features/tools/entity-manager/components/BrowseMergeModal.vue'
import { PUBLISHER_PAGE_SIZE, usePublishers } from '../composables/usePublishers'

type SortChoice = `${BrowseEntitySortBy}:${BrowseEntitySortOrder}`
const SORT_CHOICES: readonly SortChoice[] = ['name:asc', 'name:desc', 'bookCount:desc', 'bookCount:asc']

const { t } = useI18n()
const router = useRouter()
const { items, total, page, search, sortBy, sortOrder, loading, failed, working, load, rename, merge } = usePublishers()

// Kept by name across pages and searches, so publishers found by different searches can be merged.
const selected = ref(new Map<string, BrowseEntityItem>())
const renameTarget = ref<BrowseEntityItem | null>(null)
const showMerge = ref(false)

const sortChoice = computed<SortChoice>(() => `${sortBy.value}:${sortOrder.value}`)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PUBLISHER_PAGE_SIZE)))
const selectedItems = computed(() => [...selected.value.values()])
const canMerge = computed(() => selected.value.size >= 2)

const reloadFromFirstPage = useDebounceFn(() => {
  page.value = 1
  void load()
}, 250)

watch(search, () => {
  void reloadFromFirstPage()
})

function handleSortChange(event: Event): void {
  const [by, order] = (event.target as HTMLSelectElement).value.split(':') as [BrowseEntitySortBy, BrowseEntitySortOrder]
  sortBy.value = by
  sortOrder.value = order
  page.value = 1
  void load()
}

function handlePreviousPage(): void {
  if (page.value <= 1) return
  page.value -= 1
  void load()
}

function handleNextPage(): void {
  if (page.value >= pageCount.value) return
  page.value += 1
  void load()
}

function isSelected(item: BrowseEntityItem): boolean {
  return selected.value.has(item.name)
}

function toggleSelected(item: BrowseEntityItem): void {
  const next = new Map(selected.value)
  if (next.has(item.name)) next.delete(item.name)
  else next.set(item.name, item)
  selected.value = next
}

function handleClearSelection(): void {
  selected.value = new Map()
}

function openPublisher(item: BrowseEntityItem): void {
  void router.push({ name: 'publisher-detail', params: { name: item.name } })
}

function startRename(item: BrowseEntityItem): void {
  renameTarget.value = item
}

function handleRenameCancel(): void {
  renameTarget.value = null
}

async function handleRenameConfirm(newName: string, writeFiles: boolean): Promise<void> {
  const target = renameTarget.value
  if (!target) return
  try {
    await rename(target.name, newName, writeFiles)
    toast.success(t('publishers.renamed', { from: target.name, to: newName }))
    renameTarget.value = null
    handleClearSelection()
    await load()
  } catch {
    toast.error(t('publishers.errors.rename'))
  }
}

function handleMergeOpen(): void {
  showMerge.value = true
}

function handleMergeCancel(): void {
  showMerge.value = false
}

async function handleMergeConfirm(targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean): Promise<void> {
  try {
    await merge(String(targetId), sourceIds.map(String), writeFiles)
    toast.success(t('publishers.merged', { count: sourceIds.length, into: String(targetId) }))
    showMerge.value = false
    handleClearSelection()
    await load()
  } catch {
    toast.error(t('publishers.errors.merge'))
  }
}

onMounted(load)
// A rename made on a publisher's own page changes this list too.
onActivated(load)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden rounded-lg border border-border/70 bg-card/40 shadow-sm">
    <div class="flex flex-col gap-2 border-b border-border/70 px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div class="relative w-full md:max-w-sm">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="search"
          type="search"
          class="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          :placeholder="t('publishers.searchPlaceholder')"
          :aria-label="t('publishers.searchPlaceholder')"
          data-testid="publishers-search"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted-foreground" data-testid="publishers-total">{{ t('publishers.total', { count: total }) }}</span>
        <select
          class="select-field w-44"
          :aria-label="t('publishers.sortLabel')"
          :value="sortChoice"
          data-testid="publishers-sort"
          @change="handleSortChange"
        >
          <option v-for="choice in SORT_CHOICES" :key="choice" :value="choice">{{ t(`publishers.sort.${choice.replace(':', '_')}`) }}</option>
        </select>
      </div>
    </div>

    <div
      v-if="selected.size > 0"
      class="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-2 text-sm"
      data-testid="publishers-selection-bar"
    >
      <span class="text-muted-foreground">{{ t('publishers.selectedCount', { count: selected.size }) }}</span>
      <Button size="sm" :disabled="!canMerge || working" data-testid="publishers-merge" @click="handleMergeOpen">
        <Merge aria-hidden="true" />
        {{ t('publishers.merge') }}
      </Button>
      <Button size="sm" variant="ghost" @click="handleClearSelection">{{ t('publishers.clearSelection') }}</Button>
      <span v-if="!canMerge" class="text-xs text-muted-foreground">{{ t('publishers.mergeHint') }}</span>
    </div>

    <main class="flex-1 overflow-y-auto">
      <p v-if="failed" class="px-4 py-10 text-center text-sm text-muted-foreground">{{ t('publishers.errors.load') }}</p>
      <p v-else-if="loading && items.length === 0" class="px-4 py-10 text-center text-sm text-muted-foreground" role="status">
        {{ t('common.loading') }}
      </p>
      <div v-else-if="items.length === 0" class="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <Building2 class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p class="text-sm font-medium text-foreground">{{ t('publishers.empty') }}</p>
      </div>
      <ul v-else class="divide-y divide-border/60">
        <li v-for="item in items" :key="item.name" class="flex items-center gap-3 px-4 py-2 hover:bg-muted/40" data-testid="publisher-row">
          <input
            type="checkbox"
            class="rounded-xs accent-primary"
            :checked="isSelected(item)"
            :aria-label="t('publishers.select', { name: item.name })"
            @change="toggleSelected(item)"
          />
          <button class="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline" @click="openPublisher(item)">
            {{ item.name }}
          </button>
          <span class="shrink-0 text-xs text-muted-foreground">{{ t('publishers.bookCount', { count: item.bookCount }) }}</span>
          <Button
            size="sm"
            variant="ghost"
            class="shrink-0"
            :aria-label="t('publishers.renameNamed', { name: item.name })"
            @click="startRename(item)"
          >
            <Pencil aria-hidden="true" />
            <span class="max-sm:hidden">{{ t('publishers.rename') }}</span>
          </Button>
        </li>
      </ul>
    </main>

    <div v-if="pageCount > 1" class="flex items-center justify-between border-t border-border/70 px-4 py-2 text-sm">
      <Button size="sm" variant="outline" :disabled="page <= 1 || loading" @click="handlePreviousPage">{{ t('publishers.previous') }}</Button>
      <span class="text-xs text-muted-foreground">{{ t('publishers.pageOf', { page: formatNumber(page), pages: formatNumber(pageCount) }) }}</span>
      <Button size="sm" variant="outline" :disabled="page >= pageCount || loading" @click="handleNextPage">{{ t('publishers.next') }}</Button>
    </div>

    <RenameModal
      v-if="renameTarget"
      :current-name="renameTarget.name"
      :loading="working"
      @confirm="handleRenameConfirm"
      @cancel="handleRenameCancel"
    />
    <BrowseMergeModal v-if="showMerge" :items="selectedItems" :loading="working" @confirm="handleMergeConfirm" @cancel="handleMergeCancel" />
  </div>
</template>
