<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Check, Copy } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { copyToClipboard } from '@/lib/clipboard'

/** Fork: a small button that copies one piece of text, such as a request's title or author. */
const props = withDefaults(defineProps<{ text: string; label: string; size?: number }>(), { size: 13 })

const { t } = useI18n()
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null

async function handleCopy(event: MouseEvent): Promise<void> {
  // Rows open their request on click; copying should not.
  event.stopPropagation()
  if (!(await copyToClipboard(props.text))) {
    toast.error(t('bookRequests.copy.failed'))
    return
  }
  copied.value = true
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => (copied.value = false), 1_500)
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})
</script>

<template>
  <button
    type="button"
    class="inline-flex shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
    :title="copied ? t('bookRequests.copy.copied') : label"
    :aria-label="label"
    data-testid="copy-text"
    @click="handleCopy"
  >
    <Check v-if="copied" :size="size" class="text-success" aria-hidden="true" />
    <Copy v-else :size="size" aria-hidden="true" />
    <span class="sr-only" aria-live="polite">{{ copied ? t('bookRequests.copy.copied') : '' }}</span>
  </button>
</template>
