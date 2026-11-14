import { ref, watch, type Ref } from 'vue'
import type { AuthorLink, AuthorSummary } from '@bookorbit/types'
import { fetchAuthorLinks, fetchAuthors, linkAuthor, unlinkAuthor } from '../api/author'

const SEARCH_DELAY_MS = 250

/** Fork: the other names an author writes under, and linking or unlinking them. */
export function useAuthorLinks(authorId: Ref<number>) {
  const links = ref<AuthorLink[]>([])
  const query = ref('')
  const candidates = ref<AuthorSummary[]>([])
  const searching = ref(false)
  const busy = ref(false)
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  async function load() {
    const id = authorId.value
    try {
      const result = await fetchAuthorLinks(id)
      if (id === authorId.value) links.value = result
    } catch {
      if (id === authorId.value) links.value = []
    }
  }

  async function search() {
    const term = query.value.trim()
    const seq = ++searchSeq
    if (!term) {
      candidates.value = []
      searching.value = false
      return
    }
    searching.value = true
    try {
      const page = await fetchAuthors({ q: term, page: 0, size: 10, sort: 'name', order: 'asc', libraryId: null })
      if (seq !== searchSeq) return
      const linked = new Set(links.value.map((link) => link.id))
      candidates.value = page.items.filter((candidate) => candidate.id !== authorId.value && !linked.has(candidate.id))
    } catch {
      if (seq === searchSeq) candidates.value = []
    } finally {
      if (seq === searchSeq) searching.value = false
    }
  }

  async function link(otherId: number) {
    busy.value = true
    try {
      links.value = await linkAuthor(authorId.value, otherId)
      query.value = ''
      candidates.value = []
    } finally {
      busy.value = false
    }
  }

  async function unlink(otherId: number) {
    busy.value = true
    try {
      links.value = await unlinkAuthor(authorId.value, otherId)
    } finally {
      busy.value = false
    }
  }

  watch(query, () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void search(), SEARCH_DELAY_MS)
  })
  watch(authorId, () => {
    query.value = ''
    candidates.value = []
    void load()
  })

  return { links, query, candidates, searching, busy, load, link, unlink }
}
