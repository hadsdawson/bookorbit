<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Bookmark, X } from '@lucide/vue'
import type { BookRequestSavedView, BookRequestSavedViewFilters } from '@bookorbit/types'
import { BOOK_REQUEST_SAVED_VIEW_NAME_MAX_LENGTH } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { useRequestSavedViews } from '../composables/useRequestSavedViews'
import { savedViewFilters, savedViewPatch, type RequestListState } from '../requestListQuery'

const props = defineProps<{ state: RequestListState; showRequester: boolean }>()
const emit = defineEmits<{ apply: [patch: Partial<RequestListState>] }>()

const { t } = useI18n()
const saved = useRequestSavedViews()

const name = ref('')
const busy = ref(false)

onMounted(() => {
  void saved.load()
})

const current = computed(() => savedViewFilters(props.state))
const hasFilters = computed(() => Object.keys(current.value).length > 0)
const canSave = computed(() => !busy.value && hasFilters.value && name.value.trim().length > 0)

function canonical(filters: BookRequestSavedViewFilters): string {
  return JSON.stringify(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)))
}

function isActive(view: BookRequestSavedView): boolean {
  return canonical(view.filters) === canonical(current.value)
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function handleApply(event: Event) {
  const id = Number((event.currentTarget as HTMLElement).dataset.viewId)
  const view = saved.views.value.find((entry) => entry.id === id)
  if (view) emit('apply', savedViewPatch(view.filters, props.showRequester))
}

async function remove(id: number) {
  try {
    await saved.remove(id)
  } catch (error) {
    toast.error(failureMessage(error, t('bookRequests.savedViews.deleteFailed')))
  }
}

function handleRemove(event: Event) {
  void remove(Number((event.currentTarget as HTMLElement).dataset.viewId))
}

async function save() {
  if (!canSave.value) return
  busy.value = true
  try {
    const view = await saved.save(name.value.trim(), current.value)
    toast.success(t('bookRequests.savedViews.saved', { name: view.name }))
    name.value = ''
  } catch (error) {
    toast.error(failureMessage(error, t('bookRequests.savedViews.saveFailed')))
  } finally {
    busy.value = false
  }
}

function handleSave() {
  void save()
}
</script>

<template>
  <div class="space-y-2" data-testid="saved-views">
    <p class="block text-xs font-medium text-muted-foreground">{{ t('bookRequests.savedViews.title') }}</p>
    <ul v-if="saved.views.value.length > 0" class="max-h-36 space-y-0.5 overflow-y-auto">
      <li v-for="view in saved.views.value" :key="view.id" class="flex items-center gap-1">
        <button
          type="button"
          :data-view-id="view.id"
          class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-start text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :class="isActive(view) ? 'bg-primary/10 text-primary' : 'text-foreground'"
          :aria-pressed="isActive(view)"
          @click="handleApply"
        >
          <Bookmark :size="13" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ view.name }}</span>
        </button>
        <button
          type="button"
          :data-view-id="view.id"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t('bookRequests.savedViews.delete', { name: view.name })"
          @click="handleRemove"
        >
          <X :size="13" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <p v-else class="text-xs text-muted-foreground">{{ t('bookRequests.savedViews.empty') }}</p>
    <div class="flex items-center gap-1.5">
      <input
        v-model="name"
        type="text"
        class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :maxlength="BOOK_REQUEST_SAVED_VIEW_NAME_MAX_LENGTH"
        :placeholder="t('bookRequests.savedViews.namePlaceholder')"
        :aria-label="t('bookRequests.savedViews.nameLabel')"
        data-testid="saved-view-name"
        @keydown.enter="handleSave"
      />
      <Button size="sm" type="button" variant="outline" :disabled="!canSave" data-testid="saved-view-save" @click="handleSave">
        {{ t('bookRequests.savedViews.save') }}
      </Button>
    </div>
    <p v-if="!hasFilters" class="text-xs text-muted-foreground">{{ t('bookRequests.savedViews.needFilters') }}</p>
  </div>
</template>
