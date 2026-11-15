<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { UserRound } from '@lucide/vue'
import type { AuthorNameLink } from '@bookorbit/types'

/** Fork: asks which person to open when a pen name is shared by more than one author. */
defineProps<{ open: boolean; penName: string; people: AuthorNameLink[] }>()
const emit = defineEmits<{ choose: [authorId: number]; cancel: [] }>()

const { t } = useI18n()

function handleCancel() {
  emit('cancel')
}

function handleChoose(authorId: number) {
  emit('choose', authorId)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[70] flex items-center justify-center" data-testid="pen-name-chooser">
      <div class="absolute inset-0 bg-scrim" @click="handleCancel" />
      <div
        class="relative z-10 mx-4 w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        :aria-label="t('author.detail.penNameChooser.title', { name: penName })"
      >
        <h2 class="text-base font-semibold text-foreground">{{ t('author.detail.penNameChooser.title', { name: penName }) }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('author.detail.penNameChooser.description', { name: penName }) }}</p>
        <ul class="mt-4 flex flex-col gap-2">
          <li v-for="person in people" :key="person.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
              @click="handleChoose(person.id)"
            >
              <UserRound :size="16" class="text-muted-foreground" />
              <span class="flex-1 truncate font-medium">{{ person.name }}</span>
            </button>
          </li>
        </ul>
        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="h-9 rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="handleCancel"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
