import { ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'

export type AuthorAliasHint = { alias: string; name: string }

const LOOKUP_DELAY_MS = 300

/**
 * Fork: spots typed author names that are an author's alternate name, so the editor can ask
 * "did you mean". Saving would credit the main author anyway; this shows it before the save.
 */
export function useAuthorAliasHints(authors: Ref<string[]>) {
  const hints = ref<AuthorAliasHint[]>([])
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0

  async function lookup(names: string[]) {
    const current = ++seq
    if (names.length === 0) {
      hints.value = []
      return
    }
    try {
      const res = await api('/api/v1/metadata/authors/resolve-aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: names.slice(0, 50) }),
      })
      if (current !== seq) return
      hints.value = res.ok ? ((await res.json()) as AuthorAliasHint[]) : []
    } catch {
      if (current === seq) hints.value = []
    }
  }

  function applyHint(hint: AuthorAliasHint) {
    const next: string[] = []
    for (const name of authors.value) {
      const replaced = name === hint.alias ? hint.name : name
      if (!next.includes(replaced)) next.push(replaced)
    }
    authors.value = next
  }

  watch(
    () => authors.value.join('\u0000'),
    () => {
      if (timer) clearTimeout(timer)
      const names = [...authors.value]
      timer = setTimeout(() => void lookup(names), LOOKUP_DELAY_MS)
    },
    { immediate: true },
  )

  return { hints, applyHint }
}
