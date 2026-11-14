<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookPlus, ChevronDown, Loader2 } from '@lucide/vue'
import type { NewReleaseFormat, NewReleaseItem, NewReleaseRequestFormat } from '@bookorbit/types'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{ item: NewReleaseItem; busy: boolean; defaultFormat: NewReleaseFormat }>()
const emit = defineEmits<{ request: [item: NewReleaseItem, formats: NewReleaseRequestFormat[]] }>()

const { t } = useI18n()

const defaultFormats = computed<NewReleaseRequestFormat[]>(() => (props.defaultFormat === 'both' ? ['ebook', 'audiobook'] : [props.defaultFormat]))
const label = computed(() => t(`newReleases.request.default.${props.defaultFormat}`))
const ariaLabel = computed(() => t('newReleases.request.named', { title: props.item.title }))
const otherAria = computed(() => t('newReleases.request.otherFormats', { title: props.item.title }))

function requestDefault() {
  emit('request', props.item, defaultFormats.value)
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
  <div class="inline-flex h-8 shrink-0 items-stretch rounded-md border border-input bg-background text-xs font-medium text-foreground">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-l-md px-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
      :aria-label="ariaLabel"
      :disabled="busy"
      data-testid="request-release"
      @click="requestDefault"
    >
      <Loader2 v-if="busy" :size="13" class="animate-spin" aria-hidden="true" />
      <BookPlus v-else :size="13" aria-hidden="true" />
      {{ label }}
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="inline-flex items-center rounded-r-md border-l border-input px-1.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          :aria-label="otherAria"
          :disabled="busy"
          data-testid="request-release-menu"
        >
          <ChevronDown :size="12" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-48">
        <DropdownMenuItem data-testid="request-release-both" @select="requestBoth">{{ t('newReleases.request.both') }}</DropdownMenuItem>
        <DropdownMenuItem data-testid="request-release-ebook" @select="requestEbook">
          {{ t('newReleases.request.ebook') }}
          <span v-if="!item.ebookDate" class="ms-auto text-[10px] text-muted-foreground">{{ t('newReleases.request.noDate') }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="request-release-audiobook" @select="requestAudiobook">
          {{ t('newReleases.request.audiobook') }}
          <span v-if="!item.audiobookDate" class="ms-auto text-[10px] text-muted-foreground">{{ t('newReleases.request.noDate') }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
