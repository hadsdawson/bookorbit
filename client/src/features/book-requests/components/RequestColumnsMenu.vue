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
import { LOCKED_COLUMNS, useRequestTableColumns, type RequestTableColumn } from '../composables/useRequestTableColumns'

const { t } = useI18n()
const columns = useRequestTableColumns()

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

function resetColumns() {
  columns.reset()
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" size="sm">
        <Columns3 :size="14" aria-hidden="true" />
        {{ t('bookRequests.columns.button') }}
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
      <DropdownMenuItem :disabled="!columns.isCustomized.value" @select="resetColumns">
        {{ t('bookRequests.columns.reset') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
