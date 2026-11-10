import { computed, ref } from 'vue'

/**
 * The request table's optional columns, in display order. The checkbox and actions columns are not
 * listed: one is how bulk actions work and the other is how anything gets done to a row.
 */
export const REQUEST_TABLE_COLUMNS = ['title', 'mediaKind', 'released', 'requester', 'age', 'state', 'tracking', 'outcome'] as const
export type RequestTableColumn = (typeof REQUEST_TABLE_COLUMNS)[number]

/**
 * Starting widths in pixels. Title has none until it is resized: it takes whatever the other
 * columns leave, but never less than `TITLE_MIN_WIDTH`, so it cannot be squeezed to nothing.
 */
export const DEFAULT_COLUMN_WIDTHS: Record<RequestTableColumn, number> = {
  title: 280,
  mediaKind: 72,
  released: 112,
  requester: 128,
  age: 104,
  state: 160,
  tracking: 184,
  outcome: 240,
}

export const TITLE_MIN_WIDTH = 220

/** Narrower than this and a header's own label and sort arrow no longer fit. */
export const MIN_COLUMN_WIDTH = 72
const MAX_COLUMN_WIDTH = 800

/** Fixed columns that are always shown. */
export const SELECT_COLUMN_WIDTH = 40
export const ACTIONS_COLUMN_WIDTH = 220

/** Title can never be hidden: it is what the row is. */
export const LOCKED_COLUMNS: readonly RequestTableColumn[] = ['title']

const STORAGE_KEY = 'bookorbit.requests.columns.v1'

interface StoredColumns {
  hidden: RequestTableColumn[]
  widths: Partial<Record<RequestTableColumn, number>>
}

function isColumn(value: unknown): value is RequestTableColumn {
  return typeof value === 'string' && (REQUEST_TABLE_COLUMNS as readonly string[]).includes(value)
}

function clampWidth(value: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value)))
}

function readStored(): StoredColumns {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { hidden: [], widths: {} }
    const parsed = JSON.parse(raw) as Partial<StoredColumns>
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter(isColumn).filter((column) => !LOCKED_COLUMNS.includes(column)) : []
    const widths: Partial<Record<RequestTableColumn, number>> = {}
    for (const [key, value] of Object.entries(parsed.widths ?? {})) {
      if (isColumn(key) && typeof value === 'number' && Number.isFinite(value)) widths[key] = clampWidth(value)
    }
    return { hidden, widths }
  } catch {
    // Blocked storage or a damaged value: start from the defaults rather than failing the page.
    return { hidden: [], widths: {} }
  }
}

/** Module-level so the layout holds while switching between the two list tabs. */
const stored = readStored()
const hidden = ref<RequestTableColumn[]>(stored.hidden)
const widths = ref<Partial<Record<RequestTableColumn, number>>>(stored.widths)

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: hidden.value, widths: widths.value } satisfies StoredColumns))
  } catch {
    // A layout that cannot be saved still applies for this session.
  }
}

export function useRequestTableColumns() {
  const visibleColumns = computed(() => REQUEST_TABLE_COLUMNS.filter((column) => !hidden.value.includes(column)))

  function isVisible(column: RequestTableColumn): boolean {
    return !hidden.value.includes(column)
  }

  function setVisible(column: RequestTableColumn, visible: boolean): void {
    if (LOCKED_COLUMNS.includes(column)) return
    hidden.value = visible ? hidden.value.filter((entry) => entry !== column) : [...new Set([...hidden.value, column])]
    persist()
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
    widths.value = { ...widths.value, [column]: clampWidth(width) }
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
    persist()
  }

  const isCustomized = computed(() => hidden.value.length > 0 || Object.keys(widths.value).length > 0)

  return { visibleColumns, isVisible, setVisible, widthOf, storedWidthOf, setWidth, resetWidth, commitWidths, reset, isCustomized }
}
