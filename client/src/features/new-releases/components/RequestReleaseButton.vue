<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookPlus, ChevronDown, Loader2 } from '@lucide/vue'
import type { NewReleaseItem, NewReleaseRequestFormat } from '@bookorbit/types'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{ item: NewReleaseItem; busy: boolean }>()
const emit = defineEmits<{ request: [item: NewReleaseItem, formats: NewReleaseRequestFormat[]] }>()

const { t } = useI18n()

/** Only formats with a confirmed date can be requested. */
const formats = computed<NewReleaseRequestFormat[]>(() => {
  const available: NewReleaseRequestFormat[] = []
  if (props.item.ebookDate) available.push('ebook')
  if (props.item.audiobookDate) available.push('audiobook')
  return available
})

const label = computed(() => t('newReleases.request.button'))
const ariaLabel = computed(() => t('newReleases.request.named', { title: props.item.title }))

function requestOnly() {
  emit('request', props.item, formats.value)
}

function requestEbook() {
  emit('request', props.item, ['ebook'])
}

function requestAudiobook() {
  emit('request', props.item, ['audiobook'])
}

function requestBoth() {
  emit('request', props.item, ['ebook', 'audiobook'])
}
</script>

<template>
  <DropdownMenu v-if="formats.length > 1">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        :aria-label="ariaLabel"
        :disabled="busy"
        data-testid="request-release"
      >
        <Loader2 v-if="busy" :size="13" class="animate-spin" aria-hidden="true" />
        <BookPlus v-else :size="13" aria-hidden="true" />
        {{ label }}
        <ChevronDown :size="12" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-44">
      <DropdownMenuItem data-testid="request-release-both" @select="requestBoth">{{ t('newReleases.request.both') }}</DropdownMenuItem>
      <DropdownMenuItem data-testid="request-release-ebook" @select="requestEbook">{{ t('newReleases.request.ebook') }}</DropdownMenuItem>
      <DropdownMenuItem data-testid="request-release-audiobook" @select="requestAudiobook">{{ t('newReleases.request.audiobook') }}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <button
    v-else-if="formats.length === 1"
    type="button"
    class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
    :aria-label="ariaLabel"
    :disabled="busy"
    data-testid="request-release"
    @click="requestOnly"
  >
    <Loader2 v-if="busy" :size="13" class="animate-spin" aria-hidden="true" />
    <BookPlus v-else :size="13" aria-hidden="true" />
    {{ label }}
  </button>
</template>
