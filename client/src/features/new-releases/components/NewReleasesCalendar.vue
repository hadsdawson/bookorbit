<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, ChevronLeft, ChevronRight, Headphones } from '@lucide/vue'
import type { NewReleaseItem } from '@bookorbit/types'

import { formatDate } from '@/i18n/formatters'
import { calendarEntries, monthGrid, toDayKey, type CalendarEntry } from '../composables/useReleaseCalendar'

const props = defineProps<{ items: NewReleaseItem[] }>()

const { t, locale } = useI18n()
const today = new Date()
const month = ref(new Date(today.getFullYear(), today.getMonth(), 1))
const selectedKey = ref<string | null>(toDayKey(today))

const entriesByDay = computed(() => calendarEntries(props.items))
const weeks = computed(() => monthGrid(month.value, firstDayOfWeek(locale.value)))
const todayKey = toDayKey(today)

const weekdayLabels = computed(() => weeks.value[0]!.map((day) => formatDate(day, { weekday: 'short' })))
const monthLabel = computed(() => formatDate(month.value, { month: 'long', year: 'numeric' }))
const selectedEntries = computed<CalendarEntry[]>(() => (selectedKey.value ? (entriesByDay.value.get(selectedKey.value) ?? []) : []))
const selectedLabel = computed(() => {
  if (!selectedKey.value) return ''
  const [year, monthIndex, day] = selectedKey.value.split('-').map(Number)
  return formatDate(new Date(year!, monthIndex! - 1, day!), { dateStyle: 'full' })
})

/** The locale's first day of the week where the browser knows it; Sunday otherwise. */
function firstDayOfWeek(tag: string): number {
  try {
    const info = new Intl.Locale(tag) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } }
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 7
    return firstDay % 7
  } catch {
    return 0
  }
}

function entriesOn(day: Date): CalendarEntry[] {
  return entriesByDay.value.get(toDayKey(day)) ?? []
}

function inMonth(day: Date): boolean {
  return day.getMonth() === month.value.getMonth()
}

function dayLabel(day: Date): string {
  const count = entriesOn(day).length
  const date = formatDate(day, { dateStyle: 'long' })
  return count > 0 ? t('newReleases.calendar.dayWithBooks', { date, count }) : date
}

function previousMonth() {
  month.value = new Date(month.value.getFullYear(), month.value.getMonth() - 1, 1)
}

function nextMonth() {
  month.value = new Date(month.value.getFullYear(), month.value.getMonth() + 1, 1)
}

function goToToday() {
  month.value = new Date(today.getFullYear(), today.getMonth(), 1)
  selectedKey.value = todayKey
}

function selectDay(day: Date) {
  selectedKey.value = toDayKey(day)
}
</script>

<template>
  <div class="space-y-3" data-testid="new-releases-calendar">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-foreground" aria-live="polite">{{ monthLabel }}</h2>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          @click="goToToday"
        >
          {{ t('newReleases.calendar.today') }}
        </button>
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-md border border-input bg-background hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t('newReleases.calendar.previous')"
          data-testid="calendar-previous"
          @click="previousMonth"
        >
          <ChevronLeft :size="15" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-md border border-input bg-background hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t('newReleases.calendar.next')"
          data-testid="calendar-next"
          @click="nextMonth"
        >
          <ChevronRight :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="overflow-hidden rounded-lg border border-border/70 bg-card">
      <div class="grid grid-cols-7 border-b border-border/70 bg-muted/40">
        <span
          v-for="label in weekdayLabels"
          :key="label"
          class="px-1 py-1.5 text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ label }}
        </span>
      </div>
      <div v-for="(week, weekIndex) in weeks" :key="weekIndex" class="grid grid-cols-7 border-b border-border/50 last:border-b-0">
        <button
          v-for="day in week"
          :key="toDayKey(day)"
          type="button"
          class="flex min-h-14 min-w-0 flex-col items-stretch gap-1 border-e border-border/50 p-1 text-start transition-colors last:border-e-0 hover:bg-muted/50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-24"
          :class="[!inMonth(day) && 'bg-muted/20 text-muted-foreground', selectedKey === toDayKey(day) && 'bg-primary/8']"
          :aria-label="dayLabel(day)"
          :aria-pressed="selectedKey === toDayKey(day)"
          :data-day="toDayKey(day)"
          @click="selectDay(day)"
        >
          <span
            class="inline-flex size-6 items-center justify-center self-start rounded-full text-xs tabular-nums"
            :class="toDayKey(day) === todayKey ? 'bg-primary font-semibold text-primary-foreground' : 'text-foreground'"
          >
            {{ day.getDate() }}
          </span>
          <!-- Titles on wider screens; a count on phones, where a seventh of the width holds no title. -->
          <span v-if="entriesOn(day).length > 0" class="md:hidden">
            <span
              class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            >
              {{ entriesOn(day).length }}
            </span>
          </span>
          <span
            v-for="entry in entriesOn(day).slice(0, 2)"
            :key="entry.key"
            class="hidden min-w-0 items-center gap-1 rounded-sm bg-primary/10 px-1 py-0.5 text-[11px] text-foreground md:flex"
          >
            <Headphones v-if="entry.formats.length === 1 && entry.formats[0] === 'audiobook'" :size="10" class="shrink-0" aria-hidden="true" />
            <BookOpen v-else :size="10" class="shrink-0" aria-hidden="true" />
            <span class="truncate">{{ entry.item.title }}</span>
          </span>
          <span v-if="entriesOn(day).length > 2" class="hidden text-[11px] text-muted-foreground md:block">
            {{ t('newReleases.calendar.more', { count: entriesOn(day).length - 2 }) }}
          </span>
        </button>
      </div>
    </div>

    <section v-if="selectedKey" class="space-y-2" aria-live="polite" data-testid="calendar-selected-day">
      <h3 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{{ selectedLabel }}</h3>
      <p v-if="selectedEntries.length === 0" class="text-sm text-muted-foreground">{{ t('newReleases.calendar.nothingThatDay') }}</p>
      <ul v-else class="divide-y divide-border/60 rounded-lg border border-border/70 bg-card">
        <li v-for="entry in selectedEntries" :key="entry.key" class="flex items-center gap-3 px-3 py-2">
          <span class="flex shrink-0 gap-1 text-muted-foreground" aria-hidden="true">
            <BookOpen v-if="entry.formats.includes('ebook')" :size="14" />
            <Headphones v-if="entry.formats.includes('audiobook')" :size="14" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground">{{ entry.item.title }}</p>
            <p class="truncate text-xs text-muted-foreground">
              {{ entry.item.authors.join(', ') }}
              <template v-if="entry.item.seriesName"> · {{ entry.item.seriesName }}</template>
            </p>
          </div>
          <span class="shrink-0 text-xs text-muted-foreground">{{ t(`newReleases.calendar.formats.${entry.formats.join('-')}`) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
