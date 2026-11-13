<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellPlus, BellRing, Loader2 } from '@lucide/vue'
import type { ReleaseFollowKind } from '@bookorbit/types'

import { useReleaseFollow } from '../composables/useReleaseFollow'

const props = defineProps<{
  kind: ReleaseFollowKind
  name: string
  authorId?: number
  seriesId?: number
}>()

const { t } = useI18n()
const { allowed, following, loading, busy, toggle } = useReleaseFollow(
  props.kind,
  () => props.name,
  () => ({ authorId: props.authorId, seriesId: props.seriesId }),
)

const label = computed(() => (following.value ? t('newReleases.follow.following') : t('newReleases.follow.follow')))
const hint = computed(() => t(following.value ? 'newReleases.follow.unfollowHint' : `newReleases.follow.${props.kind}Hint`, { name: props.name }))

function handleClick() {
  void toggle()
}
</script>

<template>
  <button
    v-if="allowed"
    type="button"
    class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
    :class="
      following ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15' : 'border-input bg-background text-foreground hover:bg-muted'
    "
    :aria-pressed="following"
    :title="hint"
    :disabled="loading || busy"
    data-testid="follow-releases"
    @click="handleClick"
  >
    <Loader2 v-if="busy" :size="14" class="animate-spin" aria-hidden="true" />
    <BellRing v-else-if="following" :size="14" aria-hidden="true" />
    <BellPlus v-else :size="14" aria-hidden="true" />
    {{ label }}
  </button>
</template>
