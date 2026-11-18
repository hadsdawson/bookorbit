<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import type { BookRequestTrackingChoice } from '@bookorbit/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  actionVariant,
  isDestructiveAction,
  type RowActPayload,
  type RowActionEntry,
  type RowActionModel,
  type RowTrackPayload,
  type SelectionHalf,
} from '../requestSelection'
import RequestTrackingChoiceItems from './RequestTrackingChoiceItems.vue'

/**
 * Every row's menu, single or pair: open, then decide, keep and remove, in that order on every
 * row and in the bulk bar. Items that do not apply are left out, the row's own button is never
 * repeated, and on a pair each item names the half it touches.
 */
const props = defineProps<{
  title: string
  halves: SelectionHalf[]
  model: RowActionModel
  busy: boolean
  /** Fork: the halves whose tracking this viewer may set; empty leaves the item out. */
  trackHalves?: SelectionHalf[]
}>()

const emit = defineEmits<{
  open: [id: number]
  act: [payload: RowActPayload]
  track: [payload: RowTrackPayload]
}>()

const { t } = useI18n()

const isPair = computed(() => props.halves.length > 1)

function openLabel(half: SelectionHalf): string {
  if (!isPair.value) return t('bookRequests.rowMenu.open')
  return half.mediaKind === 'audiobook' ? t('bookRequests.rowMenu.openAudiobook') : t('bookRequests.rowMenu.openEbook')
}

function entryLabel(entry: RowActionEntry): string {
  return t(`bookRequests.rowMenu.${entry.action}.${entry.variant}`)
}

function handleOpen(half: SelectionHalf) {
  emit('open', half.id)
}

function handleAct(entry: RowActionEntry) {
  emit('act', { action: entry.action, halves: entry.halves })
}

const trackTargets = computed(() => props.trackHalves ?? [])
const trackLabel = computed(() => t(`bookRequests.rowMenu.track.${actionVariant(props.halves, trackTargets.value)}`))

function handleTrack(trackingStatus: BookRequestTrackingChoice) {
  emit('track', { halves: trackTargets.value, trackingStatus })
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="shrink-0" :aria-label="t('bookRequests.rowMenu.label', { title })">
        <Ellipsis :size="16" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-44">
      <DropdownMenuItem v-for="half in halves" :key="half.id" @click="handleOpen(half)">{{ openLabel(half) }}</DropdownMenuItem>
      <template v-if="trackTargets.length > 0">
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger :disabled="busy">{{ trackLabel }}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="min-w-44">
            <RequestTrackingChoiceItems :disabled="busy" @pick="handleTrack" />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </template>
      <template v-for="(group, index) in model.groups" :key="index">
        <DropdownMenuSeparator />
        <DropdownMenuItem
          v-for="entry in group"
          :key="entry.action"
          :variant="isDestructiveAction(entry.action) ? 'destructive' : 'default'"
          :disabled="busy"
          @click="handleAct(entry)"
        >
          {{ entryLabel(entry) }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
