<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Columns3 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useRequestFormatText } from '../composables/useRequestFormatText'
import { LOCKED_COLUMNS, useRequestTableColumns, type RequestTableColumn } from '../composables/useRequestTableColumns'

const { t } = useI18n()
const columns = useRequestTableColumns()
const { shown: formatTextShown, setShown: setFormatTextShown } = useRequestFormatText()

function isLocked(column: RequestTableColumn): boolean {
  return LOCKED_COLUMNS.includes(column)
}

function toggle(column: RequestTableColumn) {
  columns.setVisible(column, !columns.isVisible(column))
}

/** Ticking several columns in a row is the usual case, so the menu stays open between them. */
function keepOpen(event: Event) {
  event.preventDefault()
}

function toggleFormatText() {
  setFormatTextShown(!formatTextShown.value)
}

function resetColumns() {
  columns.reset()
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" type="button" class="hidden h-9 gap-1.5 px-2.5 xl:inline-flex" :aria-label="t('bookRequests.columns.button')">
        <Columns3 :size="15" aria-hidden="true" />
        <span class="max-2xl:sr-only">{{ t('bookRequests.columns.button') }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuCheckboxItem
        v-for="column in columns.orderedColumns.value"
        :key="column"
        :model-value="columns.isVisible(column)"
        :disabled="isLocked(column)"
        @select="keepOpen"
        @update:model-value="toggle(column)"
      >
        {{ t(`bookRequests.columns.${column}`) }}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem :model-value="formatTextShown" @select="keepOpen" @update:model-value="toggleFormatText">
        {{ t('bookRequests.columns.showFormatText') }}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem :disabled="!columns.isCustomized.value" @select="resetColumns">
        {{ t('bookRequests.columns.reset') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
