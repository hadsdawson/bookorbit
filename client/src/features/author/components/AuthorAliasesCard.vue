<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Tags, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { AuthorAlias } from '@bookorbit/types'

import { addAuthorAlias, fetchAuthorAliases, removeAuthorAlias } from '../api/author'

const props = defineProps<{ authorId: number; canEdit: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const aliases = ref<AuthorAlias[]>([])
const adding = ref(false)
const draft = ref('')
const busy = ref(false)
const visible = computed(() => aliases.value.length > 0 || props.canEdit)

async function load() {
  const id = props.authorId
  try {
    const result = await fetchAuthorAliases(id)
    if (id === props.authorId) aliases.value = result
  } catch {
    if (id === props.authorId) aliases.value = []
  }
}

function toggleAdding() {
  adding.value = !adding.value
  if (!adding.value) draft.value = ''
}

async function submitAlias() {
  const name = draft.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const result = await addAuthorAlias(props.authorId, name)
    aliases.value = result.aliases
    draft.value = ''
    adding.value = false
    if (result.mergedAuthorCount > 0) {
      toast.success(t('author.detail.aliases.addedAndCombined', { books: result.affectedBookCount }))
      emit('changed')
    } else {
      toast.success(t('author.detail.aliases.added'))
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.aliases.addFailed'))
  } finally {
    busy.value = false
  }
}

async function handleRemove(aliasId: number) {
  if (busy.value) return
  busy.value = true
  try {
    aliases.value = await removeAuthorAlias(props.authorId, aliasId)
    toast.success(t('author.detail.aliases.removed'))
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
    void load()
  },
)
onMounted(load)
defineExpose({ load })
</script>

<template>
  <section v-if="visible" class="mt-4 rounded-lg border border-border/70 bg-card/60 p-3" :aria-label="t('author.detail.aliases.heading')">
    <div class="flex flex-wrap items-center gap-2">
      <Tags :size="14" class="text-muted-foreground" aria-hidden="true" />
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{{ t('author.detail.aliases.heading') }}</h2>
      <span v-if="aliases.length === 0" class="text-xs text-muted-foreground">{{ t('author.detail.aliases.none') }}</span>
      <span
        v-for="alias in aliases"
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
          @click="handleRemove(alias.id)"
        >
          <X :size="12" />
        </button>
      </span>
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
    <p class="mt-1.5 text-[11px] text-muted-foreground">{{ t('author.detail.aliases.hint') }}</p>

    <form v-if="adding && canEdit" class="mt-2 flex flex-wrap items-center gap-2" @submit.prevent="submitAlias">
      <input
        v-model="draft"
        class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
        :placeholder="t('author.detail.aliases.placeholder')"
        :aria-label="t('author.detail.aliases.placeholder')"
        :disabled="busy"
      />
      <button
        type="submit"
        :disabled="busy || !draft.trim()"
        class="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {{ t('author.detail.aliases.save') }}
      </button>
    </form>
  </section>
</template>
