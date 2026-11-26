import { computed, ref, type Ref } from 'vue'
import type { BookCard, SplitSeriesBooksResult } from '@bookorbit/types'
import { fetchSeriesBooks, splitSeriesBooks } from '../api/series'

const PAGE_SIZE = 100

export type SplitBookRow = { id: number; title: string; authors: string[]; seriesIndex: string | null }

export type SplitAuthorGroup = { name: string; bookIds: number[] }

function toRow(book: BookCard, seriesId: number): SplitBookRow {
  const membership = book.seriesMemberships?.find((m) => m.seriesId === seriesId)
  return { id: book.id, title: book.title ?? '', authors: book.authors, seriesIndex: membership?.seriesIndex ?? book.seriesIndex ?? null }
}

/**
 * Fork. State for splitting a series: its books, loaded a page at a time without folding linked
 * editions (each edition is its own book in the series), the ticked ones, and the new name.
 */
export function useSeriesSplit(seriesId: Ref<number | null>, seriesName: Ref<string>) {
  const rows = ref<SplitBookRow[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref(false)
  const selected = ref(new Set<number>())
  const name = ref('')
  const writeFiles = ref(false)
  const submitting = ref(false)
  let page = 0
  let token = 0

  const hasMore = computed(() => rows.value.length < total.value)
  const selectedCount = computed(() => selected.value.size)
  const canSubmit = computed(() => selected.value.size > 0 && selected.value.size < total.value && name.value.trim().length > 0 && !submitting.value)

  /** Authors with the books they are on, most books first, so a whole author's books can be ticked at once. */
  const authorGroups = computed<SplitAuthorGroup[]>(() => {
    const byAuthor = new Map<string, number[]>()
    for (const row of rows.value) for (const author of row.authors) byAuthor.set(author, [...(byAuthor.get(author) ?? []), row.id])
    return [...byAuthor.entries()]
      .map(([groupName, bookIds]) => ({ name: groupName, bookIds }))
      .sort((a, b) => b.bookIds.length - a.bookIds.length || a.name.localeCompare(b.name))
  })

  async function loadMore() {
    const id = seriesId.value
    if (id == null || loading.value) return
    const ticket = token
    loading.value = true
    error.value = false
    try {
      const data = await fetchSeriesBooks(id, { page, size: PAGE_SIZE, sort: 'seriesIndex', order: 'asc' })
      if (ticket !== token) return
      rows.value = [...rows.value, ...data.items.map((book) => toRow(book, id))]
      total.value = data.total
      page += 1
    } catch {
      if (ticket === token) error.value = true
    } finally {
      if (ticket === token) loading.value = false
    }
  }

  async function open() {
    token += 1
    rows.value = []
    total.value = 0
    page = 0
    selected.value = new Set()
    name.value = seriesName.value
    writeFiles.value = false
    loading.value = false
    await loadMore()
  }

  function toggle(bookId: number) {
    const next = new Set(selected.value)
    if (next.has(bookId)) next.delete(bookId)
    else next.add(bookId)
    selected.value = next
  }

  function isSelected(bookId: number) {
    return selected.value.has(bookId)
  }

  function isGroupSelected(group: SplitAuthorGroup) {
    return group.bookIds.every((id) => selected.value.has(id))
  }

  function toggleGroup(group: SplitAuthorGroup) {
    const next = new Set(selected.value)
    const all = isGroupSelected(group)
    for (const id of group.bookIds) {
      if (all) next.delete(id)
      else next.add(id)
    }
    selected.value = next
  }

  async function submit(): Promise<SplitSeriesBooksResult> {
    const id = seriesId.value
    if (id == null) throw new Error('No series')
    submitting.value = true
    try {
      const trimmed = name.value.trim()
      return await splitSeriesBooks({
        seriesId: id,
        bookIds: [...selected.value],
        ...(trimmed !== seriesName.value.trim() ? { name: trimmed } : {}),
        writeFiles: writeFiles.value,
      })
    } finally {
      submitting.value = false
    }
  }

  return {
    rows,
    total,
    loading,
    error,
    hasMore,
    name,
    writeFiles,
    submitting,
    selectedCount,
    canSubmit,
    authorGroups,
    open,
    loadMore,
    toggle,
    isSelected,
    isGroupSelected,
    toggleGroup,
    submit,
  }
}
