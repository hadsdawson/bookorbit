<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  role: string
  /** The file's name, which says which cover it is, or that it is the metadata file. */
  fileName?: string
  /** Whether the book has audio, which makes a plain cover.jpg the audiobook's cover. */
  hasAudio?: boolean
}>()
const { t } = useI18n()

/**
 * `supplement` and `cover` are real roles the scanner assigns and the old tab never showed, so a
 * folder looked like six interchangeable copies of the book when two of them are not copies at all.
 */
const ROLES: Record<string, { label: string; class: string }> = {
  supplement: { label: 'book.detail.files.roles.supplement', class: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  cover: { label: 'book.detail.files.roles.cover', class: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
}

const COVER_CLASS = ROLES.cover!.class
const METADATA = { label: 'book.detail.files.roles.metadata', class: 'bg-muted text-muted-foreground' }

/**
 * Fork: the folder files BookOrbit writes say what they are. cover-ebook.* is the ebook's cover;
 * cover.* is the audiobook's when the book has audio, and otherwise the only (ebook) cover.
 */
function folderFileRole(name: string): { label: string; class: string } | null {
  const lower = name.toLowerCase()
  if (lower === 'metadata.json') return METADATA
  if (props.role !== 'cover') return null
  if (lower.startsWith('cover-ebook.')) return { label: 'book.detail.files.roles.ebookCover', class: COVER_CLASS }
  if (lower.startsWith('cover.')) {
    return { label: props.hasAudio ? 'book.detail.files.roles.audiobookCover' : 'book.detail.files.roles.ebookCover', class: COVER_CLASS }
  }
  return null
}

const role = computed(() => (props.fileName ? folderFileRole(props.fileName) : null) ?? ROLES[props.role] ?? null)
</script>

<template>
  <span
    v-if="role"
    class="inline-flex h-[18px] shrink-0 items-center rounded-xs px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
    :class="role.class"
  >
    {{ t(role.label) }}
  </span>
</template>
