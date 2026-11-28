<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { BellRing, BookOpen, CalendarClock, CalendarDays, Eye, EyeOff, Headphones, List, Loader2, Search, UserRound, Library, X } from '@lucide/vue'
import {
  NEW_RELEASE_RETENTION_DAYS,
  type NewReleaseDelivery,
  type NewReleaseItem,
  type NewReleaseMatchedFollow,
  type NewReleaseRequestFormat,
  type NewReleaseRetentionDays,
  type ReleaseFollow,
  type ReleaseFollowKind,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { formatDate, formatNumber, formatRelativeFromNow } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import NewReleasesCalendar from '../components/NewReleasesCalendar.vue'
import RequestReleaseButton from '../components/RequestReleaseButton.vue'
import ReleaseProviderBadges from '../components/ReleaseProviderBadges.vue'
import {
  isReleased,
  parseReleaseDate,
  readReleaseView,
  saveReleaseView,
  useNewReleases,
  useReleaseFollowList,
  type ReleaseView,
} from '../composables/useNewReleases'

const { t } = useI18n()
const {
  overview,
  loading,
  failed,
  showHidden,
  groups,
  followTotal,
  anySource,
  load,
  hide,
  unhide,
  followAll,
  saveSettings,
  request,
  unfollow,
  refollow,
} = useNewReleases()
const follows = useReleaseFollowList()

type Tab = 'upcoming' | 'following'
const tab = ref<Tab>('upcoming')
const view = ref<ReleaseView>(readReleaseView())
const savingRetention = ref(false)
const unfollowing = ref<number | null>(null)
const savingDelivery = ref(false)
const requesting = ref<number | null>(null)

const deliveryValue = computed(() => overview.value?.user.delivery ?? 'default')
const serverDeliveryLabel = computed(() => (overview.value ? t(`newReleases.delivery.${overview.value.server.defaultDelivery}`) : ''))
const followingAll = ref<ReleaseFollowKind | null>(null)
const brokenCovers = ref(new Set<number>())

const lastCheckedLabel = computed(() => {
  const value = overview.value?.lastCheckedAt
  return value ? t('newReleases.lastChecked', { when: formatRelativeFromNow(new Date(value)) }) : null
})

const followSummary = computed(() =>
  t('newReleases.followSummary', {
    authors: formatNumber(overview.value?.followCounts.author ?? 0),
    series: formatNumber(overview.value?.followCounts.series ?? 0),
  }),
)

function monthLabel(date: Date): string {
  return formatDate(date, { month: 'long', year: 'numeric' })
}

function dayLabel(value: string): string {
  return formatDate(parseReleaseDate(value), { dateStyle: 'medium' })
}

function seriesLine(item: NewReleaseItem): string | null {
  if (!item.seriesName) return null
  return item.seriesIndex !== null ? t('newReleases.item.seriesNumber', { series: item.seriesName, number: item.seriesIndex }) : item.seriesName
}

// Fork: show hidden books too, and reload when that changes.
function handleShowHiddenChange(event: Event) {
  showHidden.value = (event.target as HTMLInputElement).checked
  void load()
}

function handleUnhideClick(item: NewReleaseItem) {
  void handleUnhide(item)
}

function becauseLine(item: NewReleaseItem): string {
  return t('newReleases.item.because', { names: item.matchedFollows.map((follow) => follow.name).join(', ') })
}

function showsCover(item: NewReleaseItem): boolean {
  return !!item.coverUrl && !brokenCovers.value.has(item.id)
}

function handleCoverError(event: Event) {
  const id = Number((event.currentTarget as HTMLElement | null)?.dataset.releaseId)
  if (Number.isFinite(id)) brokenCovers.value = new Set([...brokenCovers.value, id])
}

function selectList() {
  view.value = 'list'
  saveReleaseView('list')
}

function selectCalendar() {
  view.value = 'calendar'
  saveReleaseView('calendar')
}

async function handleRetentionChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value) as NewReleaseRetentionDays
  savingRetention.value = true
  try {
    await saveSettings({ retentionDays: value })
    toast.success(t('newReleases.retention.saved', { days: value }))
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.saveSettings'))
  } finally {
    savingRetention.value = false
  }
}

async function handleDeliveryChange(event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  const delivery = raw === 'default' ? null : (raw as NewReleaseDelivery)
  savingDelivery.value = true
  try {
    await saveSettings({ delivery })
    toast.success(t('newReleases.delivery.saved'))
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.saveSettings'))
  } finally {
    savingDelivery.value = false
  }
}

async function handleRequest(item: NewReleaseItem, formats: NewReleaseRequestFormat[]) {
  if (requesting.value !== null) return
  requesting.value = item.id
  try {
    const requested = await request(item, formats)
    toast.success(t('newReleases.request.done', { title: item.title, count: requested.length }))
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.request'))
  } finally {
    requesting.value = null
  }
}

function selectUpcoming() {
  tab.value = 'upcoming'
}

function selectFollowing() {
  tab.value = 'following'
}

async function handleHide(item: NewReleaseItem) {
  try {
    await hide(item)
    toast.success(t('newReleases.item.hidden', { title: item.title }), {
      action: { label: t('newReleases.item.undo'), onClick: () => void handleUnhide(item) },
    })
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.hide'))
  }
}

/** Fork. The ids a follow was made with, so Undo follows the same author or series again. */
function followIdsFor(item: NewReleaseItem, follow: NewReleaseMatchedFollow): { authorId?: number; seriesId?: number } {
  if (follow.kind === 'series') return item.seriesId ? { seriesId: item.seriesId } : {}
  const authorId = item.authorLinks.find((link) => link.name.toLowerCase() === follow.name.toLowerCase())?.authorId
  return authorId ? { authorId } : {}
}

function unfollowLabel(follow: NewReleaseMatchedFollow): string {
  return follow.kind === 'author' ? t('newReleases.item.unfollowAuthor') : t('newReleases.item.unfollowSeries')
}

function unfollowAria(follow: NewReleaseMatchedFollow): string {
  return follow.kind === 'author'
    ? t('newReleases.item.unfollowAuthorNamed', { name: follow.name })
    : t('newReleases.item.unfollowSeriesNamed', { name: follow.name })
}

async function handleUnfollowFromRelease(item: NewReleaseItem, follow: NewReleaseMatchedFollow) {
  if (unfollowing.value !== null) return
  unfollowing.value = follow.id
  const ids = followIdsFor(item, follow)
  try {
    await unfollow(follow)
    toast.success(t('newReleases.follow.unfollowed', { name: follow.name }), {
      action: { label: t('newReleases.item.undo'), onClick: () => void handleRefollow(follow, ids) },
    })
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.unfollow'))
  } finally {
    unfollowing.value = null
  }
}

async function handleRefollow(follow: NewReleaseMatchedFollow, ids: { authorId?: number; seriesId?: number }) {
  try {
    await refollow(follow, ids)
    toast.success(t('newReleases.follow.followed', { name: follow.name }))
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.follow'))
  }
}

async function handleUnhide(item: NewReleaseItem) {
  try {
    await unhide(item)
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.hide'))
  }
}

async function runFollowAll(kind: ReleaseFollowKind) {
  if (followingAll.value) return
  followingAll.value = kind
  try {
    const result = await followAll(kind)
    toast.success(t(`newReleases.followAll.${kind}Done`, { count: result.added }))
    if (tab.value === 'following') await follows.load()
    // Fork: names unfollowed on purpose are not followed again without asking.
    if (result.skipped > 0) refollowAsk.value = { kind, count: result.skipped, names: result.skippedNames }
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.followAll'))
  } finally {
    followingAll.value = null
  }
}

const refollowAsk = ref<{ kind: ReleaseFollowKind; count: number; names: string[] } | null>(null)
const refollowing = ref(false)

const refollowDescription = computed(() => {
  const ask = refollowAsk.value
  if (!ask) return ''
  const more = ask.count - ask.names.length
  const names = more > 0 ? t('newReleases.followAll.refollow.namesMore', { names: ask.names.join(', '), count: more }) : ask.names.join(', ')
  return t(`newReleases.followAll.refollow.${ask.kind}Description`, { count: ask.count, names })
})

async function handleRefollowConfirm() {
  const ask = refollowAsk.value
  if (!ask || refollowing.value) return
  refollowing.value = true
  try {
    await followAll(ask.kind, true)
    toast.success(t('newReleases.followAll.refollow.done', { count: ask.count }))
    if (tab.value === 'following') await follows.load()
    refollowAsk.value = null
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.followAll'))
  } finally {
    refollowing.value = false
  }
}

function handleRefollowCancel() {
  refollowAsk.value = null
}

function handleFollowAllAuthors() {
  void runFollowAll('author')
}

function handleFollowAllSeries() {
  void runFollowAll('series')
}

function handleKindChange(event: Event) {
  follows.kind.value = (event.target as HTMLSelectElement).value as ReleaseFollowKind | 'all'
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function handleSearchInput(event: Event) {
  follows.search.value = (event.target as HTMLInputElement).value
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void follows.load(), 250)
}

function handleLoadMore() {
  void follows.load(true)
}

async function handleUnfollow(follow: ReleaseFollow) {
  try {
    await follows.remove(follow)
    toast.success(t('newReleases.follow.unfollowed', { name: follow.name }))
    void load()
  } catch (error) {
    toast.error(errorMessage(error, 'newReleases.errors.unfollow'))
  }
}

watch(tab, (value) => {
  if (value === 'following') void follows.load()
})
watch(
  () => follows.kind.value,
  () => void follows.load(),
)

onMounted(load)
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto max-w-4xl space-y-4 pb-8">
      <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div class="space-y-1">
          <h1 class="text-base font-semibold text-foreground">{{ t('newReleases.title') }}</h1>
          <p class="text-sm text-muted-foreground">{{ t('newReleases.description') }}</p>
        </div>
        <div class="flex items-center gap-1 self-start rounded-lg border border-border bg-muted/50 p-1" role="tablist">
          <button
            type="button"
            role="tab"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :class="tab === 'upcoming' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            :aria-selected="tab === 'upcoming'"
            @click="selectUpcoming"
          >
            {{ t('newReleases.tabs.upcoming') }}
          </button>
          <button
            type="button"
            role="tab"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :class="tab === 'following' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            :aria-selected="tab === 'following'"
            data-testid="new-releases-following-tab"
            @click="selectFollowing"
          >
            {{ t('newReleases.tabs.following') }}
          </button>
        </div>
      </header>

      <p v-if="loading && !overview" class="text-sm text-muted-foreground" role="status">{{ t('common.loading') }}</p>
      <p v-else-if="failed && !overview" class="text-sm text-destructive" role="alert">{{ t('newReleases.errors.load') }}</p>

      <template v-else-if="overview">
        <section
          v-if="!anySource"
          class="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
          data-testid="new-releases-no-sources"
        >
          {{ t('newReleases.noSources') }}
        </section>

        <section class="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0 space-y-1">
            <p class="text-sm font-medium text-foreground">{{ followSummary }}</p>
            <p v-if="overview.pendingChecks > 0" class="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <Loader2 :size="12" class="animate-spin" aria-hidden="true" />
              {{ t('newReleases.pending', { count: overview.pendingChecks }) }}
            </p>
            <p v-else-if="lastCheckedLabel" class="text-xs text-muted-foreground">{{ lastCheckedLabel }}</p>
            <label class="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
              {{ t('newReleases.retention.label') }}
              <select
                class="select-field h-8 w-28"
                :value="overview.user.retentionDays"
                :disabled="savingRetention"
                data-testid="new-releases-retention"
                @change="handleRetentionChange"
              >
                <option v-for="days in NEW_RELEASE_RETENTION_DAYS" :key="days" :value="days">{{ t('newReleases.retention.days', { days }) }}</option>
              </select>
            </label>
            <label class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {{ t('newReleases.delivery.label') }}
              <select
                class="select-field h-8 w-56"
                :value="deliveryValue"
                :disabled="savingDelivery"
                data-testid="new-releases-delivery"
                @change="handleDeliveryChange"
              >
                <option value="default">{{ t('newReleases.delivery.default', { choice: serverDeliveryLabel }) }}</option>
                <option value="suggest">{{ t('newReleases.delivery.suggest') }}</option>
                <option value="request">{{ t('newReleases.delivery.request') }}</option>
              </select>
            </label>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" :disabled="followingAll !== null" data-testid="follow-all-authors" @click="handleFollowAllAuthors">
              <Loader2 v-if="followingAll === 'author'" class="animate-spin" aria-hidden="true" />
              <UserRound v-else aria-hidden="true" />
              {{ t('newReleases.followAll.author') }}
            </Button>
            <Button variant="outline" size="sm" :disabled="followingAll !== null" data-testid="follow-all-series" @click="handleFollowAllSeries">
              <Loader2 v-if="followingAll === 'series'" class="animate-spin" aria-hidden="true" />
              <Library v-else aria-hidden="true" />
              {{ t('newReleases.followAll.series') }}
            </Button>
          </div>
        </section>

        <template v-if="tab === 'upcoming'">
          <div class="flex flex-wrap items-center justify-end gap-3">
            <label class="inline-flex items-center gap-2 text-sm text-muted-foreground" data-testid="new-releases-show-hidden">
              <input type="checkbox" class="size-4 accent-primary" :checked="showHidden" @change="handleShowHiddenChange" />
              {{ t('newReleases.showHidden') }}
            </label>
            <div class="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :class="view === 'list' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
                :aria-pressed="view === 'list'"
                @click="selectList"
              >
                <List :size="13" aria-hidden="true" />
                {{ t('newReleases.view.list') }}
              </button>
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :class="view === 'calendar' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
                :aria-pressed="view === 'calendar'"
                data-testid="new-releases-calendar-view"
                @click="selectCalendar"
              >
                <CalendarDays :size="13" aria-hidden="true" />
                {{ t('newReleases.view.calendar') }}
              </button>
            </div>
          </div>

          <NewReleasesCalendar v-if="view === 'calendar'" :items="overview.items" />

          <template v-else>
            <div v-if="groups.length === 0" class="rounded-lg border border-dashed border-border p-8 text-center" data-testid="new-releases-empty">
              <CalendarClock :size="28" class="mx-auto text-muted-foreground" aria-hidden="true" />
              <p class="mt-2 text-sm font-medium text-foreground">
                {{ followTotal === 0 ? t('newReleases.empty.noFollowsTitle') : t('newReleases.empty.nothingTitle') }}
              </p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ followTotal === 0 ? t('newReleases.empty.noFollowsHint') : t('newReleases.empty.nothingHint') }}
              </p>
            </div>

            <section v-for="group in groups" :key="group.key" class="space-y-2" data-testid="new-releases-month">
              <h2 class="py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {{ monthLabel(group.date) }}
              </h2>
              <ul class="divide-y divide-border/60 rounded-lg border border-border/70 bg-card">
                <li v-for="item in group.items" :key="item.id" class="flex gap-3 p-3" data-testid="new-release-item">
                  <img
                    v-if="showsCover(item)"
                    :src="item.coverUrl ?? undefined"
                    :data-release-id="item.id"
                    alt=""
                    loading="lazy"
                    class="h-[72px] w-12 shrink-0 rounded-xs border border-border bg-muted object-cover"
                    @error="handleCoverError"
                  />
                  <div
                    v-else
                    class="flex h-[72px] w-12 shrink-0 items-center justify-center rounded-xs border border-border bg-muted"
                    aria-hidden="true"
                  >
                    <BookOpen :size="16" class="text-muted-foreground" />
                  </div>

                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <p class="min-w-0 truncate text-sm font-semibold text-foreground">{{ item.title }}</p>
                      <span
                        v-if="item.state === 'requested'"
                        class="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 text-xs font-medium text-info"
                      >
                        <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
                        {{ t('newReleases.item.requested') }}
                      </span>
                      <span
                        v-if="item.state === 'dismissed'"
                        class="inline-flex h-5 shrink-0 items-center rounded-full border border-dashed border-border px-2 text-xs font-medium text-muted-foreground"
                      >
                        {{ t('newReleases.item.hiddenBadge') }}
                      </span>
                      <span
                        v-if="isReleased(item.releaseDate)"
                        class="inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-muted px-2 text-xs font-medium text-muted-foreground"
                      >
                        {{ t('newReleases.item.released') }}
                      </span>
                    </div>
                    <p class="truncate text-xs text-muted-foreground">
                      <template v-for="(author, index) in item.authorLinks" :key="`${author.name}-${index}`">
                        <span v-if="index > 0">, </span>
                        <RouterLink
                          v-if="author.authorId !== null"
                          :to="{ name: 'author-detail', params: { id: author.authorId } }"
                          class="text-foreground hover:underline"
                          >{{ author.name }}</RouterLink
                        >
                        <span v-else>{{ author.name }}</span>
                      </template>
                    </p>
                    <p v-if="seriesLine(item)" class="truncate text-xs text-muted-foreground">
                      <RouterLink
                        v-if="item.seriesId !== null"
                        :to="{ name: 'series-detail', params: { seriesId: item.seriesId } }"
                        class="text-foreground hover:underline"
                        >{{ seriesLine(item) }}</RouterLink
                      >
                      <template v-else>{{ seriesLine(item) }}</template>
                    </p>
                    <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground tabular-nums">
                      <span v-if="item.ebookDate" class="inline-flex items-center gap-1">
                        <BookOpen :size="12" class="text-muted-foreground" aria-hidden="true" />
                        {{ t('newReleases.item.ebookOn', { date: dayLabel(item.ebookDate) }) }}
                      </span>
                      <span v-if="item.audiobookDate" class="inline-flex items-center gap-1">
                        <Headphones :size="12" class="text-muted-foreground" aria-hidden="true" />
                        {{ t('newReleases.item.audiobookOn', { date: dayLabel(item.audiobookDate) }) }}
                      </span>
                    </div>
                    <ReleaseProviderBadges :item="item" />
                    <p class="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <BellRing :size="11" class="shrink-0" aria-hidden="true" />
                      <span class="truncate">{{ becauseLine(item) }}</span>
                    </p>
                  </div>

                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <div class="flex flex-col items-end gap-1 sm:flex-row sm:items-start">
                      <RequestReleaseButton
                        v-if="item.state !== 'requested' && !isReleased(item.releaseDate)"
                        :item="item"
                        :busy="requesting === item.id"
                        :default-format="overview.server.defaultFormat"
                        @request="handleRequest"
                      />
                      <button
                        v-if="item.state === 'dismissed'"
                        type="button"
                        class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        :title="t('newReleases.item.unhide')"
                        :aria-label="t('newReleases.item.unhideNamed', { title: item.title })"
                        @click="handleUnhideClick(item)"
                      >
                        <Eye :size="15" aria-hidden="true" />
                      </button>
                      <button
                        v-else
                        type="button"
                        class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        :title="t('newReleases.item.hide')"
                        :aria-label="t('newReleases.item.hideNamed', { title: item.title })"
                        data-testid="hide-release"
                        @click="handleHide(item)"
                      >
                        <EyeOff :size="15" aria-hidden="true" />
                      </button>
                    </div>
                    <!-- Fork: stop following what this book is listed for, right where it shows. -->
                    <button
                      v-for="follow in item.matchedFollows"
                      :key="follow.id"
                      type="button"
                      class="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                      :title="follow.name"
                      :aria-label="unfollowAria(follow)"
                      :disabled="unfollowing !== null"
                      data-testid="unfollow-release-follow"
                      @click="handleUnfollowFromRelease(item, follow)"
                    >
                      {{ unfollowLabel(follow) }}
                    </button>
                  </div>
                </li>
              </ul>
            </section>
          </template>
        </template>

        <section v-else class="space-y-3" data-testid="new-releases-follows">
          <div class="flex flex-col gap-2 sm:flex-row">
            <label class="relative min-w-0 flex-1">
              <span class="sr-only">{{ t('newReleases.following.search') }}</span>
              <Search :size="14" class="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                class="h-9 w-full rounded-md border border-input bg-background ps-8 pe-2.5 text-sm"
                :placeholder="t('newReleases.following.search')"
                :value="follows.search.value"
                @input="handleSearchInput"
              />
            </label>
            <select
              class="select-field h-9 w-full sm:w-40"
              :aria-label="t('newReleases.following.kind')"
              :value="follows.kind.value"
              @change="handleKindChange"
            >
              <option value="all">{{ t('newReleases.following.all') }}</option>
              <option value="author">{{ t('newReleases.following.authors') }}</option>
              <option value="series">{{ t('newReleases.following.series') }}</option>
            </select>
          </div>

          <p v-if="follows.failed.value" class="text-sm text-destructive" role="alert">{{ t('newReleases.errors.loadFollows') }}</p>
          <p v-else-if="!follows.loading.value && follows.items.value.length === 0" class="text-sm text-muted-foreground">
            {{ t('newReleases.following.none') }}
          </p>

          <ul v-if="follows.items.value.length > 0" class="divide-y divide-border/60 rounded-lg border border-border/70 bg-card">
            <li v-for="follow in follows.items.value" :key="follow.id" class="flex items-center gap-3 px-3 py-2">
              <UserRound v-if="follow.kind === 'author'" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <Library v-else :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-foreground">{{ follow.name }}</p>
                <p v-if="follow.kind === 'series' && follow.authorHint" class="truncate text-xs text-muted-foreground">
                  {{ t('newReleases.following.seriesBy', { author: follow.authorHint }) }}
                </p>
              </div>
              <button
                type="button"
                class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :aria-label="t('newReleases.following.unfollowNamed', { name: follow.name })"
                @click="handleUnfollow(follow)"
              >
                <X :size="13" aria-hidden="true" />
                {{ t('newReleases.following.unfollow') }}
              </button>
            </li>
          </ul>

          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{{
              t('newReleases.following.count', { shown: formatNumber(follows.items.value.length), total: formatNumber(follows.total.value) })
            }}</span>
            <Button v-if="follows.hasMore.value" variant="outline" size="sm" :disabled="follows.loading.value" @click="handleLoadMore">
              {{ t('newReleases.following.more') }}
            </Button>
          </div>
        </section>
      </template>
    </div>
    <ConfirmDialog
      :open="refollowAsk !== null"
      :title="t('newReleases.followAll.refollow.title')"
      :description="refollowDescription"
      :confirm-label="t('newReleases.followAll.refollow.confirm')"
      :cancel-label="t('newReleases.followAll.refollow.cancel')"
      :busy="refollowing"
      :destructive="false"
      @confirm="handleRefollowConfirm"
      @cancel="handleRefollowCancel"
    />
  </div>
</template>
