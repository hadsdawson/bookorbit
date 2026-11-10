<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Combine, Loader2, X } from '@lucide/vue'
import { isAudioFormat, type BookDockCombineResult, type BookDockFile } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useBookDestination } from '@/features/library/composables/useBookDestination'
import BookDestinationFields from '@/features/library/components/BookDestinationFields.vue'

const { t } = useI18n()

const props = defineProps<{
  files: BookDockFile[]
}>()

const emit = defineEmits<{
  close: []
  combined: []
}>()

const destination = useBookDestination({ defaultToFirstLibrary: true })
const { libraryId, folderId, hasDestination, fetchLibraries } = destination

function extensionOf(file: BookDockFile): string {
  const dot = file.fileName.lastIndexOf('.')
  return dot > 0 ? file.fileName.slice(dot + 1).toLowerCase() : ''
}

function isAudio(file: BookDockFile): boolean {
  const extension = extensionOf(file)
  return extension !== '' && isAudioFormat(extension)
}

/** Matches the server's own default, so the choice shown is the one that happens if left alone. */
const primaryFileId = ref<number>(props.files.find((file) => extensionOf(file) !== '' && !isAudio(file))?.id ?? props.files[0]?.id ?? 0)
const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<BookDockCombineResult | null>(null)

const failures = computed(() => result.value?.results.filter((entry) => !entry.success) ?? [])

const primaryTitle = computed(() => {
  const primary = props.files.find((file) => file.id === primaryFileId.value)
  return primary?.selectedMetadata?.title || primary?.fileName || ''
})

/** A file headed somewhere of its own needs no default, so the picker shows only when one is missing. */
const needsDestination = computed(() => props.files.some((file) => file.id === primaryFileId.value && file.targetFolderId == null))
const canSubmit = computed(() => props.files.length >= 2 && !loading.value && (!needsDestination.value || hasDestination.value))

onMounted(() => {
  void fetchLibraries()
})

function choosePrimary(fileId: number) {
  primaryFileId.value = fileId
}

async function submit() {
  if (!canSubmit.value) return
  loading.value = true
  error.value = null
  try {
    const res = await api('/api/v1/book-dock/combine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileIds: props.files.map((file) => file.id),
        primaryFileId: primaryFileId.value,
        ...(needsDestination.value && libraryId.value != null && folderId.value != null
          ? { defaultLibraryId: libraryId.value, defaultFolderId: folderId.value }
          : {}),
      }),
    })
    if (res.ok) {
      result.value = await res.json()
    } else {
      const body = await res.json().catch(() => null)
      error.value = (body as { message?: string } | null)?.message ?? t('bookDock.errorStatus', { status: res.status })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('bookDock.combine.failed')
  } finally {
    loading.value = false
  }
}

function handleClose() {
  if (result.value) emit('combined')
  else emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-scrim" @click="handleClose" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-dock-combine-title"
        class="relative z-10 w-full max-w-md mx-4 bg-card border border-border rounded-lg shadow-2xl overflow-hidden"
      >
        <div class="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 id="book-dock-combine-title" class="text-base font-semibold text-foreground">
            {{ result ? t('bookDock.combine.resultTitle') : t('bookDock.combine.title', { count: files.length }) }}
          </h2>
          <button
            type="button"
            :aria-label="t('common.close')"
            class="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            @click="handleClose"
          >
            <X class="size-4" />
          </button>
        </div>

        <div v-if="!result" class="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <p class="text-xs text-muted-foreground">{{ t('bookDock.combine.instructions') }}</p>

          <fieldset class="space-y-1.5">
            <legend class="text-xs font-medium text-muted-foreground mb-1">{{ t('bookDock.combine.primaryLabel') }}</legend>
            <label
              v-for="file in files"
              :key="file.id"
              class="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              :class="file.id === primaryFileId ? 'border-primary/60 bg-primary/5' : ''"
            >
              <input
                type="radio"
                name="book-dock-combine-primary"
                class="accent-primary"
                :checked="file.id === primaryFileId"
                @change="choosePrimary(file.id)"
              />
              <span class="min-w-0 flex-1 truncate">{{ file.fileName }}</span>
              <span class="shrink-0 text-xs uppercase text-muted-foreground">{{ extensionOf(file) || t('bookDock.combine.folder') }}</span>
            </label>
            <p class="text-xs text-muted-foreground">{{ t('bookDock.combine.primaryHint', { title: primaryTitle }) }}</p>
          </fieldset>

          <BookDestinationFields
            v-if="needsDestination"
            :destination="destination"
            :library-label="t('bookDock.finalizeDialog.defaultDestinationLibrary')"
            :folder-label="t('bookDock.finalizeDialog.defaultDestinationFolder')"
          />

          <p class="text-xs text-muted-foreground">{{ t('bookDock.combine.libraryNote') }}</p>

          <p v-if="error" role="alert" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ error }}</p>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button type="button" class="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-all" @click="handleClose">
              {{ t('common.cancel') }}
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              :disabled="!canSubmit"
              @click="submit"
            >
              <Loader2 v-if="loading" class="size-3.5 animate-spin" />
              <Combine v-else class="size-3.5" />
              {{ t('bookDock.combine.submit') }}
            </button>
          </div>
        </div>

        <div v-else class="px-5 py-4 space-y-4">
          <div class="rounded-lg p-3" :class="result.failed === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'">
            <p class="text-sm font-medium">
              {{
                result.failed === 0
                  ? t('bookDock.combine.done', { count: result.succeeded })
                  : t('bookDock.combine.partial', { done: result.succeeded, total: result.total })
              }}
            </p>
            <ul v-if="result.failed > 0" class="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li v-for="item in failures" :key="item.fileId">{{ item.fileName }}: {{ item.message }}</li>
            </ul>
          </div>
          <div class="flex justify-end">
            <button
              type="button"
              class="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95"
              @click="handleClose"
            >
              {{ t('bookDock.done') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
