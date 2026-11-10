<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ListChecks } from '@lucide/vue'
import ChipInput from '@/components/ui/ChipInput.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useGenrePolicy } from '@/features/book/composables/useGenrePolicy'
import { useGenreSearch } from '@/features/book/composables/useTagSearch'

const { t } = useI18n()
const { policy, loaded, load, save } = useGenrePolicy()
const { search: searchExistingGenres } = useGenreSearch()
const saving = ref(false)

onMounted(load)

async function persist(payload: Parameters<typeof save>[0]) {
  saving.value = true
  try {
    if (await save(payload)) toast.success(t('settings.metadata.allowedGenres.saved'))
    else toast.error(t('settings.metadata.allowedGenres.saveFailed'))
  } finally {
    saving.value = false
  }
}

function handleEnabledChange(enabled: boolean) {
  void persist({ enabled })
}

function handleGenresChange(genres: string[]) {
  void persist({ genres })
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card overflow-hidden shadow-xs">
    <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex items-center justify-between gap-4 bg-muted/30">
      <div class="flex items-start gap-3">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ListChecks :size="16" />
        </div>
        <div>
          <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.allowedGenres.heading') }}</span>
          <p class="settings-hint">{{ t('settings.metadata.allowedGenres.hint') }}</p>
        </div>
      </div>
      <ToggleSwitch
        :model-value="policy.enabled"
        :disabled="!loaded || saving"
        :aria-label="t('settings.metadata.allowedGenres.toggle')"
        @update:model-value="handleEnabledChange"
      />
    </div>

    <div class="p-4 md:p-5 space-y-2">
      <label for="allowed-genres-input" class="text-xs font-medium text-muted-foreground">{{ t('settings.metadata.allowedGenres.listLabel') }}</label>
      <ChipInput
        input-id="allowed-genres-input"
        :model-value="policy.genres"
        :search-fn="searchExistingGenres"
        :disabled="!loaded || saving"
        :placeholder="t('settings.metadata.allowedGenres.placeholder')"
        @update:model-value="handleGenresChange"
      />
      <p v-if="policy.enabled && policy.genres.length === 0" role="status" class="text-xs text-warning">
        {{ t('settings.metadata.allowedGenres.emptyWhileOn') }}
      </p>
      <p class="settings-hint">{{ t('settings.metadata.allowedGenres.behaviour') }}</p>
    </div>
  </div>
</template>
