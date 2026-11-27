<script setup lang="ts">
/**
 * Fork. The match badge, with the working behind its score on hover, or on tap where there is no
 * hover. Opens on click as well so a touch screen can reach it, and stops the click there so it
 * does not also open the row.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookDockConfidenceBreakdown, BookDockConfidencePart } from '@bookorbit/types'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

const props = defineProps<{
  confidence: number
  breakdown: BookDockConfidenceBreakdown | null | undefined
  badgeClass: string
  /** Hidden on narrow rows when a hold chip already says enough; mirrors the row's own attribute. */
  narrowHidden?: boolean
}>()

const { t } = useI18n()
const open = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | null = null

const parts = computed<BookDockConfidencePart[]>(() => (props.breakdown?.kind === 'fields' ? props.breakdown.parts : []))
const isbnSentence = computed(() => {
  if (props.breakdown?.kind !== 'isbn') return null
  return t(`bookDock.layout.row.matchBreakdown.${props.breakdown.match}`)
})
const anyNotCompared = computed(() => parts.value.some((part) => !part.compared))

function cancelClose() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}

function handleEnter() {
  cancelClose()
  open.value = true
}

/** A short delay, so moving the pointer from the badge onto the card does not close it. */
function handleLeave() {
  cancelClose()
  closeTimer = setTimeout(() => {
    open.value = false
  }, 150)
}

function handleClick(event: MouseEvent) {
  event.stopPropagation()
  cancelClose()
  open.value = !open.value
}

function handleOpenChange(value: boolean) {
  open.value = value
}

function fieldLabel(part: BookDockConfidencePart) {
  return t(`bookDock.layout.row.matchBreakdown.fields.${part.field}`)
}
</script>

<template>
  <Popover :open="open" @update:open="handleOpenChange">
    <PopoverAnchor as-child>
      <button
        type="button"
        class="inline-flex cursor-help items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        :class="badgeClass"
        :data-narrow-hidden="narrowHidden ? '1' : undefined"
        :aria-expanded="open"
        :aria-label="t('bookDock.layout.row.matchBreakdown.show', { percent: confidence })"
        @mouseenter="handleEnter"
        @mouseleave="handleLeave"
        @click="handleClick"
      >
        {{ t('bookDock.layout.row.match', { percent: confidence }) }}
      </button>
    </PopoverAnchor>
    <PopoverContent class="w-64 p-3 text-xs" side="top" align="start" @mouseenter="handleEnter" @mouseleave="handleLeave">
      <p class="mb-2 font-semibold text-foreground">{{ t('bookDock.layout.row.matchBreakdown.title') }}</p>

      <p v-if="isbnSentence" class="text-muted-foreground" data-testid="match-breakdown-isbn">{{ isbnSentence }}</p>

      <template v-else-if="parts.length > 0">
        <table class="w-full tabular-nums" data-testid="match-breakdown-fields">
          <tbody>
            <tr v-for="part in parts" :key="part.field">
              <td class="py-0.5 text-muted-foreground">{{ fieldLabel(part) }}</td>
              <td class="py-0.5 text-right text-foreground">
                <span v-if="part.compared">{{ t('bookDock.layout.row.matchBreakdown.points', { points: part.points, max: part.max }) }}</span>
                <span v-else class="text-muted-foreground">{{ t('bookDock.layout.row.matchBreakdown.notCompared') }}</span>
              </td>
            </tr>
            <tr class="border-t border-border">
              <td class="pt-1 font-semibold text-foreground">{{ t('bookDock.layout.row.matchBreakdown.total') }}</td>
              <td class="pt-1 text-right font-semibold text-foreground">{{ confidence }}%</td>
            </tr>
          </tbody>
        </table>
        <p v-if="anyNotCompared" class="mt-2 text-muted-foreground">{{ t('bookDock.layout.row.matchBreakdown.notComparedHint') }}</p>
      </template>

      <p v-else class="text-muted-foreground">{{ t('bookDock.layout.row.matchBreakdown.unavailable') }}</p>

      <p v-if="confidence < 85" class="mt-2 text-muted-foreground">{{ t('bookDock.layout.row.matchBreakdown.weakNote') }}</p>
    </PopoverContent>
  </Popover>
</template>
