<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Tags, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { AUTHOR_NAME_KINDS, type AuthorNameKind, type AuthorNames } from '@bookorbit/types'

import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import { useAuthorSearch } from '@/features/book/composables/useAuthorSearch'
import { addAuthorName, removeAuthorSpelling, unlinkAuthorPenName } from '../api/author'

const props = defineProps<{ authorId: number; authorName: string; names: AuthorNames; canEdit: boolean }>()
const emit = defineEmits<{ 'update:names': [names: AuthorNames]; changed: []; open: [authorId: number] }>()

const { t } = useI18n()
const { search: searchAuthorNames } = useAuthorSearch()
const adding = ref(false)
const draft = ref<string | null>('')
const kind = ref<AuthorNameKind>('penName')
const busy = ref(false)
const total = computed(() => props.names.spellings.length + props.names.penNames.length)
const visible = computed(() => total.value > 0 || props.canEdit)
const kindHint = computed(() => t(`author.detail.aliases.kinds.${kind.value}.hint`, { name: props.authorName }))

function setNames(next: AuthorNames) {
  emit('update:names', next)
}

async function searchSuggestions(query: string): Promise<string[]> {
  const found = await searchAuthorNames(query)
  const own = props.authorName.trim().toLowerCase()
  return found.filter((name) => name.trim().toLowerCase() !== own)
}

function toggleAdding() {
  adding.value = !adding.value
  if (!adding.value) draft.value = ''
}

function handleKindChange(event: Event) {
  kind.value = (event.target as HTMLSelectElement).value as AuthorNameKind
}

async function submitName() {
  const name = draft.value?.trim() ?? ''
  if (!name || busy.value) return
  busy.value = true
  try {
    const result = await addAuthorName(props.authorId, name, kind.value)
    draft.value = ''
    adding.value = false
    if (result.openAuthorId !== null) {
      toast.success(t('author.detail.aliases.mainNameAdded', { name }))
      emit('open', result.openAuthorId)
      return
    }
    setNames(result.names)
    if (result.mergedAuthorCount > 0) {
      emit('changed')
      toast.success(t('author.detail.aliases.addedAndCombined', { books: result.affectedBookCount }))
    } else {
      toast.success(t('author.detail.aliases.added'))
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.aliases.addFailed'))
  } finally {
    busy.value = false
  }
}

async function handleRemoveSpelling(aliasId: number) {
  if (busy.value) return
  busy.value = true
  try {
    setNames(await removeAuthorSpelling(props.authorId, aliasId))
    toast.success(t('author.detail.aliases.removed'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.aliases.removeFailed'))
  } finally {
    busy.value = false
  }
}

async function handleUnlinkPenName(penNameAuthorId: number) {
  if (busy.value) return
  busy.value = true
  try {
    setNames(await unlinkAuthorPenName(props.authorId, penNameAuthorId))
    emit('changed')
    toast.success(t('author.detail.aliases.penNameRemoved'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.aliases.removeFailed'))
  } finally {
    busy.value = false
  }
}

watch(
  () => props.authorId,
  () => {
    adding.value = false
    draft.value = ''
  },
)
</script>

<template>
  <section v-if="visible" class="mt-4 rounded-lg border border-border/70 bg-card/60 p-3" :aria-label="t('author.detail.aliases.heading')">
    <div class="flex flex-wrap items-center gap-2">
      <Tags :size="14" class="text-muted-foreground" aria-hidden="true" />
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{{ t('author.detail.aliases.heading') }}</h2>
      <span v-if="total === 0" class="text-xs text-muted-foreground">{{ t('author.detail.aliases.none') }}</span>
      <button
        v-if="canEdit"
        type="button"
        class="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-input px-2.5 text-xs text-foreground hover:bg-muted"
        :aria-expanded="adding"
        @click="toggleAdding"
      >
        <Plus :size="12" />
        {{ t('author.detail.aliases.add') }}
      </button>
    </div>

    <div v-if="names.penNames.length > 0" class="mt-2 flex flex-wrap items-center gap-2" data-testid="author-pen-names">
      <span class="text-[11px] text-muted-foreground">{{ t('author.detail.aliases.penNamesLabel') }}</span>
      <span
        v-for="penName in names.penNames"
        :key="penName.id"
        class="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background/60 pl-3 text-sm"
        :class="canEdit ? 'pr-1' : 'pr-3'"
      >
        <a :href="`#pen-name-${penName.id}`" class="hover:underline">{{ penName.name }}</a>
        <span class="text-xs text-muted-foreground">{{ t('author.index.bookCount', { count: penName.bookCount }) }}</span>
        <button
          v-if="canEdit"
          type="button"
          class="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          :disabled="busy"
          :aria-label="t('author.detail.aliases.removePenName', { name: penName.name })"
          :title="t('author.detail.aliases.removePenName', { name: penName.name })"
          @click="handleUnlinkPenName(penName.id)"
        >
          <X :size="12" />
        </button>
      </span>
    </div>

    <div v-if="names.spellings.length > 0" class="mt-2 flex flex-wrap items-center gap-2" data-testid="author-spellings">
      <span class="text-[11px] text-muted-foreground">{{ t('author.detail.aliases.spellingsLabel') }}</span>
      <span
        v-for="alias in names.spellings"
        :key="alias.id"
        class="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background/60 pl-3 text-sm"
        :class="canEdit ? 'pr-1' : 'pr-3'"
      >
        {{ alias.name }}
        <button
          v-if="canEdit"
          type="button"
          class="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          :disabled="busy"
          :aria-label="t('author.detail.aliases.remove', { name: alias.name })"
          :title="t('author.detail.aliases.remove', { name: alias.name })"
          @click="handleRemoveSpelling(alias.id)"
        >
          <X :size="12" />
        </button>
      </span>
    </div>

    <form v-if="adding && canEdit" class="mt-3 flex flex-col gap-2" @submit.prevent="submitName">
      <div class="flex flex-wrap items-center gap-2">
        <InputWithSuggestions
          v-model="draft"
          :search-fn="searchSuggestions"
          :placeholder="t('author.detail.aliases.placeholder')"
          :disabled="busy"
          :maxlength="500"
          class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
        />
        <select
          :value="kind"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          :aria-label="t('author.detail.aliases.kindLabel')"
          :disabled="busy"
          data-testid="author-name-kind"
          @change="handleKindChange"
        >
          <option v-for="option in AUTHOR_NAME_KINDS" :key="option" :value="option">{{ t(`author.detail.aliases.kinds.${option}.label`) }}</option>
        </select>
        <button
          type="submit"
          :disabled="busy || !draft?.trim()"
          class="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {{ t('author.detail.aliases.save') }}
        </button>
      </div>
      <p class="text-[11px] text-muted-foreground">{{ kindHint }}</p>
    </form>
  </section>
</template>
