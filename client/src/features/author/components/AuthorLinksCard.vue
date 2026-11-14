<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Link2, Plus, X } from '@lucide/vue'
import { toast } from 'vue-sonner'

import { useAuthorLinks } from '../composables/useAuthorLinks'

const props = defineProps<{ authorId: number; canEdit: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { links, query, candidates, searching, busy, load, link, unlink } = useAuthorLinks(toRef(props, 'authorId'))
const adding = ref(false)
const visible = computed(() => links.value.length > 0 || props.canEdit)

function toggleAdding() {
  adding.value = !adding.value
  if (!adding.value) query.value = ''
}

async function handleLink(otherId: number) {
  try {
    await link(otherId)
    adding.value = false
    toast.success(t('author.detail.links.linked'))
    emit('changed')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.links.linkFailed'))
  }
}

async function handleUnlink(otherId: number) {
  try {
    await unlink(otherId)
    toast.success(t('author.detail.links.unlinked'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.links.unlinkFailed'))
  }
}

onMounted(load)
</script>

<template>
  <section v-if="visible" class="mt-4 rounded-lg border border-border/70 bg-card/60 p-3" :aria-label="t('author.detail.links.heading')">
    <div class="flex flex-wrap items-center gap-2">
      <Link2 :size="14" class="text-muted-foreground" aria-hidden="true" />
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{{ t('author.detail.links.heading') }}</h2>
      <span v-if="links.length === 0" class="text-xs text-muted-foreground">{{ t('author.detail.links.none') }}</span>
      <span
        v-for="linked in links"
        :key="linked.id"
        class="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background/60 pl-3 text-sm"
        :class="canEdit ? 'pr-1' : 'pr-3'"
      >
        <RouterLink :to="{ name: 'author-detail', params: { id: linked.id } }" class="hover:underline">{{ linked.name }}</RouterLink>
        <button
          v-if="canEdit"
          type="button"
          class="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          :disabled="busy"
          :aria-label="t('author.detail.links.unlink', { name: linked.name })"
          :title="t('author.detail.links.unlink', { name: linked.name })"
          @click="handleUnlink(linked.id)"
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
        {{ t('author.detail.links.add') }}
      </button>
    </div>
    <p class="mt-1.5 text-[11px] text-muted-foreground">{{ t('author.detail.links.hint') }}</p>

    <div v-if="adding && canEdit" class="mt-2 space-y-1.5">
      <input
        v-model="query"
        class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
        :placeholder="t('author.detail.links.searchPlaceholder')"
        :aria-label="t('author.detail.links.searchPlaceholder')"
      />
      <p v-if="searching" class="text-xs text-muted-foreground">{{ t('author.detail.links.searching') }}</p>
      <ul v-else-if="candidates.length > 0" class="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border/70 bg-background/50 p-1">
        <li v-for="candidate in candidates" :key="candidate.id">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
            :disabled="busy"
            @click="handleLink(candidate.id)"
          >
            <span class="min-w-0 flex-1 truncate">{{ candidate.name }}</span>
            <span class="text-xs text-muted-foreground">{{ t('author.detail.merge.bookCount', { count: candidate.bookCount }) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="query.trim()" class="text-xs text-muted-foreground">{{ t('author.detail.links.noMatches') }}</p>
    </div>
  </section>
</template>
