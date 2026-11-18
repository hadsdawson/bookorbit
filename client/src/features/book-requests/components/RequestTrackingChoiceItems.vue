<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { BookRequestTrackingChoice } from '@bookorbit/types'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { TRACKING_CHOICES, trackingChoiceKey } from '../requestSelection'

/** Fork: the tracking choices as menu items, shared by the row menu and both bulk bars. */
defineProps<{ disabled?: boolean }>()

const emit = defineEmits<{
  pick: [choice: BookRequestTrackingChoice]
}>()

const { t } = useI18n()

function handlePick(choice: BookRequestTrackingChoice) {
  emit('pick', choice)
}
</script>

<template>
  <DropdownMenuItem v-for="choice in TRACKING_CHOICES" :key="choice ?? 'none'" :disabled="disabled" @click="handlePick(choice)">
    {{ t(trackingChoiceKey(choice)) }}
  </DropdownMenuItem>
</template>
