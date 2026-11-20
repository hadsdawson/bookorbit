<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize } from '@vueuse/core'
import { ArrowDown, ArrowUp, ChevronsUpDown, ExternalLink, GripVertical, Zap } from '@lucide/vue'
import type {
  BookRequestItem,
  BookRequestProgressEvent,
  BookRequestSortDirection,
  BookRequestSortField,
  BookRequestTrackingChoice,
} from '@bookorbit/types'
import { formatDate, formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { useUiTextScale } from '@/lib/ui-text-scale'
import type { RequestListDensity } from '../composables/useRequestListDensity'
import { useRequestFormatText } from '../composables/useRequestFormatText'
import {
  BOOK_MIN_WIDTH,
  MIN_COLUMN_WIDTH,
  REQUEST_TABLE_COLUMNS,
  REQUESTED_WITH_REQUESTER_WIDTH,
  SELECT_COLUMN_WIDTH,
  useRequestTableColumns,
  type RequestTableColumn,
} from '../composables/useRequestTableColumns'
import { canTrackRequest } from '../requestActions'
import { requestBookCoverSources } from '../requestBookCover'
import { requestMediaColor, requestMediaIcon } from '../requestMedia'
import { orderedHalves, rowRequests } from '../requestPair'
import { requestFailureText, requestOutcome } from '../requestOutcome'
import { currentRequestProgress, requestPresentationStatus } from '../requestPipeline'
import {
  rowActionModel,
  rowSelectionHalves,
  trackingReaches,
  type RequestViewer,
  type RowActPayload,
  type RowActionModel,
  type RowStep,
  type RowTrackPayload,
  type SelectionHalf,
} from '../requestSelection'
import CopyTextButton from './CopyTextButton.vue'
import RequestCover from './RequestCover.vue'
import RequestNextStepButton from './RequestNextStepButton.vue'
import RequestPairCover from './RequestPairCover.vue'
import RequestRowMenu from './RequestRowMenu.vue'
import RequestStatusBadge from './RequestStatusBadge.vue'
import RequestTrackingStatusSelect from './RequestTrackingStatusSelect.vue'

const props = defineProps<{
  requests: BookRequestItem[]
  viewer: RequestViewer
  /** Only the approver queue has more than one requester, so only it spends a column on them. */
  showRequester: boolean
  /** Every request with an action in flight, so two rows acted on at once each stay disabled. */
  busyIds: ReadonlySet<number>
  progressByRequest: Record<number, BookRequestProgressEvent | undefined>
  density: RequestListDensity
  sortBy: BookRequestSortField
  sortDir: BookRequestSortDirection
  selectedRowIds: ReadonlySet<number>
  pageSelection: 'none' | 'some' | 'all'
}>()

const emit = defineEmits<{
  open: [id: number]
  act: [payload: RowActPayload, row: BookRequestItem]
  step: [step: RowStep, row: BookRequestItem]
  sort: [field: BookRequestSortField]
  'toggle-select': [row: BookRequestItem]
  'toggle-select-page': []
  /** Fork: the inline select on one request. */
  'set-tracking-status': [request: BookRequestItem, trackingStatus: BookRequestTrackingChoice]
  /** Fork: the row menu's tracking pick, for every half of the row it reaches. */
  track: [payload: RowTrackPayload, row: BookRequestItem]
}>()

const { t } = useI18n()

const isCompact = computed(() => props.density === 'compact')
const cellPadding = computed(() => (isCompact.value ? 'py-1.5' : 'py-2.5'))

interface RowView {
  halves: SelectionHalf[]
  model: RowActionModel
  trackHalves: SelectionHalf[]
}

/** One pass per refetch rather than one per template call: each row asks its rules several times. */
const rowViews = computed(() => {
  const views = new Map<number, RowView>()
  for (const row of props.requests) {
    const halves = rowSelectionHalves(row, props.viewer.userId)
    views.set(row.id, {
      halves,
      model: rowActionModel(halves, props.viewer),
      trackHalves: halves.filter((half) => trackingReaches(half, props.viewer)),
    })
  }
  return views
})

function viewFor(row: BookRequestItem): RowView {
  return rowViews.value.get(row.id) ?? { halves: [], model: { step: null, groups: [] }, trackHalves: [] }
}

// ── Fork: resizable, hideable and movable columns ───────────────────────────

const columns = useRequestTableColumns()
const { shown: showFormatText } = useRequestFormatText()
const visibleColumns = computed(() => columns.visibleColumns.value)
const textScale = useUiTextScale()

const root = ref<HTMLElement | null>(null)
const { width: rootWidth } = useElementSize(root)

type FixedColumn = Exclude<RequestTableColumn, 'book'>

function storedWidth(column: FixedColumn): number {
  return columns.widthOf(column, column === 'requested' && props.showRequester ? REQUESTED_WITH_REQUESTER_WIDTH : undefined)
}

function fixedVisible(): FixedColumn[] {
  return visibleColumns.value.filter((column): column is FixedColumn => column !== 'book')
}

/**
 * The room the fixed columns may share, in unscaled pixels: everything but the checkbox and the
 * book's minimum. Null before the table has been measured, when nothing is capped.
 */
const fixedBudget = computed(() => {
  if (rootWidth.value <= 0) return null
  return Math.max(0, rootWidth.value / textScale.value - SELECT_COLUMN_WIDTH - BOOK_MIN_WIDTH)
})

/**
 * Widths as drawn. When the saved widths no longer fit, after a window got narrower or the text
 * larger, every fixed column gives up the same share, so the table never scrolls sideways and the
 * header can stay sticky without an overflow box around it.
 */
const renderedWidths = computed(() => {
  const fixed = fixedVisible()
  const wanted = Object.fromEntries(fixed.map((column) => [column, storedWidth(column)])) as Record<FixedColumn, number>
  const total = fixed.reduce((sum, column) => sum + wanted[column], 0)
  const budget = fixedBudget.value
  const factor = budget !== null && total > budget && total > 0 ? budget / total : 1
  return Object.fromEntries(fixed.map((column) => [column, wanted[column] * factor])) as Record<FixedColumn, number>
})

function columnStyle(column: RequestTableColumn) {
  if (column === 'book') return {}
  return { width: `${(renderedWidths.value[column] ?? storedWidth(column)) * textScale.value}px` }
}

/** The most this column may grow to before the book would drop below its minimum. */
function maxWidthFor(column: FixedColumn): number | undefined {
  const budget = fixedBudget.value
  if (budget === null) return undefined
  const others = fixedVisible()
    .filter((entry) => entry !== column)
    .reduce((sum, entry) => sum + storedWidth(entry), 0)
  return Math.max(MIN_COLUMN_WIDTH, budget - others)
}

function columnFromEvent(event: Event): RequestTableColumn | null {
  const value = (event.currentTarget as HTMLElement | null)?.dataset.column
  return value && (REQUEST_TABLE_COLUMNS as readonly string[]).includes(value) ? (value as RequestTableColumn) : null
}

function fixedFromEvent(event: Event): FixedColumn | null {
  const column = columnFromEvent(event)
  return column && column !== 'book' ? column : null
}

let resizing: { column: FixedColumn; startX: number; startWidth: number } | null = null

function onResizeMove(event: PointerEvent) {
  if (!resizing) return
  const width = resizing.startWidth + (event.clientX - resizing.startX) / textScale.value
  columns.setWidth(resizing.column, width, maxWidthFor(resizing.column))
}

function onResizeEnd() {
  if (!resizing) return
  resizing = null
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  document.body.style.removeProperty('cursor')
  document.body.style.removeProperty('user-select')
  columns.commitWidths()
}

function startResize(event: PointerEvent) {
  const column = fixedFromEvent(event)
  if (!column) return
  event.preventDefault()
  event.stopPropagation()
  resizing = { column, startX: event.clientX, startWidth: renderedWidths.value[column] ?? storedWidth(column) }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function resizeWithKeys(event: KeyboardEvent) {
  const column = fixedFromEvent(event)
  if (!column) return
  const step = event.shiftKey ? 48 : 16
  const current = renderedWidths.value[column] ?? storedWidth(column)
  if (event.key === 'ArrowRight') columns.setWidth(column, current + step, maxWidthFor(column))
  else if (event.key === 'ArrowLeft') columns.setWidth(column, current - step, maxWidthFor(column))
  else return
  event.preventDefault()
  columns.commitWidths()
}

function resetWidth(event: MouseEvent) {
  const column = fixedFromEvent(event)
  if (column) columns.resetWidth(column)
}

onBeforeUnmount(onResizeEnd)

const dragging = ref<RequestTableColumn | null>(null)
const dropTarget = ref<RequestTableColumn | null>(null)

function startDrag(event: DragEvent) {
  const column = columnFromEvent(event)
  if (!column) return
  dragging.value = column
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', column)
    const header = (event.currentTarget as HTMLElement).closest('th')
    if (header) event.dataTransfer.setDragImage(header, 12, 12)
  }
}

function dragOver(event: DragEvent) {
  const column = columnFromEvent(event)
  if (!dragging.value || !column) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTarget.value = column
}

function dropOn(event: DragEvent) {
  const column = columnFromEvent(event)
  if (dragging.value && column) {
    event.preventDefault()
    columns.moveTo(dragging.value, column)
  }
  endDrag()
}

function endDrag() {
  dragging.value = null
  dropTarget.value = null
}

function moveWithKeys(event: KeyboardEvent) {
  const column = columnFromEvent(event)
  if (!column) return
  if (event.key === 'ArrowLeft') columns.moveBy(column, -1)
  else if (event.key === 'ArrowRight') columns.moveBy(column, 1)
  else return
  event.preventDefault()
}

const COLUMN_SORT: Partial<Record<RequestTableColumn, BookRequestSortField>> = {
  book: 'title',
  requested: 'createdAt',
  released: 'publishedDate',
  status: 'status',
  tracking: 'trackingStatus',
}

const COLUMN_HEADING: Record<RequestTableColumn, string> = {
  book: 'bookRequests.table.book',
  requested: 'bookRequests.table.requested',
  released: 'bookRequests.table.released',
  status: 'bookRequests.table.status',
  tracking: 'bookRequests.table.tracking',
  nextStep: 'bookRequests.table.nextStep',
  actions: 'bookRequests.table.actions',
}

function sortFieldOf(column: RequestTableColumn): BookRequestSortField | null {
  return COLUMN_SORT[column] ?? null
}

function headingOf(column: RequestTableColumn): string {
  return t(COLUMN_HEADING[column])
}

function columnAriaSort(column: RequestTableColumn): 'ascending' | 'descending' | 'none' | undefined {
  const field = sortFieldOf(column)
  return field ? ariaSort(field) : undefined
}

function columnSortIcon(column: RequestTableColumn) {
  return sortIcon(sortFieldOf(column) ?? 'title')
}

function sortByColumn(event: Event) {
  const field = sortFieldOf(columnFromEvent(event) ?? 'nextStep')
  if (field) emit('sort', field)
}

/** The full release date for this format, or N/A: a year alone says nothing about whether this format is out. */
function releasedLabel(request: BookRequestItem): string {
  if (!request.publishedDate) return t('bookRequests.table.releasedUnknown')
  const [year, month, day] = request.publishedDate.split('-').map(Number)
  return formatDate(new Date(year!, month! - 1, day!), { dateStyle: 'medium' })
}

/** An available request is finished, so there is nothing left to track on it. */
function showsTracking(request: BookRequestItem): boolean {
  return request.status !== 'available'
}

function canEditTracking(request: BookRequestItem): boolean {
  return canTrackRequest(request, props.viewer.userId, props.viewer.canManage, props.viewer.canSelfFulfil)
}

function handleSetTrackingStatus(request: BookRequestItem, trackingStatus: BookRequestTrackingChoice) {
  emit('set-tracking-status', request, trackingStatus)
}

function handleTrack(row: BookRequestItem, payload: RowTrackPayload) {
  emit('track', payload, row)
}

function isPair(row: BookRequestItem): boolean {
  return row.companion != null
}

function mediaLabel(request: BookRequestItem): string {
  return t(`bookRequests.mediaKind.${request.mediaKind}`)
}

function formatLabel(row: BookRequestItem): string {
  return isPair(row) ? t('bookRequests.table.formatPair') : mediaLabel(row)
}

function authorLine(request: BookRequestItem): string {
  return request.authors.join(', ')
}

function skippedApproval(row: BookRequestItem): boolean {
  return rowRequests(row).some((half) => half.selfServe)
}

function liveFor(request: BookRequestItem): BookRequestProgressEvent | null {
  return currentRequestProgress(request, props.progressByRequest[request.id])
}

function statusFor(request: BookRequestItem): BookRequestItem['status'] {
  return requestPresentationStatus(request, liveFor(request))
}

/** Reconcile socket progress with the latest fetched attempt before rendering a transfer bar. */
function progressFor(request: BookRequestItem): { percent: number; done: number; total: number | null } | null {
  const live = liveFor(request)
  const download = request.download
  if (!download) return null
  const status = live?.status ?? download.status
  if (status !== 'queued' && status !== 'downloading') return null
  return {
    percent: Math.max(0, Math.min(100, live?.progressPercent ?? download.progressPercent)),
    done: live?.downloadedBytes ?? download.downloadedBytes,
    total: live?.totalBytes ?? download.totalBytes,
  }
}

/** Locale-formatted: where the percent sign goes, and whether it takes a space, is not universal. */
function percentLabel(request: BookRequestItem): string {
  return formatPercent((progressFor(request)?.percent ?? 0) / 100)
}

function transferLine(request: BookRequestItem): string | null {
  const progress = progressFor(request)
  if (!progress?.total) return null
  return t('bookRequests.download.transferred', { done: formatBytes(progress.done), total: formatBytes(progress.total) })
}

interface NextLine {
  kind: 'progress' | 'failure' | 'text'
  text: string
}

/**
 * What happens next for one request, on one line. Automation being off is a setting, said once in
 * the banner above the list, so the row only says what it needs rather than repeating the why.
 */
function nextLine(request: BookRequestItem): NextLine {
  const outcome = requestOutcome(request, liveFor(request), (iso) => formatRelativeFromNow(new Date(iso)))
  if (outcome.kind === 'progress') return { kind: 'progress', text: percentLabel(request) }
  const failure = requestFailureText(request, (key, named) => t(key, named))
  if (outcome.kind === 'failure') return { kind: 'failure', text: failure ?? t('bookRequests.outcome.failedUnknown') }
  if (request.failureCode === 'AUTOMATION_DISABLED') return { kind: 'text', text: t('bookRequests.nextStep.needsRelease') }
  if (failure) return { kind: 'text', text: failure }
  return { kind: 'text', text: t(`bookRequests.outcome.${outcome.key}`, outcome.params ?? {}) }
}

/** Each half's own art: the ebook's portrait cover and the audiobook's square one. */
function halfCover(row: BookRequestItem, kind: 'ebook' | 'audiobook'): string | null {
  return rowRequests(row).find((request) => request.mediaKind === kind)?.coverUrl ?? null
}

function halfBookCovers(row: BookRequestItem, kind: 'ebook' | 'audiobook'): string[] {
  const half = rowRequests(row).find((request) => request.mediaKind === kind)
  return half ? requestBookCoverSources(half) : []
}

/** The book either half landed as, so a pair that has partly arrived still links somewhere real. */
function landedBookId(row: BookRequestItem): number | null {
  return rowRequests(row).find((request) => request.status === 'available' && request.matchedBookId !== null)?.matchedBookId ?? null
}

function requestedTime(row: BookRequestItem): string {
  return formatRelativeFromNow(new Date(row.createdAt))
}

function isRowBusy(row: BookRequestItem): boolean {
  return rowRequests(row).some((request) => props.busyIds.has(request.id))
}

function isSelected(row: BookRequestItem): boolean {
  return props.selectedRowIds.has(row.id)
}

function ariaSort(field: BookRequestSortField): 'ascending' | 'descending' | 'none' {
  if (props.sortBy !== field) return 'none'
  return props.sortDir === 'asc' ? 'ascending' : 'descending'
}

function sortIcon(field: BookRequestSortField) {
  if (props.sortBy !== field) return ChevronsUpDown
  return props.sortDir === 'asc' ? ArrowUp : ArrowDown
}

function handleTogglePage() {
  emit('toggle-select-page')
}

function handleToggle(row: BookRequestItem) {
  emit('toggle-select', row)
}

function handleOpenRow(row: BookRequestItem) {
  emit('open', row.id)
}

function handleOpenId(id: number) {
  emit('open', id)
}

function handleAct(row: BookRequestItem, payload: RowActPayload) {
  emit('act', payload, row)
}

function handleStep(row: BookRequestItem, step: RowStep) {
  emit('step', step, row)
}

/**
 * The whole row opens the request, which is what its hover promises. Anything interactive inside
 * it keeps its own click, and a drag that selected text is a copy, not a click.
 */
function handleRowClick(row: BookRequestItem, event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, label, select, [role="menuitem"]')) return
  if (window.getSelection()?.toString()) return
  emit('open', row.id)
}

const SORT_BUTTON =
  'inline-flex items-center gap-1 rounded-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none'
const HEADER_LABEL = 'truncate text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase'
</script>

<template>
  <div ref="root">
    <!--
      One list, two shapes. Below `xl` the same rows stack as cards. Fixed layout: every column but
      the book has a set width, capped to what the table has room for, and the book takes the rest.
      Nothing wraps the table in an overflow box, so the header keeps sticking.
    -->
    <table class="hidden w-full table-fixed border-collapse text-sm xl:table">
      <caption class="sr-only">
        {{
          t('bookRequests.table.caption')
        }}
      </caption>
      <colgroup>
        <col class="w-11" />
        <col v-for="column in visibleColumns" :key="column" :style="columnStyle(column)" />
      </colgroup>
      <thead class="sticky top-[calc(3rem-var(--shell-gap))] z-10 bg-card">
        <tr class="border-b border-border">
          <th scope="col" class="px-3 py-2.5">
            <input
              type="checkbox"
              class="block size-4 cursor-pointer rounded-xs border-border accent-primary"
              :checked="pageSelection === 'all'"
              :indeterminate.prop="pageSelection === 'some'"
              :aria-label="t('bookRequests.table.selectPage')"
              @change="handleTogglePage"
            />
          </th>
          <!--
            Each header carries a grip: drag it onto another header to move the column there, or
            focus it and use the arrow keys. Every column but the book has a resize edge.
          -->
          <th
            v-for="column in visibleColumns"
            :key="column"
            scope="col"
            :data-column="column"
            class="group relative px-3 py-2.5 text-start"
            :class="[dropTarget === column && dragging !== column && 'bg-primary/10', dragging === column && 'opacity-50']"
            :aria-sort="columnAriaSort(column)"
            @dragover="dragOver"
            @drop="dropOn"
          >
            <div class="flex min-w-0 items-center gap-0.5">
              <button
                type="button"
                draggable="true"
                :data-column="column"
                :aria-label="t('bookRequests.columns.move', { column: headingOf(column) })"
                :title="t('bookRequests.columns.moveHint')"
                class="-ms-2 inline-flex shrink-0 cursor-grab rounded-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing motion-reduce:transition-none"
                @dragstart="startDrag"
                @dragend="endDrag"
                @keydown="moveWithKeys"
              >
                <GripVertical :size="12" aria-hidden="true" />
              </button>
              <button v-if="sortFieldOf(column)" type="button" :data-column="column" :class="SORT_BUTTON" class="min-w-0" @click="sortByColumn">
                <span class="truncate">{{ headingOf(column) }}</span>
                <component :is="columnSortIcon(column)" :size="12" class="shrink-0" aria-hidden="true" />
              </button>
              <span v-else :class="[HEADER_LABEL, column === 'actions' && 'sr-only']">{{ headingOf(column) }}</span>
            </div>
            <span
              v-if="column !== 'book'"
              role="separator"
              aria-orientation="vertical"
              tabindex="0"
              :data-column="column"
              :aria-label="t('bookRequests.columns.resize', { column: headingOf(column) })"
              class="absolute inset-y-0 end-0 w-2 cursor-col-resize touch-none border-e border-transparent hover:border-primary focus-visible:border-primary focus-visible:outline-none"
              @pointerdown="startResize"
              @keydown="resizeWithKeys"
              @dblclick="resetWidth"
            />
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="row in requests"
          :key="row.id"
          class="cursor-pointer border-b border-border/60 transition-colors last:border-b-0 motion-reduce:transition-none"
          :class="isSelected(row) ? 'bg-primary/8 hover:bg-primary/12' : 'hover:bg-muted/50'"
          @click="handleRowClick(row, $event)"
        >
          <td class="px-3 align-middle" :class="cellPadding">
            <input
              type="checkbox"
              class="block size-4 cursor-pointer rounded-xs border-border accent-primary"
              :checked="isSelected(row)"
              :aria-label="t('bookRequests.table.selectRow', { title: row.title })"
              @change="handleToggle(row)"
            />
          </td>

          <template v-for="column in visibleColumns" :key="column">
            <td v-if="column === 'book'" class="px-3" :class="cellPadding">
              <div class="flex min-w-0 items-center gap-3">
                <RequestPairCover
                  v-if="isPair(row)"
                  :ebook-src="halfCover(row, 'ebook')"
                  :audio-src="halfCover(row, 'audiobook')"
                  :ebook-fallbacks="halfBookCovers(row, 'ebook')"
                  :audio-fallbacks="halfBookCovers(row, 'audiobook')"
                  :class="isCompact ? 'me-1 h-8 w-[22px]' : 'me-1.5 h-[46px] w-8'"
                  :icon-size="isCompact ? 11 : 14"
                />
                <RequestCover
                  v-else
                  :src="row.coverUrl"
                  :fallback-sources="requestBookCoverSources(row)"
                  :media-kind="row.mediaKind"
                  :class="isCompact ? 'me-1 h-8 w-[22px]' : 'me-1.5 h-[46px] w-8'"
                  :icon-size="isCompact ? 11 : 14"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      class="min-w-0 truncate rounded-xs text-start font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                      :title="row.title"
                      @click="handleOpenRow(row)"
                    >
                      {{ row.title }}
                    </button>
                    <RouterLink
                      v-if="landedBookId(row) !== null"
                      :to="{ name: 'book-detail', params: { bookId: landedBookId(row) } }"
                      class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                      :title="t('book.actions.bookDetails')"
                    >
                      <ExternalLink :size="13" aria-hidden="true" />
                      <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
                    </RouterLink>
                    <CopyTextButton :text="row.title" :label="t('bookRequests.copy.title')" :size="12" />
                  </div>
                  <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                    <span v-if="authorLine(row)" class="min-w-0 truncate">{{ authorLine(row) }}</span>
                    <CopyTextButton v-if="authorLine(row)" :text="authorLine(row)" :label="t('bookRequests.copy.author')" :size="11" />
                    <span v-if="authorLine(row)" aria-hidden="true">·</span>
                    <span class="inline-flex shrink-0 items-center gap-1">
                      <component
                        :is="requestMediaIcon(half.mediaKind)"
                        v-for="half in orderedHalves(row)"
                        :key="half.id"
                        :size="12"
                        :class="requestMediaColor(half.mediaKind)"
                        aria-hidden="true"
                      />
                      <span :class="!showFormatText && 'sr-only'">{{ formatLabel(row) }}</span>
                    </span>
                    <template v-if="skippedApproval(row)">
                      <span aria-hidden="true">·</span>
                      <span class="inline-flex shrink-0 items-center gap-1" :title="t('bookRequests.table.skippedApprovalHint')">
                        <Zap :size="12" aria-hidden="true" />
                        {{ t('bookRequests.table.skippedApproval') }}
                      </span>
                    </template>
                  </p>
                </div>
              </div>
            </td>

            <td v-else-if="column === 'requested'" class="px-3 text-[13px]" :class="cellPadding">
              <span v-if="showRequester" class="block truncate text-foreground" :title="row.requesterName">{{ row.requesterName }}</span>
              <span class="block truncate text-xs text-muted-foreground tabular-nums">{{ requestedTime(row) }}</span>
            </td>

            <td v-else-if="column === 'released'" class="px-3 text-xs text-muted-foreground tabular-nums" :class="cellPadding">
              <div class="flex flex-col gap-1">
                <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-1.5">
                  <template v-if="isPair(row)">
                    <component :is="requestMediaIcon(half.mediaKind)" :size="13" :class="requestMediaColor(half.mediaKind)" aria-hidden="true" />
                    <span class="sr-only">{{ mediaLabel(half) }}</span>
                  </template>
                  <span class="min-w-0 truncate">{{ releasedLabel(half) }}</span>
                </div>
              </div>
            </td>

            <td v-else-if="column === 'status'" class="px-3" :class="cellPadding">
              <div class="flex flex-col gap-1">
                <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-1.5">
                  <template v-if="isPair(row)">
                    <component :is="requestMediaIcon(half.mediaKind)" :size="13" :class="requestMediaColor(half.mediaKind)" aria-hidden="true" />
                    <span class="sr-only">{{ mediaLabel(half) }}</span>
                  </template>
                  <RequestStatusBadge :status="statusFor(half)" />
                </div>
              </div>
            </td>

            <td v-else-if="column === 'tracking'" class="px-3" :class="cellPadding">
              <div class="flex flex-col gap-1">
                <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-1.5">
                  <template v-if="showsTracking(half)">
                    <component
                      :is="requestMediaIcon(half.mediaKind)"
                      v-if="isPair(row)"
                      :size="13"
                      class="shrink-0"
                      :class="requestMediaColor(half.mediaKind)"
                      aria-hidden="true"
                    />
                    <RequestTrackingStatusSelect
                      :request="half"
                      :editable="canEditTracking(half)"
                      :busy="busyIds.has(half.id)"
                      @change="handleSetTrackingStatus"
                    />
                  </template>
                </div>
              </div>
            </td>

            <td v-else-if="column === 'nextStep'" class="px-3 text-[13px]" :class="cellPadding">
              <div class="flex flex-col gap-1">
                <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-2">
                  <template v-if="nextLine(half).kind === 'progress'">
                    <div
                      class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      :aria-valuenow="progressFor(half)?.percent ?? 0"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      :aria-label="
                        t('bookRequests.download.progressLabel', { title: isPair(row) ? `${half.title} (${mediaLabel(half)})` : half.title })
                      "
                    >
                      <div
                        class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                        :style="{ width: `${progressFor(half)?.percent ?? 0}%` }"
                      />
                    </div>
                    <span class="min-w-0 truncate text-muted-foreground tabular-nums" :title="transferLine(half) ?? undefined">
                      {{ nextLine(half).text }}
                      <template v-if="transferLine(half)">&middot; {{ transferLine(half) }}</template>
                    </span>
                  </template>
                  <span
                    v-else
                    class="min-w-0 truncate"
                    :class="nextLine(half).kind === 'failure' ? 'text-destructive' : 'text-muted-foreground'"
                    :title="nextLine(half).text"
                  >
                    {{ nextLine(half).text }}
                  </span>
                </div>
              </div>
            </td>

            <td v-else-if="column === 'actions'" class="px-3" :class="cellPadding">
              <div class="flex min-w-0 items-center justify-end gap-1">
                <div class="flex min-w-0 flex-1 justify-end">
                  <RequestNextStepButton
                    v-if="viewFor(row).model.step"
                    class="w-full max-w-28"
                    :step="viewFor(row).model.step!"
                    :busy="isRowBusy(row)"
                    @press="handleStep(row, $event)"
                  />
                </div>
                <RequestRowMenu
                  :title="row.title"
                  :halves="viewFor(row).halves"
                  :model="viewFor(row).model"
                  :busy="isRowBusy(row)"
                  :track-halves="viewFor(row).trackHalves"
                  @open="handleOpenId"
                  @act="handleAct(row, $event)"
                  @track="handleTrack(row, $event)"
                />
              </div>
            </td>
          </template>
        </tr>
      </tbody>
    </table>

    <!-- Below `xl` the same rows stack. Same data, same actions, no second component to keep in step. -->
    <ul class="divide-y divide-border/60 xl:hidden">
      <li
        v-for="row in requests"
        :key="row.id"
        class="cursor-pointer px-3 py-3 transition-colors motion-reduce:transition-none"
        :class="isSelected(row) ? 'bg-primary/8' : 'hover:bg-muted/50'"
        @click="handleRowClick(row, $event)"
      >
        <div class="flex min-w-0 items-start gap-3">
          <label class="-m-2 flex shrink-0 cursor-pointer p-2">
            <input
              type="checkbox"
              class="mt-0.5 block size-4 cursor-pointer rounded-xs border-border accent-primary"
              :checked="isSelected(row)"
              :aria-label="t('bookRequests.table.selectRow', { title: row.title })"
              @change="handleToggle(row)"
            />
          </label>
          <RequestPairCover
            v-if="isPair(row)"
            :ebook-src="halfCover(row, 'ebook')"
            :audio-src="halfCover(row, 'audiobook')"
            :ebook-fallbacks="halfBookCovers(row, 'ebook')"
            :audio-fallbacks="halfBookCovers(row, 'audiobook')"
            class="me-1.5 h-[54px] w-9"
            :icon-size="16"
          />
          <RequestCover
            v-else
            :src="row.coverUrl"
            :fallback-sources="requestBookCoverSources(row)"
            :media-kind="row.mediaKind"
            class="me-1.5 h-[54px] w-9"
            :icon-size="16"
          />

          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    class="min-w-0 truncate rounded-xs text-start text-sm font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                    @click="handleOpenRow(row)"
                  >
                    {{ row.title }}
                  </button>
                  <RouterLink
                    v-if="landedBookId(row) !== null"
                    :to="{ name: 'book-detail', params: { bookId: landedBookId(row) } }"
                    class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :title="t('book.actions.bookDetails')"
                  >
                    <ExternalLink :size="13" aria-hidden="true" />
                    <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
                  </RouterLink>
                  <CopyTextButton :text="row.title" :label="t('bookRequests.copy.title')" :size="12" />
                </div>
                <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                  <span v-if="authorLine(row)" class="min-w-0 truncate">{{ authorLine(row) }}</span>
                  <CopyTextButton v-if="authorLine(row)" :text="authorLine(row)" :label="t('bookRequests.copy.author')" :size="11" />
                  <span v-if="authorLine(row)" aria-hidden="true">·</span>
                  <span class="inline-flex shrink-0 items-center gap-1">
                    <component
                      :is="requestMediaIcon(half.mediaKind)"
                      v-for="half in orderedHalves(row)"
                      :key="half.id"
                      :size="12"
                      :class="requestMediaColor(half.mediaKind)"
                      aria-hidden="true"
                    />
                    <span :class="!showFormatText && 'sr-only'">{{ formatLabel(row) }}</span>
                  </span>
                </p>
                <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                  <span class="min-w-0 truncate">
                    {{
                      showRequester
                        ? t('bookRequests.card.requestedByDot', { name: row.requesterName, time: requestedTime(row) })
                        : requestedTime(row)
                    }}
                  </span>
                  <template v-if="skippedApproval(row)">
                    <span aria-hidden="true">·</span>
                    <span class="inline-flex shrink-0 items-center gap-1" :title="t('bookRequests.table.skippedApprovalHint')">
                      <Zap :size="12" aria-hidden="true" />
                      {{ t('bookRequests.table.skippedApproval') }}
                    </span>
                  </template>
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <RequestNextStepButton
                  v-if="viewFor(row).model.step"
                  class="max-w-32 max-sm:hidden"
                  :step="viewFor(row).model.step!"
                  :busy="isRowBusy(row)"
                  @press="handleStep(row, $event)"
                />
                <div class="-me-1.5 -mt-1 flex">
                  <RequestRowMenu
                    :title="row.title"
                    :halves="viewFor(row).halves"
                    :model="viewFor(row).model"
                    :busy="isRowBusy(row)"
                    :track-halves="viewFor(row).trackHalves"
                    @open="handleOpenId"
                    @act="handleAct(row, $event)"
                    @track="handleTrack(row, $event)"
                  />
                </div>
              </div>
            </div>

            <div class="mt-2 flex flex-col gap-1">
              <div v-for="half in orderedHalves(row)" :key="half.id" class="flex h-[22px] min-w-0 items-center gap-2">
                <template v-if="isPair(row)">
                  <component :is="requestMediaIcon(half.mediaKind)" :size="13" :class="requestMediaColor(half.mediaKind)" aria-hidden="true" />
                  <span class="sr-only">{{ mediaLabel(half) }}</span>
                </template>
                <RequestStatusBadge :status="statusFor(half)" />
                <template v-if="nextLine(half).kind === 'progress'">
                  <div
                    class="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    :aria-valuenow="progressFor(half)?.percent ?? 0"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="
                      t('bookRequests.download.progressLabel', { title: isPair(row) ? `${half.title} (${mediaLabel(half)})` : half.title })
                    "
                  >
                    <div
                      class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                      :style="{ width: `${progressFor(half)?.percent ?? 0}%` }"
                    />
                  </div>
                  <span class="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{{ nextLine(half).text }}</span>
                </template>
                <span
                  v-else
                  class="min-w-0 truncate text-xs"
                  :class="nextLine(half).kind === 'failure' ? 'text-destructive' : 'text-muted-foreground'"
                  :title="nextLine(half).text"
                >
                  {{ nextLine(half).text }}
                </span>
              </div>
            </div>

            <!-- Fork: when each format comes out, and what the request is waiting on. -->
            <div class="mt-1.5 flex flex-col gap-1">
              <div
                v-for="half in orderedHalves(row)"
                :key="half.id"
                class="flex min-h-[22px] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
              >
                <template v-if="isPair(row)">
                  <component :is="requestMediaIcon(half.mediaKind)" :size="13" :class="requestMediaColor(half.mediaKind)" aria-hidden="true" />
                  <span class="sr-only">{{ mediaLabel(half) }}</span>
                </template>
                <span class="tabular-nums">{{ t('bookRequests.card.releasedOn', { date: releasedLabel(half) }) }}</span>
                <RequestTrackingStatusSelect
                  v-if="showsTracking(half)"
                  :request="half"
                  :editable="canEditTracking(half)"
                  :busy="busyIds.has(half.id)"
                  @change="handleSetTrackingStatus"
                />
              </div>
            </div>

            <RequestNextStepButton
              v-if="viewFor(row).model.step"
              class="mt-2.5 sm:hidden"
              :step="viewFor(row).model.step!"
              :busy="isRowBusy(row)"
              @press="handleStep(row, $event)"
            />
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
