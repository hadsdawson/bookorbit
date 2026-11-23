<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderInput, Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { toast } from 'vue-sonner'
import type { LibraryFolder } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/i18n/formatters'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryFolderRelocation } from '../composables/useLibraryFolderRelocation'

const props = defineProps<{ libraryId: number; libraryName: string; folder: LibraryFolder }>()
const emit = defineEmits<{ close: []; relocated: [] }>()

const { t } = useI18n()
const { refreshLibraries } = useLibraries()
const relocation = useLibraryFolderRelocation(props.libraryId, props.folder.id)
const { preview, checking, applying, error } = relocation

const newPath = ref('')
const trimmedPath = computed(() => newPath.value.trim())
const busy = computed(() => checking.value || applying.value)
const canCheck = computed(() => trimmedPath.value.length > 0 && !busy.value)
const canApply = computed(() => preview.value?.canApply === true && preview.value.newPath !== '' && !busy.value)

watch(newPath, () => relocation.reset())

function handleOpenChange(open: boolean) {
  if (!open && !applying.value) emit('close')
}

function handleCheck() {
  void relocation.check(trimmedPath.value)
}

async function handleApply() {
  if (!preview.value) return
  if (!(await relocation.apply(preview.value.newPath))) return
  toast.success(t('settings.admin.libraries.relocate.done'))
  void refreshLibraries()
  emit('relocated')
  emit('close')
}

function handleCancel() {
  emit('close')
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <FolderInput class="size-5 text-primary" aria-hidden="true" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground">{{ t('settings.admin.libraries.relocate.title') }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              {{ t('settings.admin.libraries.relocate.body', { name: libraryName }) }}
            </DialogDescription>
          </div>
        </div>

        <dl class="mt-5 space-y-3 text-sm">
          <div>
            <dt class="text-xs font-medium text-muted-foreground">{{ t('settings.admin.libraries.relocate.current') }}</dt>
            <dd class="mt-1 break-all font-mono text-xs text-foreground" dir="ltr">{{ folder.path }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-muted-foreground">
              <label for="relocate-new-path">{{ t('settings.admin.libraries.relocate.newLocation') }}</label>
            </dt>
            <dd class="mt-1">
              <Input
                id="relocate-new-path"
                v-model="newPath"
                class="font-mono text-xs"
                dir="ltr"
                autocomplete="off"
                :disabled="applying"
                :placeholder="t('settings.admin.libraries.relocate.placeholder')"
              />
            </dd>
          </div>
        </dl>

        <p class="mt-3 text-xs text-muted-foreground">{{ t('settings.admin.libraries.relocate.copyFirst') }}</p>

        <div v-if="checking" class="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('settings.admin.libraries.relocate.checking') }}
        </div>

        <div v-else-if="preview" class="mt-4 rounded-md border border-border bg-background/60 p-3 text-sm" role="status" aria-live="polite">
          <p class="font-medium text-foreground">
            {{
              t('settings.admin.libraries.relocate.summary', {
                books: formatNumber(preview.bookCount),
                files: formatNumber(preview.fileCount),
                found: formatNumber(preview.filesFound),
              })
            }}
          </p>
          <ul class="mt-2 list-disc space-y-1 ps-5 text-foreground">
            <li v-if="preview.filesMissing > 0" class="text-destructive">
              {{ t('settings.admin.libraries.relocate.missing', { count: formatNumber(preview.filesMissing) }) }}
            </li>
            <li v-if="preview.filesWrongSize > 0" class="text-destructive">
              {{ t('settings.admin.libraries.relocate.wrongSize', { count: formatNumber(preview.filesWrongSize) }) }}
            </li>
            <li v-if="preview.pathConflicts > 0" class="text-destructive">
              {{ t('settings.admin.libraries.relocate.conflicts', { count: formatNumber(preview.pathConflicts) }) }}
            </li>
            <li v-if="preview.filesNewerOrOlder > 0">
              {{ t('settings.admin.libraries.relocate.timesDiffer', { count: formatNumber(preview.filesNewerOrOlder) }) }}
            </li>
            <li v-if="preview.canApply">{{ t('settings.admin.libraries.relocate.ready') }}</li>
          </ul>
          <ul v-if="preview.sampleProblems.length > 0" class="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
            <li v-for="problem in preview.sampleProblems" :key="problem" class="break-all">{{ problem }}</li>
          </ul>
        </div>

        <p v-if="error" class="mt-4 text-sm text-destructive" role="alert">{{ error }}</p>

        <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" :disabled="applying" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button variant="outline" :disabled="!canCheck" @click="handleCheck">{{ t('settings.admin.libraries.relocate.preview') }}</Button>
          <Button :disabled="!canApply" @click="handleApply">
            <Loader2 v-if="applying" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ t('settings.admin.libraries.relocate.apply') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
