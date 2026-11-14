<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { BookOpen, CalendarClock, Headphones } from '@lucide/vue'
import type { UpcomingReleaseWidgetItem } from '@bookorbit/types'

import { hideOnError } from '@/features/book/lib/metadata-fetch'
import { useUpcomingReleasesWidget } from '../../composables/useUpcomingReleasesWidget'

const { data, loading, error } = useUpcomingReleasesWidget()
const { t, locale } = useI18n()
const router = useRouter()

function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const dayLabel = computed(() => {
  const date = data.value?.date
  if (!date) return ''
  if (date === localToday()) return t('dashboard.widgets.upcomingReleases.today')
  return new Date(`${date}T00:00:00`).toLocaleDateString(locale.value, { weekday: 'short', month: 'short', day: 'numeric' })
})

const moreCount = computed(() => (data.value ? Math.max(0, data.value.total - data.value.items.length) : 0))

function authorLine(item: UpcomingReleaseWidgetItem): string {
  const series = item.seriesName ? (item.seriesIndex === null ? item.seriesName : `${item.seriesName} #${item.seriesIndex}`) : null
  return [item.authors.join(', '), series].filter(Boolean).join(' · ')
}

function openNewReleases() {
  void router.push({ name: 'new-releases' })
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-2 flex items-center gap-2 self-start pr-6">
      <CalendarClock :size="16" class="shrink-0 text-primary" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.upcomingReleases.title') }}</span>
      <span v-if="dayLabel" class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary" data-testid="upcoming-day">{{
        dayLabel
      }}</span>
    </div>

    <div v-if="loading && !data" class="flex flex-1 flex-col gap-2">
      <div v-for="row in 3" :key="row" class="h-10 animate-pulse rounded-md bg-muted" />
    </div>

    <div v-else-if="error && !data" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <div
      v-else-if="!data"
      class="flex flex-1 items-center justify-center px-2 text-center text-xs text-muted-foreground"
      data-testid="upcoming-no-access"
    >
      {{ t('dashboard.widgets.upcomingReleases.noAccess') }}
    </div>

    <div v-else-if="data.items.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="upcoming-empty">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <CalendarClock :size="16" class="text-muted-foreground" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.upcomingReleases.empty') }}</p>
    </div>

    <template v-else>
      <ul class="-mx-1 flex-1 space-y-1 overflow-y-auto px-1 [scrollbar-width:thin]" data-testid="upcoming-list">
        <li v-for="item in data.items" :key="item.id">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md p-1 text-left transition-colors hover:bg-muted/60"
            @click="openNewReleases"
          >
            <span class="relative h-10 w-7 shrink-0 overflow-hidden rounded-xs bg-muted">
              <img v-if="item.coverUrl" :src="item.coverUrl" alt="" class="h-full w-full object-cover" loading="lazy" @error="hideOnError" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-semibold leading-tight text-foreground">{{ item.title }}</span>
              <span class="block truncate text-[11px] text-muted-foreground">{{ authorLine(item) }}</span>
            </span>
            <span class="flex shrink-0 items-center gap-1 text-muted-foreground">
              <BookOpen v-if="item.formats.includes('ebook')" :size="12" :aria-label="t('dashboard.widgets.upcomingReleases.ebook')" />
              <Headphones v-if="item.formats.includes('audiobook')" :size="12" :aria-label="t('dashboard.widgets.upcomingReleases.audiobook')" />
              <span v-if="item.state === 'requested'" class="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">{{
                t('dashboard.widgets.upcomingReleases.requested')
              }}</span>
            </span>
          </button>
        </li>
      </ul>
      <button
        type="button"
        class="mt-1.5 w-full rounded-lg bg-primary/10 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/20"
        data-testid="upcoming-open"
        @click="openNewReleases"
      >
        {{ moreCount > 0 ? t('dashboard.widgets.upcomingReleases.more', { count: moreCount }) : t('dashboard.widgets.upcomingReleases.open') }}
      </button>
    </template>
  </div>
</template>
