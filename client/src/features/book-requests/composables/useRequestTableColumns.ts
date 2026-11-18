import { computed, ref } from 'vue'

/**
 * The request table's columns, in their default order. Only the selection checkbox sits outside
 * this list: it is how bulk actions work, so it always leads the row.
 */
export const REQUEST_TABLE_COLUMNS = ['book', 'requested', 'released', 'status', 'tracking', 'nextStep', 'actions'] as const
export type RequestTableColumn = (typeof REQUEST_TABLE_COLUMNS)[number]

/**
 * Starting widths in pixels. The book column has none: it takes whatever the others leave, and
 * never less than `BOOK_MIN_WIDTH`, which is what keeps the table from scrolling sideways.
 */
export const DEFAULT_COLUMN_WIDTHS: Record<Exclude<RequestTableColumn, 'book'>, number> = {
  requested: 128,
  released: 104,
  status: 160,
  tracking: 168,
  nextStep: 220,
  actions: 176,
}

/** The approver queue names the requester above the time, so its column starts wider. */
export const REQUESTED_WITH_REQUESTER_WIDTH = 160

export const BOOK_MIN_WIDTH = 220

/** Narrower than this and a header's own label and sort arrow no longer fit. */
export const MIN_COLUMN_WIDTH = 72
export const MAX_COLUMN_WIDTH = 480

export const SELECT_COLUMN_WIDTH = 44

/** The book can never be hidden: it is what the row is, and how a request is opened. */
export const LOCKED_COLUMNS: readonly RequestTableColumn[] = ['book']

const STORAGE_KEY = 'bookorbit.requests.columns.v2'

interface StoredColumns {
  hidden: RequestTableColumn[]
  widths: Partial<Record<RequestTableColumn, number>>
  order?: RequestTableColumn[]
}

function isColumn(value: unknown): value is RequestTableColumn {
  return typeof value === 'string' && (REQUEST_TABLE_COLUMNS as readonly string[]).includes(value)
}

function clampWidth(value: number, max = MAX_COLUMN_WIDTH): number {
  const ceiling = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, max))
  return Math.round(Math.min(ceiling, Math.max(MIN_COLUMN_WIDTH, value)))
}

/**
 * A saved order from before a column existed is kept, and each missing column goes back beside the
 * column it follows by default, so a new column lands where it would have been.
 */
export function completeOrder(saved: readonly unknown[]): RequestTableColumn[] {
  const order = [...new Set(saved.filter(isColumn))]
  REQUEST_TABLE_COLUMNS.forEach((column, index) => {
    if (order.includes(column)) return
    const before = REQUEST_TABLE_COLUMNS.slice(0, index)
      .reverse()
      .find((previous) => order.includes(previous))
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, column)
  })
  return order
}

function readStored(): Required<StoredColumns> {
  const empty = { hidden: [], widths: {}, order: [...REQUEST_TABLE_COLUMNS] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<StoredColumns>
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter(isColumn).filter((column) => !LOCKED_COLUMNS.includes(column)) : []
    const widths: Partial<Record<RequestTableColumn, number>> = {}
    for (const [key, value] of Object.entries(parsed.widths ?? {})) {
      if (isColumn(key) && key !== 'book' && typeof value === 'number' && Number.isFinite(value)) widths[key] = clampWidth(value)
    }
    const order = completeOrder(Array.isArray(parsed.order) ? parsed.order : [])
    return { hidden, widths, order }
  } catch {
    // Blocked storage or a damaged value: start from the defaults rather than failing the page.
    return empty
  }
}

/** Module-level so the layout holds while switching between the two list tabs. */
const stored = readStored()
const hidden = ref<RequestTableColumn[]>(stored.hidden)
const widths = ref<Partial<Record<RequestTableColumn, number>>>(stored.widths)
const order = ref<RequestTableColumn[]>(stored.order)

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: hidden.value, widths: widths.value, order: order.value } satisfies StoredColumns))
  } catch {
    // A layout that cannot be saved still applies for this session.
  }
}

function isDefaultOrder(): boolean {
  return order.value.every((column, index) => column === REQUEST_TABLE_COLUMNS[index])
}

export function useRequestTableColumns() {
  const orderedColumns = computed(() => order.value)
  const visibleColumns = computed(() => order.value.filter((column) => !hidden.value.includes(column)))

  function isVisible(column: RequestTableColumn): boolean {
    return !hidden.value.includes(column)
  }

  function setVisible(column: RequestTableColumn, visible: boolean): void {
    if (LOCKED_COLUMNS.includes(column)) return
    hidden.value = visible ? hidden.value.filter((entry) => entry !== column) : [...new Set([...hidden.value, column])]
    persist()
  }

  /** Puts `column` where `target` is now, on the side it was dragged from. */
  function moveTo(column: RequestTableColumn, target: RequestTableColumn): void {
    if (column === target) return
    const next = order.value.filter((entry) => entry !== column)
    const from = order.value.indexOf(column)
    const to = order.value.indexOf(target)
    next.splice(next.indexOf(target) + (from < to ? 1 : 0), 0, column)
    order.value = next
    persist()
  }

  /** One step left or right among the columns that are showing, for the keyboard and the menu. */
  function moveBy(column: RequestTableColumn, step: -1 | 1): void {
    const visible = visibleColumns.value
    const target = visible[visible.indexOf(column) + step]
    if (target) moveTo(column, target)
  }

  function canMove(column: RequestTableColumn, step: -1 | 1): boolean {
    const visible = visibleColumns.value
    const index = visible.indexOf(column)
    return index !== -1 && visible[index + step] !== undefined
  }

  /** The width a fixed column is drawn at before the table caps it; `fallback` replaces its default. */
  function widthOf(column: Exclude<RequestTableColumn, 'book'>, fallback?: number): number {
    return widths.value[column] ?? fallback ?? DEFAULT_COLUMN_WIDTHS[column]
  }

  /**
   * Applied live while dragging; `commitWidths` saves once the drag ends. `max` is how much room
   * the table has left for this column, so a drag can never push the book below its minimum.
   */
  function setWidth(column: RequestTableColumn, width: number, max?: number): void {
    if (column === 'book') return
    widths.value = { ...widths.value, [column]: clampWidth(width, max) }
  }

  function resetWidth(column: RequestTableColumn): void {
    const { [column]: _removed, ...rest } = widths.value
    widths.value = rest
    persist()
  }

  function commitWidths(): void {
    persist()
  }

  function reset(): void {
    hidden.value = []
    widths.value = {}
    order.value = [...REQUEST_TABLE_COLUMNS]
    persist()
  }

  const isCustomized = computed(() => hidden.value.length > 0 || Object.keys(widths.value).length > 0 || !isDefaultOrder())

  return {
    orderedColumns,
    visibleColumns,
    isVisible,
    setVisible,
    moveTo,
    moveBy,
    canMove,
    widthOf,
    setWidth,
    resetWidth,
    commitWidths,
    reset,
    isCustomized,
  }
}
