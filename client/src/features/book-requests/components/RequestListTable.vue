<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronsUpDown, ExternalLink, EyeOff, GripVertical, TriangleAlert, Zap } from '@lucide/vue'
import { isGrabbableBookRequestStatus } from '@bookorbit/types'
import type {
  BookRequestItem,
  BookRequestProgressEvent,
  BookRequestSortDirection,
  BookRequestSortField,
  BookRequestTrackingStatus,
} from '@bookorbit/types'
import { formatDate, formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import type { RequestListDensity } from '../composables/useRequestListDensity'
import { canBulkActRequest } from '../requestActions'
import { requestBookCoverSources } from '../requestBookCover'
import { requestMediaColor, requestMediaIcon } from '../requestMedia'
import { orderedHalves, rowRequests } from '../requestPair'
import { requestFailureText, requestOutcome } from '../requestOutcome'
import { currentRequestProgress, requestPresentationStatus } from '../requestPipeline'
import RequestCover from './RequestCover.vue'
import RequestPairCover from './RequestPairCover.vue'
import RequestPairRowActions from './RequestPairRowActions.vue'
import RequestPipeline from './RequestPipeline.vue'
import RequestRowActions from './RequestRowActions.vue'
import RequestStatusBadge from './RequestStatusBadge.vue'
import RequestTrackingStatusSelect from './RequestTrackingStatusSelect.vue'
import {
  COVER_CELL_PADDING,
  REQUEST_TABLE_COLUMNS,
  SELECT_COLUMN_WIDTH,
  TITLE_MIN_WIDTH,
  useRequestTableColumns,
  type RequestTableColumn,
} from '../composables/useRequestTableColumns'

const props = defineProps<{
  requests: BookRequestItem[]
  canManage: boolean
  /** Whether the viewer may drive fulfilment on rows that are theirs to drive. */
  canSelfFulfil: boolean
  currentUserId: number | null
  /** Every row with an action in flight, so two rows acted on at once each stay disabled. */
  busyIds: ReadonlySet<number>
  progressByRequest: Record<number, BookRequestProgressEvent | undefined>
  density: RequestListDensity
  sortBy: BookRequestSortField
  sortDir: BookRequestSortDirection
  selectedIds: number[]
}>()

const emit = defineEmits<{
  open: [request: BookRequestItem]
  approve: [request: BookRequestItem]
  reject: [request: BookRequestItem]
  cancel: [request: BookRequestItem]
  dismiss: [request: BookRequestItem]
  restore: [request: BookRequestItem]
  remove: [request: BookRequestItem]
  grab: [request: BookRequestItem]
  /** One press on a pair row, carrying exactly the halves it applies to. */
  'pair-approve': [requests: BookRequestItem[]]
  'pair-reject': [requests: BookRequestItem[]]
  'pair-cancel': [requests: BookRequestItem[]]
  'pair-dismiss': [requests: BookRequestItem[]]
  'pair-restore': [requests: BookRequestItem[]]
  sort: [field: BookRequestSortField]
  'set-tracking-status': [request: BookRequestItem, trackingStatus: BookRequestTrackingStatus | null]
  'toggle-select': [request: BookRequestItem]
  'toggle-select-all': []
}>()

const { t } = useI18n()

const isCompact = computed(() => props.density === 'compact')

const columns = useRequestTableColumns()

/** The narrowest the table may get before it scrolls sideways rather than squeezing a column. */
const tableMinWidth = computed(
  () =>
    (hasSelectableRows.value ? SELECT_COLUMN_WIDTH : 0) +
    columns.visibleColumns.value.reduce(
      (sum, column) => sum + (column === 'title' ? (columns.storedWidthOf('title') ?? TITLE_MIN_WIDTH) : columns.widthOf(column)),
      0,
    ),
)

function columnStyle(column: RequestTableColumn) {
  if (column === 'title') {
    const stored = columns.storedWidthOf('title')
    return stored === null ? {} : { width: `${stored}px` }
  }
  return { width: `${columns.widthOf(column)}px` }
}

/** What the header is drawn at now, which for a flexible title is not its stored width. */
function renderedWidth(event: Event, column: RequestTableColumn): number {
  const header = (event.currentTarget as HTMLElement | null)?.closest('th')
  return header ? header.getBoundingClientRect().width : columns.widthOf(column)
}

function columnFromEvent(event: Event): RequestTableColumn | null {
  const value = (event.currentTarget as HTMLElement | null)?.dataset.column
  return value && (REQUEST_TABLE_COLUMNS as readonly string[]).includes(value) ? (value as RequestTableColumn) : null
}

let resizing: { column: RequestTableColumn; startX: number; startWidth: number } | null = null

function onResizeMove(event: PointerEvent) {
  if (!resizing) return
  columns.setWidth(resizing.column, resizing.startWidth + (event.clientX - resizing.startX))
}

function onResizeEnd() {
  resizing = null
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  document.body.style.removeProperty('cursor')
  document.body.style.removeProperty('user-select')
  columns.commitWidths()
}

function startResize(event: PointerEvent) {
  const column = columnFromEvent(event)
  if (!column) return
  event.preventDefault()
  event.stopPropagation()
  resizing = { column, startX: event.clientX, startWidth: renderedWidth(event, column) }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function resizeWithKeys(event: KeyboardEvent) {
  const column = columnFromEvent(event)
  if (!column) return
  const step = event.shiftKey ? 48 : 16
  const current = renderedWidth(event, column)
  if (event.key === 'ArrowRight') columns.setWidth(column, current + step)
  else if (event.key === 'ArrowLeft') columns.setWidth(column, current - step)
  else return
  event.preventDefault()
  columns.commitWidths()
}

function resetWidth(event: MouseEvent) {
  const column = columnFromEvent(event)
  if (!column) return
  columns.resetWidth(column)
}

onBeforeUnmount(onResizeEnd)

function mediaIcon(request: BookRequestItem) {
  return requestMediaIcon(request.mediaKind)
}

function mediaColor(request: BookRequestItem): string {
  return requestMediaColor(request.mediaKind)
}

/** The icon stands alone in the row, so the medium has to reach assistive tech some other way. */
function mediaLabel(request: BookRequestItem): string {
  return t(`bookRequests.mediaKind.${request.mediaKind}`)
}

function authorLine(request: BookRequestItem): string {
  return request.authors.join(', ')
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

function liveFor(request: BookRequestItem): BookRequestProgressEvent | null {
  return currentRequestProgress(request, props.progressByRequest[request.id])
}

function statusFor(request: BookRequestItem): BookRequestItem['status'] {
  return requestPresentationStatus(request, liveFor(request))
}

function outcomeFor(request: BookRequestItem) {
  return requestOutcome(request, liveFor(request), (iso) => formatRelativeFromNow(new Date(iso)))
}

/** Per row rather than computed: the list renders hundreds and each one asks about its own request. */
function failureFor(request: BookRequestItem): string | null {
  return requestFailureText(request, (key, named) => t(key, named))
}

/** Whether the reason describes something that went wrong, as opposed to something to do next. */
function isFailure(request: BookRequestItem): boolean {
  return outcomeFor(request).kind === 'failure'
}

function transferLine(request: BookRequestItem): string | null {
  const progress = progressFor(request)
  if (!progress?.total) return null
  return t('bookRequests.download.transferred', { done: formatBytes(progress.done), total: formatBytes(progress.total) })
}

function isPending(request: BookRequestItem): boolean {
  return request.status === 'pending'
}

function canGrab(request: BookRequestItem): boolean {
  return props.canManage && isGrabbableBookRequestStatus(request.status)
}

/**
 * A row with no destination library is still selectable: the endpoint names it in the failure list,
 * which is more use than a checkbox that silently refuses to tick. A pair row is one checkbox for
 * whichever of its halves a bulk action can reach.
 */
function selectableHalves(row: BookRequestItem): BookRequestItem[] {
  return rowRequests(row).filter((request) =>
    canBulkActRequest(request, { userId: props.currentUserId, canManage: props.canManage, canSelfFulfil: props.canSelfFulfil }),
  )
}

function isSelectable(row: BookRequestItem): boolean {
  return selectableHalves(row).length > 0
}

function isSelected(row: BookRequestItem): boolean {
  const halves = selectableHalves(row)
  return halves.length > 0 && halves.every((request) => props.selectedIds.includes(request.id))
}

const selectableIds = computed(() => props.requests.flatMap(selectableHalves).map((request) => request.id))
const hasSelectableRows = computed(() => selectableIds.value.length > 0)
const allSelected = computed(() => hasSelectableRows.value && selectableIds.value.every((id) => props.selectedIds.includes(id)))
const someSelected = computed(() => selectableIds.value.some((id) => props.selectedIds.includes(id)))

/** A settled row's actions stay reachable but stop competing with the rows that need a decision. */
function actionsAreQuiet(request: BookRequestItem): boolean {
  return rowRequests(request).every((half) => !isPending(half) && !canGrab(half))
}

function ariaSort(field: BookRequestSortField): 'ascending' | 'descending' | 'none' {
  if (props.sortBy !== field) return 'none'
  return props.sortDir === 'asc' ? 'ascending' : 'descending'
}

function sortIcon(field: BookRequestSortField) {
  if (props.sortBy !== field) return ChevronsUpDown
  return props.sortDir === 'asc' ? ArrowUp : ArrowDown
}

const COLUMN_SORT: Partial<Record<RequestTableColumn, BookRequestSortField>> = {
  title: 'title',
  mediaKind: 'mediaKind',
  released: 'publishedDate',
  requester: 'requester',
  age: 'createdAt',
  state: 'status',
  tracking: 'trackingStatus',
}

const COLUMN_HEADING: Record<RequestTableColumn, string> = {
  cover: 'bookRequests.table.cover',
  title: 'bookRequests.table.title',
  mediaKind: 'bookRequests.table.mediaKind',
  released: 'bookRequests.table.released',
  requester: 'bookRequests.table.requestedBy',
  age: 'bookRequests.table.age',
  state: 'bookRequests.table.state',
  tracking: 'bookRequests.table.tracking',
  outcome: 'bookRequests.table.outcome',
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
  const column = columnFromEvent(event)
  const field = column ? sortFieldOf(column) : null
  if (field) emit('sort', field)
}

/** Narrow headers keep their label for screen readers only, so a 56px cover column still has a name. */
function headingIsHidden(column: RequestTableColumn): boolean {
  return column === 'actions' || column === 'cover'
}

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

/**
 * The cover column's width is the cover's size: dragging its edge grows the picture. Compact rows
 * keep their small thumbnail until someone sizes the column on purpose.
 */
const coverWidth = computed(() => {
  const stored = columns.storedWidthOf('cover')
  if (stored === null && isCompact.value) return 22
  return Math.max(16, columns.widthOf('cover') - COVER_CELL_PADDING)
})

const coverStyle = computed(() => ({ width: `${coverWidth.value}px`, height: `${Math.round(coverWidth.value * 1.45)}px` }))
const coverIconSize = computed(() => Math.max(11, Math.round(coverWidth.value * 0.42)))

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

/** Mirrors the server's rule: the requester, a manager, or whoever is fulfilling it. */
function canEditTracking(request: BookRequestItem): boolean {
  if (props.canManage) return true
  if (props.currentUserId === null) return false
  return request.userId === props.currentUserId || (props.canSelfFulfil && request.fulfillerUserId === props.currentUserId)
}

function handleSetTrackingStatus(request: BookRequestItem, trackingStatus: BookRequestTrackingStatus | null) {
  emit('set-tracking-status', request, trackingStatus)
}

function toggleSelectAll() {
  emit('toggle-select-all')
}

function handleToggleSelect(request: BookRequestItem) {
  emit('toggle-select', request)
}

function handleOpen(request: BookRequestItem) {
  emit('open', request)
}

function handleApprove(request: BookRequestItem) {
  emit('approve', request)
}

function handleReject(request: BookRequestItem) {
  emit('reject', request)
}

function handleCancel(request: BookRequestItem) {
  emit('cancel', request)
}

function handleDismiss(request: BookRequestItem) {
  emit('dismiss', request)
}

function handleRestore(request: BookRequestItem) {
  emit('restore', request)
}

function handleRemove(request: BookRequestItem) {
  emit('remove', request)
}

function handleGrab(request: BookRequestItem) {
  emit('grab', request)
}

function handlePairApprove(requests: BookRequestItem[]) {
  emit('pair-approve', requests)
}

function handlePairReject(requests: BookRequestItem[]) {
  emit('pair-reject', requests)
}

function handlePairCancel(requests: BookRequestItem[]) {
  emit('pair-cancel', requests)
}

function handlePairDismiss(requests: BookRequestItem[]) {
  emit('pair-dismiss', requests)
}

function handlePairRestore(requests: BookRequestItem[]) {
  emit('pair-restore', requests)
}

function isPair(row: BookRequestItem): boolean {
  return row.companion != null
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

/** A pair row is busy while either half has an action in flight. */
function isRowBusy(row: BookRequestItem): boolean {
  return rowRequests(row).some((request) => props.busyIds.has(request.id))
}

function rowDismissed(row: BookRequestItem): boolean {
  return rowRequests(row).every((request) => request.dismissed)
}
</script>

<template>
  <div class="rounded-lg border border-border bg-card">
    <!--
      One list, two shapes. The table needs roughly 900px of columns before anything truncates, so
      below `lg` the same rows stack rather than growing a horizontal scrollbar. Nothing wraps the
      table in an overflow container on purpose: `overflow-x` would trap the sticky header inside a
      box that never scrolls vertically, and the header would stop sticking.
    -->
    <div class="hidden max-h-[calc(100svh-14rem)] overflow-auto rounded-lg lg:block">
      <table class="table-fixed border-collapse text-sm" :style="{ width: '100%', minWidth: `${tableMinWidth}px` }">
        <caption class="sr-only">
          {{
            t('bookRequests.table.caption')
          }}
        </caption>
        <colgroup>
          <col v-if="hasSelectableRows" :style="{ width: `${SELECT_COLUMN_WIDTH}px` }" />
          <col v-for="column in columns.visibleColumns.value" :key="column" :style="columnStyle(column)" />
        </colgroup>
        <thead class="sticky top-0 z-10 bg-card">
          <tr class="border-b border-border">
            <th v-if="hasSelectableRows" scope="col" class="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                class="h-3.5 w-3.5 rounded-xs border-border accent-primary"
                :checked="allSelected"
                :indeterminate.prop="someSelected && !allSelected"
                :aria-label="t('bookRequests.table.selectAll')"
                @change="toggleSelectAll"
              />
            </th>

            <!--
              Each header carries a grip: drag it onto another header to move the column there, or
              focus it and use the arrow keys. The header itself is the drop target, so a drop lands
              anywhere on it.
            -->
            <th
              v-for="column in columns.visibleColumns.value"
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
                <button
                  v-if="sortFieldOf(column)"
                  type="button"
                  :data-column="column"
                  class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-xs text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                  @click="sortByColumn"
                >
                  <span class="truncate">{{ headingOf(column) }}</span>
                  <component :is="columnSortIcon(column)" :size="12" class="shrink-0" aria-hidden="true" />
                </button>
                <span
                  v-else
                  class="truncate text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase"
                  :class="headingIsHidden(column) && 'sr-only'"
                >
                  {{ headingOf(column) }}
                </span>
              </div>
              <span
                role="separator"
                aria-orientation="vertical"
                tabindex="0"
                :data-column="column"
                :aria-label="t('bookRequests.columns.resize', { column: t(`bookRequests.columns.${column}`) })"
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
            v-for="request in requests"
            :key="request.id"
            class="border-b border-border/60 hover:bg-muted/40"
            :class="[isSelected(request) && 'bg-primary/8', rowDismissed(request) && 'opacity-60']"
          >
            <td v-if="hasSelectableRows" class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
              <input
                v-if="isSelectable(request)"
                type="checkbox"
                class="h-3.5 w-3.5 rounded-xs border-border accent-primary"
                :checked="isSelected(request)"
                :aria-label="t('bookRequests.table.selectRow', { title: request.title })"
                @change="handleToggleSelect(request)"
              />
            </td>

            <template v-for="column in columns.visibleColumns.value" :key="column">
              <td v-if="column === 'cover'" class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <RequestPairCover
                  v-if="isPair(request)"
                  :ebook-src="halfCover(request, 'ebook')"
                  :audio-src="halfCover(request, 'audiobook')"
                  :ebook-fallbacks="halfBookCovers(request, 'ebook')"
                  :audio-fallbacks="halfBookCovers(request, 'audiobook')"
                  :style="coverStyle"
                  :icon-size="coverIconSize"
                />
                <RequestCover
                  v-else
                  :src="request.coverUrl"
                  :fallback-sources="requestBookCoverSources(request)"
                  :media-kind="request.mediaKind"
                  :style="coverStyle"
                  :icon-size="coverIconSize"
                />
              </td>

              <td v-else-if="column === 'title'" class="max-w-0 px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <div class="flex min-w-0 items-center gap-2.5">
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        class="min-w-0 truncate text-start font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                        @click="handleOpen(request)"
                      >
                        {{ request.title }}
                      </button>
                      <RouterLink
                        v-if="landedBookId(request) !== null"
                        :to="{ name: 'book-detail', params: { bookId: landedBookId(request) } }"
                        class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                        :title="t('book.actions.bookDetails')"
                      >
                        <ExternalLink :size="14" aria-hidden="true" />
                        <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
                      </RouterLink>
                    </div>
                    <span v-if="authorLine(request)" class="block truncate text-xs text-muted-foreground">{{ authorLine(request) }}</span>
                  </div>
                </div>
              </td>

              <td v-else-if="column === 'mediaKind'" class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <span v-if="isPair(request)" class="inline-flex items-center gap-1" :title="t('bookRequests.table.pairMedia')">
                  <component
                    :is="mediaIcon(half)"
                    v-for="half in orderedHalves(request)"
                    :key="half.id"
                    :size="16"
                    :class="mediaColor(half)"
                    aria-hidden="true"
                  />
                  <span class="sr-only">{{ t('bookRequests.table.pairMedia') }}</span>
                </span>
                <span v-else class="inline-flex" :title="mediaLabel(request)">
                  <component :is="mediaIcon(request)" :size="16" :class="mediaColor(request)" aria-hidden="true" />
                  <span class="sr-only">{{ mediaLabel(request) }}</span>
                </span>
              </td>

              <td
                v-else-if="column === 'released'"
                class="truncate px-3 text-xs text-muted-foreground tabular-nums"
                :class="isCompact ? 'py-1.5' : 'py-2.5'"
              >
                <div v-if="isPair(request)" class="flex flex-col gap-1">
                  <div v-for="half in orderedHalves(request)" :key="half.id" class="flex h-6 min-w-0 items-center gap-1.5">
                    <component :is="mediaIcon(half)" :size="13" :class="mediaColor(half)" class="shrink-0" aria-hidden="true" />
                    <span class="sr-only">{{ mediaLabel(half) }}</span>
                    <span class="truncate">{{ releasedLabel(half) }}</span>
                  </div>
                </div>
                <template v-else>{{ releasedLabel(request) }}</template>
              </td>

              <td v-else-if="column === 'requester'" class="truncate px-3 text-muted-foreground" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <span :title="request.requesterName">{{ request.requesterName }}</span>
              </td>

              <td
                v-else-if="column === 'age'"
                class="truncate px-3 text-xs text-muted-foreground tabular-nums"
                :class="isCompact ? 'py-1.5' : 'py-2.5'"
              >
                {{ formatRelativeFromNow(new Date(request.createdAt)) }}
              </td>

              <!-- Pipeline and State were two columns saying one thing; the stage bar rides the chip. -->
              <td v-else-if="column === 'state'" class="overflow-hidden px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <!--
                A pair is two lanes, one per half, each on a fixed-height line so the Outcome column's
                lanes line up beside them. The stage bar is left to the drawer: two of them made every
                pair row three times the height of the rows around it.
              -->
                <div v-if="isPair(request)" class="flex flex-col gap-1">
                  <div v-for="half in orderedHalves(request)" :key="half.id" class="flex h-6 items-center gap-1.5">
                    <component :is="mediaIcon(half)" :size="13" :class="mediaColor(half)" aria-hidden="true" />
                    <span class="sr-only">{{ mediaLabel(half) }}</span>
                    <RequestStatusBadge :status="statusFor(half)" />
                    <span v-if="half.selfServe" class="inline-flex text-muted-foreground" :title="t('bookRequests.selfServeBadgeHint')">
                      <Zap :size="12" aria-hidden="true" />
                      <span class="sr-only">{{ t('bookRequests.selfServeBadge') }}</span>
                    </span>
                  </div>
                </div>
                <div v-else class="inline-flex flex-col items-start gap-2">
                  <!--
                  The self-serve marker rides beside the chip rather than under it. Stacked, it added a
                  line to this cell and left the table ragged: rows carrying it stood 19px taller than
                  rows that did not. The column has room for a chip plus an icon and not for a chip
                  plus a second pill, so the label moves into the tooltip and the screen-reader text.
                -->
                  <div class="inline-flex items-center gap-1.5">
                    <RequestStatusBadge :status="statusFor(request)" />
                    <span v-if="request.selfServe" class="inline-flex text-muted-foreground" :title="t('bookRequests.selfServeBadgeHint')">
                      <Zap :size="12" aria-hidden="true" />
                      <span class="sr-only">{{ t('bookRequests.selfServeBadge') }}</span>
                    </span>
                  </div>
                  <RequestPipeline v-if="!isCompact" :request="request" :live="liveFor(request)" compact />
                  <span v-if="request.dismissed" class="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <EyeOff :size="11" aria-hidden="true" />
                    {{ t('bookRequests.card.dismissedBadge') }}
                  </span>
                </div>
              </td>

              <td v-else-if="column === 'tracking'" class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <div v-if="isPair(request)" class="flex flex-col gap-1">
                  <div v-for="half in orderedHalves(request)" :key="half.id" class="flex h-6 min-w-0 items-center gap-1.5">
                    <template v-if="showsTracking(half)">
                      <component :is="mediaIcon(half)" :size="13" :class="mediaColor(half)" class="shrink-0" aria-hidden="true" />
                      <RequestTrackingStatusSelect
                        :request="half"
                        :editable="canEditTracking(half)"
                        :busy="busyIds.has(half.id)"
                        @change="handleSetTrackingStatus"
                      />
                    </template>
                  </div>
                </div>
                <RequestTrackingStatusSelect
                  v-else-if="showsTracking(request)"
                  :request="request"
                  :editable="canEditTracking(request)"
                  :busy="busyIds.has(request.id)"
                  @change="handleSetTrackingStatus"
                />
              </td>

              <td v-else-if="column === 'outcome'" class="overflow-hidden px-3 text-xs" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <div v-if="isPair(request)" class="flex flex-col gap-1">
                  <div v-for="half in orderedHalves(request)" :key="half.id" class="flex h-6 min-w-0 items-center gap-2">
                    <template v-if="outcomeFor(half).kind === 'progress'">
                      <div
                        class="h-1.5 w-full max-w-20 shrink-0 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        :aria-valuenow="progressFor(half)?.percent ?? 0"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        :aria-label="t('bookRequests.download.progressLabel', { title: `${half.title} (${mediaLabel(half)})` })"
                      >
                        <div
                          class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                          :style="{ width: `${progressFor(half)?.percent ?? 0}%` }"
                        />
                      </div>
                      <span class="text-muted-foreground tabular-nums">{{ percentLabel(half) }}</span>
                    </template>
                    <span v-else-if="isFailure(half)" class="truncate text-destructive" :title="failureFor(half) ?? undefined">
                      {{ failureFor(half) ?? t('bookRequests.outcome.failedUnknown') }}
                    </span>
                    <span v-else-if="failureFor(half)" class="truncate text-muted-foreground" :title="failureFor(half) ?? undefined">
                      {{ failureFor(half) }}
                    </span>
                    <span v-else class="truncate text-muted-foreground">
                      {{ t(`bookRequests.outcome.${outcomeFor(half).key}`, outcomeFor(half).params ?? {}) }}
                    </span>
                  </div>
                </div>
                <template v-else-if="outcomeFor(request).kind === 'progress'">
                  <div
                    class="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    :aria-valuenow="progressFor(request)?.percent ?? 0"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="t('bookRequests.download.progressLabel', { title: request.title })"
                  >
                    <div
                      class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                      :style="{ width: `${progressFor(request)?.percent ?? 0}%` }"
                    />
                  </div>
                  <p class="mt-1 text-muted-foreground tabular-nums">
                    {{ percentLabel(request) }}
                    <template v-if="transferLine(request)">&middot; {{ transferLine(request) }}</template>
                  </p>
                </template>

                <p v-else-if="isFailure(request)" class="line-clamp-2 text-destructive">
                  {{ failureFor(request) ?? t('bookRequests.outcome.failedUnknown') }}
                </p>

                <!--
                A request automation handed back is still `approved`, and the stage line for that state
                reads "Looking for a release" - which is the one thing nothing is doing for it. When
                there is a reason on the row, the reason is the outcome.
              -->
                <p v-else-if="failureFor(request)" class="line-clamp-2 text-muted-foreground">
                  {{ failureFor(request) }}
                </p>

                <p v-else class="text-muted-foreground">
                  {{ t(`bookRequests.outcome.${outcomeFor(request).key}`, outcomeFor(request).params ?? {}) }}
                </p>
              </td>

              <td v-else-if="column === 'actions'" class="px-3" :class="isCompact ? 'py-1.5' : 'py-2.5'">
                <div
                  class="flex items-center justify-end gap-1"
                  :class="
                    actionsAreQuiet(request) &&
                    'opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none'
                  "
                >
                  <RequestPairRowActions
                    v-if="isPair(request)"
                    :row="request"
                    :can-manage="canManage"
                    :can-self-fulfil="canSelfFulfil"
                    :current-user-id="currentUserId"
                    :busy="isRowBusy(request)"
                    @open="handleOpen"
                    @grab="handleGrab"
                    @approve="handlePairApprove"
                    @reject="handlePairReject"
                    @cancel="handlePairCancel"
                    @dismiss="handlePairDismiss"
                    @restore="handlePairRestore"
                  />
                  <RequestRowActions
                    v-else
                    :request="request"
                    :can-manage="canManage"
                    :can-self-fulfil="canSelfFulfil"
                    :current-user-id="currentUserId"
                    :busy="busyIds.has(request.id)"
                    @open="handleOpen"
                    @approve="handleApprove"
                    @reject="handleReject"
                    @grab="handleGrab"
                    @dismiss="handleDismiss"
                    @restore="handleRestore"
                    @cancel="handleCancel"
                    @remove="handleRemove"
                  />
                </div>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Below `lg` the same rows stack. Same data, same actions, no second component to keep in step. -->
    <ul class="divide-y divide-border/60 lg:hidden">
      <li v-for="request in requests" :key="request.id" class="p-3" :class="rowDismissed(request) && 'opacity-60'">
        <div class="flex min-w-0 gap-3">
          <input
            v-if="isSelectable(request)"
            type="checkbox"
            class="mt-1 h-3.5 w-3.5 shrink-0 rounded-xs border-border accent-primary"
            :checked="isSelected(request)"
            :aria-label="t('bookRequests.table.selectRow', { title: request.title })"
            @change="handleToggleSelect(request)"
          />
          <RequestPairCover
            v-if="isPair(request)"
            :ebook-src="halfCover(request, 'ebook')"
            :audio-src="halfCover(request, 'audiobook')"
            :ebook-fallbacks="halfBookCovers(request, 'ebook')"
            :audio-fallbacks="halfBookCovers(request, 'audiobook')"
            class="me-1.5 h-[54px] w-9"
            :icon-size="16"
          />
          <RequestCover
            v-else
            :src="request.coverUrl"
            :fallback-sources="requestBookCoverSources(request)"
            :media-kind="request.mediaKind"
            class="h-[54px] w-9"
            :icon-size="16"
          />

          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="flex min-w-0 items-center gap-2">
              <button
                type="button"
                class="min-w-0 truncate text-start font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                @click="handleOpen(request)"
              >
                {{ request.title }}
              </button>
              <RouterLink
                v-if="landedBookId(request) !== null"
                :to="{ name: 'book-detail', params: { bookId: landedBookId(request) } }"
                class="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                :title="t('book.actions.bookDetails')"
              >
                <ExternalLink :size="14" aria-hidden="true" />
                <span class="sr-only">{{ t('book.actions.bookDetails') }}</span>
              </RouterLink>
            </div>
            <p v-if="authorLine(request)" class="truncate text-xs text-muted-foreground">{{ authorLine(request) }}</p>
            <p class="text-xs text-muted-foreground tabular-nums">
              {{ t('bookRequests.card.releasedOn', { date: releasedLabel(request) }) }}
            </p>

            <!-- A pair stacks one line per half: the medium, its stage, and what is happening to it. -->
            <template v-if="isPair(request)">
              <div v-for="half in orderedHalves(request)" :key="half.id" class="flex min-w-0 flex-wrap items-center gap-2">
                <component :is="mediaIcon(half)" :size="14" :class="mediaColor(half)" aria-hidden="true" />
                <span class="sr-only">{{ mediaLabel(half) }}</span>
                <RequestStatusBadge :status="statusFor(half)" />
                <RequestTrackingStatusSelect
                  v-if="showsTracking(half)"
                  :request="half"
                  :editable="canEditTracking(half)"
                  :busy="busyIds.has(half.id)"
                  @change="handleSetTrackingStatus"
                />
                <span v-if="outcomeFor(half).kind === 'progress'" class="text-xs text-muted-foreground tabular-nums">{{ percentLabel(half) }}</span>
                <span
                  v-else-if="failureFor(half)"
                  class="min-w-0 truncate text-xs"
                  :class="isFailure(half) ? 'text-destructive' : 'text-muted-foreground'"
                >
                  {{ failureFor(half) }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('bookRequests.card.requestedByAt', { name: request.requesterName, time: formatRelativeFromNow(new Date(request.createdAt)) }) }}
              </p>
            </template>

            <div v-else class="flex flex-wrap items-center gap-2">
              <RequestStatusBadge :status="statusFor(request)" />
              <span
                v-if="request.selfServe"
                class="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
                :title="t('bookRequests.selfServeBadgeHint')"
              >
                <Zap :size="11" aria-hidden="true" />
                {{ t('bookRequests.selfServeBadge') }}
              </span>
              <span class="inline-flex" :title="mediaLabel(request)">
                <component :is="mediaIcon(request)" :size="15" :class="mediaColor(request)" aria-hidden="true" />
                <span class="sr-only">{{ mediaLabel(request) }}</span>
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('bookRequests.card.requestedByAt', { name: request.requesterName, time: formatRelativeFromNow(new Date(request.createdAt)) }) }}
              </span>
              <RequestTrackingStatusSelect
                v-if="showsTracking(request)"
                :request="request"
                :editable="canEditTracking(request)"
                :busy="busyIds.has(request.id)"
                @change="handleSetTrackingStatus"
              />
            </div>

            <!--
              A reason is no longer proof of a failure. Automation now hands a request back with one
              written on it while the row sits at `approved`, and rendering that in alarm red under a
              blue chip says two different things about the same row.
            -->
            <template v-if="isPair(request)" />
            <p
              v-else-if="failureFor(request)"
              class="flex items-start gap-1.5 text-xs"
              :class="isFailure(request) ? 'text-destructive' : 'text-muted-foreground'"
            >
              <TriangleAlert v-if="isFailure(request)" :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />
              <span class="line-clamp-2">{{ failureFor(request) }}</span>
            </p>
            <p v-else-if="outcomeFor(request).kind === 'progress'" class="text-xs text-muted-foreground tabular-nums">
              {{ percentLabel(request) }}
              <template v-if="transferLine(request)">&middot; {{ transferLine(request) }}</template>
            </p>
            <p v-else class="text-xs text-muted-foreground">
              {{ t(`bookRequests.outcome.${outcomeFor(request).key}`, outcomeFor(request).params ?? {}) }}
            </p>
          </div>

          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <RequestPairRowActions
              v-if="isPair(request)"
              :row="request"
              :can-manage="canManage"
              :can-self-fulfil="canSelfFulfil"
              :current-user-id="currentUserId"
              :busy="isRowBusy(request)"
              @open="handleOpen"
              @grab="handleGrab"
              @approve="handlePairApprove"
              @reject="handlePairReject"
              @cancel="handlePairCancel"
              @dismiss="handlePairDismiss"
              @restore="handlePairRestore"
            />
            <RequestRowActions
              v-else
              :request="request"
              :can-manage="canManage"
              :can-self-fulfil="canSelfFulfil"
              :current-user-id="currentUserId"
              :busy="busyIds.has(request.id)"
              @open="handleOpen"
              @approve="handleApprove"
              @reject="handleReject"
              @grab="handleGrab"
              @dismiss="handleDismiss"
              @restore="handleRestore"
              @cancel="handleCancel"
              @remove="handleRemove"
            />
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
