<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookPlus, Loader2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookDockFile, BookDockFinalizeFileResult } from '@bookorbit/types'

import { useBookDestination } from '@/features/library/composables/useBookDestination'
import { useBookDockFinalize } from '../composables/useBookDockFinalize'
import { joinErrorMessageKey, type BookDockJoinChoice } from '../composables/useBookDockJoinChoices'
import BookDockJoinBookPicker from './BookDockJoinBookPicker.vue'

/**
 * Fork: adds the selected docked files to a book already in a library, straight from the selection
 * bar. It is the same join the file dialog offers per file, applied to every selected file at once.
 */
const props = defineProps<{ files: BookDockFile[] }>()
const emit = defineEmits<{ close: []; added: [] }>()

const { t } = useI18n()
const destination = useBookDestination()
const { libraries, fetchLibraries } = destination
const { finalize, loading, result: finalizeResult, error: finalizeError } = useBookDockFinalize()

/** Only a library that keeps one book per folder can take another format into a book's folder. */
const joinableLibraries = computed(() => libraries.value.filter((library) => library.organizationMode === 'book_per_folder'))
const libraryId = ref<number | null>(null)
const chosen = ref<BookDockJoinChoice | null>(null)
const failures = ref<BookDockFinalizeFileResult[]>([])
const addedCount = ref(0)

const pickerLabel = computed(() =>
  props.files.length === 1 ? props.files[0]!.fileName : t('bookDock.addToBook.selectedFiles', { count: props.files.length }),
)
const chosenTitle = computed(() => chosen.value?.title || t('book.untitled'))

/** The files' own destination when they share one that can take a join, else the first library that can. */
function defaultLibraryId(): number | null {
  const targets = new Set(props.files.map((file) => file.targetLibraryId ?? null))
  const [shared] = targets
  if (targets.size === 1 && shared != null && joinableLibraries.value.some((library) => library.id === shared)) return shared ?? null
  return joinableLibraries.value[0]?.id ?? null
}

watch(
  joinableLibraries,
  () => {
    if (libraryId.value === null) libraryId.value = defaultLibraryId()
  },
  { immediate: true },
)

onMounted(() => {
  void fetchLibraries()
})

function handleLibraryChange(event: Event): void {
  libraryId.value = Number((event.target as HTMLSelectElement).value)
  chosen.value = null
}

function handlePick(book: BookDockJoinChoice): void {
  chosen.value = book
}

function handleBack(): void {
  chosen.value = null
  failures.value = []
}

function handleClose(): void {
  if (addedCount.value > 0) emit('added')
  else emit('close')
}

function failureText(failure: BookDockFinalizeFileResult): string {
  if (failure.errorCode) return t(joinErrorMessageKey(failure.errorCode), { title: chosenTitle.value })
  return failure.message || t('bookDock.addToBook.failed')
}

async function handleAdd(): Promise<void> {
  if (!chosen.value || libraryId.value === null) return
  const fileIds = props.files.map((file) => file.id)
  await finalize({
    fileIds,
    overrides: fileIds.map((fileId) => ({ fileId, libraryId: libraryId.value!, joinBook: { bookId: chosen.value!.bookId } })),
  })
  const result = finalizeResult.value
  if (!result) {
    toast.error(finalizeError.value || t('bookDock.addToBook.failed'))
    return
  }
  addedCount.value += result.succeeded
  failures.value = result.results.filter((entry) => !entry.success)
  if (failures.value.length === 0) {
    toast.success(t('bookDock.addToBook.added', { count: result.succeeded, title: chosenTitle.value }))
    emit('added')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-scrim" @click="handleClose" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-dock-add-to-book-title"
        class="relative z-10 w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        data-testid="book-dock-add-to-book-dialog"
      >
        <div class="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="book-dock-add-to-book-title" class="text-base font-semibold text-foreground">
            {{ t('bookDock.addToBook.title', { count: files.length }) }}
          </h2>
          <button
            type="button"
            :aria-label="t('common.close')"
            class="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            @click="handleClose"
          >
            <X class="size-4" />
          </button>
        </div>

        <div class="max-h-[min(76vh,40rem)] space-y-4 overflow-y-auto px-5 py-4">
          <p v-if="joinableLibraries.length === 0" class="text-sm text-muted-foreground" data-testid="book-dock-add-to-book-none">
            {{ t('bookDock.addToBook.noLibrary') }}
          </p>

          <template v-else-if="!chosen">
            <div v-if="joinableLibraries.length > 1" class="space-y-1.5">
              <label for="book-dock-add-to-book-library" class="text-xs font-medium text-muted-foreground">{{
                t('bookDock.addToBook.library')
              }}</label>
              <select
                id="book-dock-add-to-book-library"
                class="select-field w-full"
                :value="libraryId ?? undefined"
                data-testid="book-dock-add-to-book-library"
                @change="handleLibraryChange"
              >
                <option v-for="library in joinableLibraries" :key="library.id" :value="library.id">{{ library.name }}</option>
              </select>
            </div>
            <BookDockJoinBookPicker
              v-if="libraryId !== null"
              :key="libraryId"
              :library-id="libraryId"
              :file-name="pickerLabel"
              @pick="handlePick"
              @cancel="handleClose"
            />
          </template>

          <template v-else>
            <p class="text-sm text-foreground" data-testid="book-dock-add-to-book-confirm">
              {{ t('bookDock.addToBook.confirm', { count: files.length, title: chosenTitle }) }}
            </p>
            <p class="text-xs text-muted-foreground">{{ t('bookDock.addToBook.confirmHint') }}</p>
            <ul
              v-if="failures.length > 0"
              class="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
              data-testid="book-dock-add-to-book-failures"
            >
              <li v-if="addedCount > 0" class="text-foreground">{{ t('bookDock.addToBook.partial', { count: addedCount }) }}</li>
              <li v-for="failure in failures" :key="failure.fileId">
                <span class="font-medium text-foreground">{{ failure.fileName }}</span>
                <span class="text-muted-foreground"> · {{ failureText(failure) }}</span>
              </li>
            </ul>
          </template>
        </div>

        <div v-if="chosen" class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            class="inline-flex h-8 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :disabled="loading"
            @click="handleBack"
          >
            {{ t('bookDock.addToBook.back') }}
          </button>
          <button
            v-if="failures.length === 0"
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="loading"
            data-testid="book-dock-add-to-book-submit"
            @click="handleAdd"
          >
            <Loader2 v-if="loading" class="size-3.5 animate-spin" aria-hidden="true" />
            <BookPlus v-else class="size-3.5" aria-hidden="true" />
            {{ t('bookDock.addToBook.submit', { title: chosenTitle }) }}
          </button>
          <button
            v-else
            type="button"
            class="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            @click="handleClose"
          >
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
