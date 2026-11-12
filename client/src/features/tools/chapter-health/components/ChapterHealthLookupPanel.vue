<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Search } from '@lucide/vue'
import { CHAPTER_RUNTIME_TOLERANCE, type ChapterAutoApplySettings, type ChapterLookupQueueState } from '@bookorbit/types'

import { Button } from '@/components/ui/button'

const props = defineProps<{
  lookup: ChapterLookupQueueState | null
  /** Books with an ASIN in the category shown. */
  candidates: number
  selectedCount: number
  canLookUp: boolean
  busy: boolean
  autoApply?: ChapterAutoApplySettings | null
  savingTolerance?: boolean
}>()

const emit = defineEmits<{ lookUp: []; cancel: []; clearFinished: []; saveTolerance: [seconds: number] }>()

const { t } = useI18n()

const active = computed(() => Boolean(props.lookup && (props.lookup.queued > 0 || props.lookup.processing)))
const finishedTotal = computed(() => (props.lookup ? Object.values(props.lookup.finished).reduce((sum, count) => sum + count, 0) : 0))
/** Clear keeps the reviews still waiting, so it is only offered while something else finished. */
const clearable = computed(() => (props.lookup ? finishedTotal.value - props.lookup.finished.review : 0))
const actionLabel = computed(() =>
  props.selectedCount > 0
    ? t('tools.chapterHealth.lookup.lookUpSelected', { count: props.selectedCount })
    : t('tools.chapterHealth.lookup.lookUpCategory', { count: props.candidates }),
)
const actionDisabled = computed(() => props.busy || !props.canLookUp || (props.selectedCount === 0 && props.candidates === 0))
const current = computed(() =>
  props.lookup?.processing
    ? t('tools.chapterHealth.lookup.current', { title: props.lookup.processing.title ?? t('tools.chapterHealth.untitled') })
    : null,
)

const toleranceDraft = ref<number | null>(null)
watch(
  () => props.autoApply?.runtimeToleranceSeconds,
  (seconds) => {
    toleranceDraft.value = seconds ?? null
  },
  { immediate: true },
)
const toleranceChanged = computed(
  () =>
    toleranceDraft.value !== null &&
    props.autoApply !== null &&
    props.autoApply !== undefined &&
    toleranceDraft.value !== props.autoApply.runtimeToleranceSeconds,
)

function handleToleranceInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  toleranceDraft.value = Math.min(CHAPTER_RUNTIME_TOLERANCE.maxSeconds, Math.max(CHAPTER_RUNTIME_TOLERANCE.minSeconds, Math.round(value * 10) / 10))
}
function handleSaveTolerance(): void {
  if (toleranceDraft.value !== null) emit('saveTolerance', toleranceDraft.value)
}
function handleLookUp(): void {
  emit('lookUp')
}
function handleCancel(): void {
  emit('cancel')
}
function handleClear(): void {
  emit('clearFinished')
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" :aria-label="t('tools.chapterHealth.lookup.title')">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 max-w-2xl space-y-1">
        <h2 class="text-sm font-semibold text-foreground">{{ t('tools.chapterHealth.lookup.title') }}</h2>
        <p class="text-sm text-muted-foreground">{{ t('tools.chapterHealth.lookup.description') }}</p>
      </div>
      <Button v-if="canLookUp" size="sm" :disabled="actionDisabled" @click="handleLookUp">
        <Loader2 v-if="busy" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <Search v-else aria-hidden="true" />
        {{ actionLabel }}
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" role="status">
      <template v-if="active">
        <span class="flex items-center gap-2 text-foreground">
          <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('tools.chapterHealth.lookup.waiting', { count: lookup!.queued }) }}
        </span>
        <span v-if="current" class="min-w-0 truncate text-muted-foreground">{{ current }}</span>
        <Button variant="ghost" size="sm" @click="handleCancel">{{ t('tools.chapterHealth.lookup.stop') }}</Button>
      </template>
      <span v-else class="text-muted-foreground">{{ t('tools.chapterHealth.lookup.idle') }}</span>
      <template v-if="finishedTotal > 0 && lookup">
        <span class="text-muted-foreground">
          {{
            t('tools.chapterHealth.lookup.finished', {
              applied: lookup.finished.applied,
              review: lookup.finished.review,
              notFound: lookup.finished.not_found,
              failed: lookup.finished.failed,
            })
          }}
        </span>
        <Button v-if="clearable > 0" variant="ghost" size="sm" @click="handleClear">{{ t('tools.chapterHealth.lookup.clear') }}</Button>
      </template>
    </div>

    <div v-if="autoApply" class="border-t border-border pt-3">
      <div v-if="autoApply.canEdit" class="flex flex-wrap items-center gap-2 text-sm">
        <label for="chapter-runtime-tolerance" class="text-foreground">{{ t('tools.chapterHealth.lookup.tolerance.label') }}</label>
        <input
          id="chapter-runtime-tolerance"
          type="number"
          class="input-field w-20"
          :min="CHAPTER_RUNTIME_TOLERANCE.minSeconds"
          :max="CHAPTER_RUNTIME_TOLERANCE.maxSeconds"
          step="0.5"
          :value="toleranceDraft ?? ''"
          @change="handleToleranceInput"
        />
        <span class="text-muted-foreground">{{ t('tools.chapterHealth.lookup.tolerance.seconds') }}</span>
        <Button v-if="toleranceChanged" size="sm" variant="outline" :disabled="savingTolerance" @click="handleSaveTolerance">
          <Loader2 v-if="savingTolerance" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('tools.chapterHealth.lookup.tolerance.save') }}
        </Button>
      </div>
      <p v-else class="text-sm text-muted-foreground">
        {{ t('tools.chapterHealth.lookup.tolerance.readOnly', { seconds: autoApply.runtimeToleranceSeconds }) }}
      </p>
      <p v-if="autoApply.canEdit" class="mt-1 max-w-2xl text-xs text-muted-foreground">{{ t('tools.chapterHealth.lookup.tolerance.hint') }}</p>
    </div>
  </section>
</template>
