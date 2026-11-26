<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from '@lucide/vue'
import type { BookPendingSeries } from '@bookorbit/types'

/** Fork. Series names this book was given that match more than one series and wait for a pick. */
const props = defineProps<{ pending: BookPendingSeries[] }>()
const emit = defineEmits<{ choose: [] }>()

const { t } = useI18n()

const names = computed(() =>
  props.pending
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((entry) => (entry.seriesIndex ? `${entry.seriesName} #${entry.seriesIndex}` : entry.seriesName))
    .join(', '),
)

function handleChoose() {
  emit('choose')
}
</script>

<template>
  <button
    v-if="pending.length > 0"
    type="button"
    class="inline-flex max-w-full items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-left text-xs font-medium text-warning transition-colors hover:bg-warning/25"
    :title="t('book.detail.seriesMembership.pending.hint')"
    data-testid="pending-series-notice"
    @click="handleChoose"
  >
    <TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="truncate">{{ t('book.detail.seriesMembership.pending.label', { names }) }}</span>
  </button>
</template>
