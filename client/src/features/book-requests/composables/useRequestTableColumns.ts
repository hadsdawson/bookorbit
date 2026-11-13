import { computed, ref } from 'vue'

/**
 * The request table's columns, in their default order. Only the selection checkbox sits outside
 * this list: it is how bulk actions work, so it always leads the row.
 */
export const REQUEST_TABLE_COLUMNS = [
  'cover',
  'title',
  'mediaKind',
  'released',
  'requester',
  'age',
  'state',
  'tracking',
  'outcome',
  'actions',
] as const
export type RequestTableColumn = (typeof REQUEST_TABLE_COLUMNS)[number]

/**
 * Starting widths in pixels. Title has none until it is resized: it takes whatever the other
 * columns leave, but never less than `TITLE_MIN_WIDTH`, so it cannot be squeezed to nothing.
 */
export const DEFAULT_COLUMN_WIDTHS: Record<RequestTableColumn, number> = {
  cover: 56,
  title: 280,
  mediaKind: 72,
  released: 112,
  requester: 128,
  age: 104,
  state: 160,
  tracking: 196,
  outcome: 240,
  actions: 220,
}

export const TITLE_MIN_WIDTH = 220

/** Narrower than this and a header's own label and sort arrow no longer fit. */
export const MIN_COLUMN_WIDTH = 72
const MAX_COLUMN_WIDTH = 800

/** The cover column sizes the cover itself, so it runs from a thumbnail to a small poster. */
export const COVER_MIN_WIDTH = 40
export const COVER_MAX_WIDTH = 240
/** Horizontal padding inside the cover cell; the cover fills the rest. */
export const COVER_CELL_PADDING = 24

export const SELECT_COLUMN_WIDTH = 40

/** Title can never be hidden: it is what the row is, and how a request is opened. */
export const LOCKED_COLUMNS: readonly RequestTableColumn[] = ['title']

const STORAGE_KEY = 'bookorbit.requests.columns.v1'

interface StoredColumns {
  hidden: RequestTableColumn[]
  widths: Partial<Record<RequestTableColumn, number>>
  order?: RequestTableColumn[]
}

function isColumn(value: unknown): value is RequestTableColumn {
  return typeof value === 'string' && (REQUEST_TABLE_COLUMNS as readonly string[]).includes(value)
}

function clampWidth(column: RequestTableColumn, value: number): number {
  const [min, max] = column === 'cover' ? [COVER_MIN_WIDTH, COVER_MAX_WIDTH] : [MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]
  return Math.round(Math.min(max, Math.max(min, value)))
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
      if (isColumn(key) && typeof value === 'number' && Number.isFinite(value)) widths[key] = clampWidth(key, value)
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

  function widthOf(column: RequestTableColumn): number {
    return widths.value[column] ?? DEFAULT_COLUMN_WIDTHS[column]
  }

  /** Null while the title column is still flexible. */
  function storedWidthOf(column: RequestTableColumn): number | null {
    return widths.value[column] ?? null
  }

  /** Applied live while dragging; `commitWidths` saves once the drag ends. */
  function setWidth(column: RequestTableColumn, width: number): void {
    widths.value = { ...widths.value, [column]: clampWidth(column, width) }
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
    storedWidthOf,
    setWidth,
    resetWidth,
    commitWidths,
    reset,
    isCustomized,
  }
}
