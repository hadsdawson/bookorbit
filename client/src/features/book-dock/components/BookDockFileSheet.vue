<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateTime } from '@/i18n/formatters'
import { X, BookOpen, Check, Trash2, Sparkles, ArrowLeft, Wand2, AlertCircle, Plus } from '@lucide/vue'
import {
  getBookMediaKind,
  resolveBookDockSearchTitle,
  type BookDockFile,
  type CoverMedium,
  type BookDockMetadata,
  type MetadataCandidate,
  type MetadataSource,
  type MetadataProviderKey,
  type ProviderIds,
  isValidSeriesIndex,
  SERIES_INDEX_MAX_LENGTH,
} from '@bookorbit/types'
import BookDockStatusBadge from './BookDockStatusBadge.vue'
import IdentifierInput from '@/components/ui/IdentifierInput.vue'
import ChipInput from '@/components/ui/ChipInput.vue'
import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import { useSeriesNameSearch } from '@/features/book/composables/useMetadataFieldSearch'
import { useGenreSearch } from '@/features/book/composables/useTagSearch'
import { useGenrePolicy } from '@/features/book/composables/useGenrePolicy'
import MetadataMatchWorkspace from '@/features/book/components/metadata-match/MetadataMatchWorkspace.vue'
import type { MetadataQuery } from '@/features/book/components/metadata-match/MetadataMatchQuery.vue'
import { useBookDockDetail } from '../composables/useBookDockDetail'
import { useBookDestination } from '@/features/library/composables/useBookDestination'
import BookDestinationFields from '@/features/library/components/BookDestinationFields.vue'
import { useMetadataSearch } from '@/features/book/composables/useMetadataSearch'
import type { MetadataDiffApply } from '@/features/book/composables/useMetadataDiff'
import type { SecondCoverInput } from '@/features/book/composables/useSecondCoverRow'
import { formatBytes } from '@/lib/formatting'
import { toDisplayCoverUrl } from '@/features/book/lib/metadata-fetch'
import RichDescriptionEditor from '@/features/book/components/detail/tabs/RichDescriptionEditor.vue'

const { t } = useI18n()

const props = defineProps<{ file: BookDockFile }>()

const emit = defineEmits<{
  close: []
  discard: [BookDockFile]
  updated: [BookDockFile]
}>()

const { saved, saveError, saveMetadata, setTarget, coverUrl } = useBookDockDetail()
const destination = useBookDestination({ defaultToFirstLibrary: true })
const { libraryId: targetLibraryId, folderId: targetFolderId, hasDestination, fetchLibraries: fetchLibs } = destination

const meta = computed(() => props.file.selectedMetadata ?? props.file.embeddedMetadata ?? ({} as BookDockMetadata))

const metaView = ref<'editor' | 'search' | 'diff'>('editor')
/** Metadata fetched earlier, compared on its own without a search. */
const fetchedCandidate = ref<MetadataCandidate | null>(null)

const sheetWidthClass = computed(() => (metaView.value === 'editor' ? 'sm:w-md lg:w-lg' : 'sm:w-[min(100vw-3rem,80rem)] sm:max-w-none'))

const persistedTargetLibraryId = ref<number | null>(null)
const persistedTargetFolderId = ref<number | null>(null)
const finishing = ref(false)

const form = reactive({
  title: '',
  subtitle: '',
  authors: '',
  description: '',
  publisher: '',
  publishedDate: '',
  publishedYear: '',
  language: '',
  isbn13: '',
  isbn10: '',
  seriesName: '',
  seriesIndex: '',
  genres: '',
  tags: '',
})
const selectedCoverUrl = ref('')
/** The other format's cover, picked here so a merged ebook and audiobook both get art when filed. */
const otherCoverUrl = ref('')
const passthroughMetadata = ref<BookDockMetadata>({})
const { search: searchSeriesName } = useSeriesNameSearch()
const { search: searchAnyGenre } = useGenreSearch()
const { restricted: genresRestricted, load: loadGenrePolicy, acceptGenre, searchAllowed: searchAllowedGenres } = useGenrePolicy()
const searchGenres = computed(() => (genresRestricted.value ? searchAllowedGenres : searchAnyGenre))
onMounted(loadGenrePolicy)

/** The genres field is a chip list over the same comma-separated text the rest of the form reads. */
const genreList = computed({
  get: () => splitList(form.genres),
  set: (genres: string[]) => {
    form.genres = genres.join(', ')
    onFieldChange()
  },
})

function handleSeriesNameChange(value: string | null) {
  form.seriesName = value ?? ''
  onFieldChange()
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Genres the metadata sources gave that are not tags yet, offered one tap away. */
const genreSuggestions = computed(() => {
  const taken = new Set(splitList(form.tags).map((tag) => tag.toLowerCase()))
  const seen = new Set<string>()
  return splitList(form.genres).filter((genre) => {
    const key = genre.toLowerCase()
    if (taken.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
})

function addTags(names: string[]) {
  form.tags = [...splitList(form.tags), ...names].join(', ')
  onFieldChange()
}

function addTagFromGenre(genre: string) {
  addTags([genre])
}

function addAllGenresAsTags() {
  addTags(genreSuggestions.value)
}

const seriesIndexError = computed(() => form.seriesIndex !== '' && !isValidSeriesIndex(form.seriesIndex.trim()))

function normalizedSeriesIndex(): string | null {
  const value = form.seriesIndex.trim()
  return value && isValidSeriesIndex(value) ? value : null
}

watch(
  () => props.file.id,
  () => {
    const m = meta.value
    passthroughMetadata.value = { ...m }
    form.title = m.title ?? ''
    form.subtitle = m.subtitle ?? ''
    form.authors = m.authors?.join(', ') ?? ''
    form.description = m.description ?? ''
    form.publisher = m.publisher ?? ''
    form.publishedDate = m.publishedDate ?? ''
    form.publishedYear = m.publishedYear != null ? String(m.publishedYear) : ''
    form.language = m.language ?? ''
    form.isbn13 = m.isbn13 ?? ''
    form.isbn10 = m.isbn10 ?? ''
    form.seriesName = m.seriesName ?? ''
    form.seriesIndex = m.seriesIndex != null ? String(m.seriesIndex) : ''
    form.genres = m.genres?.join(', ') ?? ''
    form.tags = m.tags?.join(', ') ?? ''
    selectedCoverUrl.value = m.coverUrl ?? ''
    otherCoverUrl.value = m.otherFormatCoverPicked ? (m.otherFormatCoverUrl ?? '') : ''
    metaView.value = 'editor'

    destination.reset(props.file.targetLibraryId, props.file.targetFolderId)
    persistedTargetLibraryId.value = props.file.targetLibraryId
    persistedTargetFolderId.value = props.file.targetFolderId
  },
  { immediate: true },
)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingTargetSave: Promise<BookDockFile | null> | null = null

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

function buildMetadataPatchFromForm(): Partial<BookDockMetadata> {
  return {
    ...passthroughMetadata.value,
    title: form.title || undefined,
    subtitle: form.subtitle || undefined,
    authors: form.authors
      ? form.authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : undefined,
    description: form.description || undefined,
    publisher: form.publisher || undefined,
    publishedDate: form.publishedDate || undefined,
    publishedYear: form.publishedYear ? ((n) => (isNaN(n) ? undefined : n))(parseInt(form.publishedYear, 10)) : undefined,
    language: form.language || undefined,
    isbn13: form.isbn13 || undefined,
    isbn10: form.isbn10 || undefined,
    seriesName: form.seriesName || undefined,
    seriesIndex: normalizedSeriesIndex() ?? undefined,
    genres: form.genres
      ? form.genres
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean)
      : undefined,
    tags: form.tags ? splitList(form.tags) : undefined,
    coverUrl: selectedCoverUrl.value || undefined,
    ...(otherCoverUrl.value ? { otherFormatCoverUrl: otherCoverUrl.value, otherFormatCoverPicked: true } : {}),
  }
}

function handleDescriptionChange(value: string | null) {
  if ((value ?? '') === form.description) return
  form.description = value ?? ''
  onFieldChange()
}

function onFieldChange() {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (seriesIndexError.value) return
  debounceTimer = setTimeout(async () => {
    const updated = await saveMetadata(props.file.id, buildMetadataPatchFromForm())
    if (updated) emit('updated', updated)
  }, 1000)
}

function onPublishedDateChange() {
  if (/^\d{4}-\d{2}-\d{2}$/.test(form.publishedDate)) {
    form.publishedYear = form.publishedDate.slice(0, 4)
  }
  onFieldChange()
}

function onPublishedYearChange() {
  form.publishedDate = ''
  onFieldChange()
}

async function persistTarget(): Promise<BookDockFile | null> {
  if (!hasDestination.value) return null
  const libraryId = targetLibraryId.value
  const folderId = targetFolderId.value
  const previousSave = pendingTargetSave
  const request = (previousSave ?? Promise.resolve(null)).then(() => setTarget(props.file.id, libraryId, folderId))
  pendingTargetSave = request

  const updated = await request
  if (updated) {
    persistedTargetLibraryId.value = libraryId
    persistedTargetFolderId.value = folderId
    emit('updated', updated)
  }
  if (pendingTargetSave === request) pendingTargetSave = null
  return updated
}

async function handleDone() {
  if (finishing.value) return
  finishing.value = true
  try {
    if (pendingTargetSave) await pendingTargetSave
    const targetChanged = targetLibraryId.value !== persistedTargetLibraryId.value || targetFolderId.value !== persistedTargetFolderId.value
    if (targetChanged && !(await persistTarget())) return
    emit('close')
  } finally {
    finishing.value = false
  }
}

function formatDate(iso: string): string {
  return formatDateTime(new Date(iso))
}

function handleDiscard() {
  emit('discard', props.file)
}

const {
  filteredResults,
  providerCounts,
  interruptedProviders,
  retryingProviders,
  isStreaming,
  hasSearched,
  providers,
  selectedProviders,
  resultProviderOrder,
  coverProviderOrder,
  audioCoverProviderOrder,
  loadProviders,
  search,
  searchFresh,
  retryProvider,
  toggleProvider,
  selectFieldRuleProviders,
  clearProviderFilter,
  cacheSummary,
  cacheInfoFor,
} = useMetadataSearch()

const searchDefaults = computed(() => ({
  title: resolveBookDockSearchTitle(props.file.fileName, form.title),
  author: form.authors?.split(',')[0]?.trim() || undefined,
  isbn: form.isbn13 || form.isbn10 || undefined,
}))

const currentSource = computed<MetadataSource>(() => ({
  title: form.title || null,
  subtitle: form.subtitle || null,
  description: form.description || null,
  publisher: form.publisher || null,
  publishedDate: form.publishedDate || null,
  publishedYear: form.publishedYear ? ((n) => (isNaN(n) ? null : n))(parseInt(form.publishedYear, 10)) : null,
  language: form.language || null,
  pageCount: passthroughMetadata.value.pageCount ?? null,
  seriesName: form.seriesName || null,
  seriesIndex: normalizedSeriesIndex(),
  isbn10: form.isbn10 || null,
  isbn13: form.isbn13 || null,
  authors: form.authors
    ? form.authors
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : [],
  genres: form.genres
    ? form.genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
    : [],
  narrators: passthroughMetadata.value.narrators ?? [],
  durationSeconds: passthroughMetadata.value.durationSeconds ?? null,
  abridged: passthroughMetadata.value.abridged ?? null,
  hardcoverEditionId: passthroughMetadata.value.hardcoverEditionId ?? null,
  communityRatings: (passthroughMetadata.value.communityRatings ?? []).map((rating) => ({
    ...rating,
    ratingCount: rating.ratingCount ?? null,
    updatedAt: null,
  })),
}))

const providerIds = computed<ProviderIds>(() => ({
  google: passthroughMetadata.value.googleBooksId ?? null,
  goodreads: passthroughMetadata.value.goodreadsId ?? null,
  amazon: passthroughMetadata.value.amazonId ?? null,
  hardcover: passthroughMetadata.value.hardcoverId ?? null,
  openLibrary: passthroughMetadata.value.openLibraryId ?? null,
  itunes: passthroughMetadata.value.itunesId ?? null,
  audible: passthroughMetadata.value.audibleId ?? null,
  librofm: passthroughMetadata.value.librofmId ?? null,
  kobo: passthroughMetadata.value.koboId ?? null,
  comicvine: passthroughMetadata.value.comicvineId ?? null,
  ranobedb: passthroughMetadata.value.ranobedbId ?? null,
  lubimyczytac: passthroughMetadata.value.lubimyczytacId ?? null,
  aladin: passthroughMetadata.value.aladinId ?? null,
}))

async function openSearch() {
  metaView.value = 'search'
  if (hasSearched.value) return
  await loadProviders()
  const defaults = searchDefaults.value
  if (defaults.title || defaults.isbn) handleSearchSubmit({ title: defaults.title ?? '', author: defaults.author ?? '', isbn: defaults.isbn ?? '' })
}

// A search asks the sources for both formats, whichever one was docked, so an ebook can pick up its
// narrators and an audiobook its page count. Audio files still get square art.
const fileMediaKind = computed(() => getBookMediaKind(props.file.format))
const fileCoverMedium = computed<CoverMedium>(() => (fileMediaKind.value === 'audiobook' ? 'audio' : 'ebook'))

const fileCoverPriority = computed(() => (fileCoverMedium.value === 'audio' ? audioCoverProviderOrder.value : coverProviderOrder.value))

// Ebooks and audiobooks also get a row of the other format's covers, searched as that format.
const secondSearch = useMetadataSearch()
const { results: secondResults, isStreaming: secondSearching } = secondSearch
const otherCoverMedium = computed<CoverMedium | null>(() => {
  if (fileMediaKind.value === 'ebook') return 'audio'
  if (fileMediaKind.value === 'audiobook') return 'ebook'
  return null
})
const otherCoverPriority = computed(() => (otherCoverMedium.value === 'audio' ? audioCoverProviderOrder.value : coverProviderOrder.value))
const displayOtherCoverUrl = computed(() => toDisplayCoverUrl(otherCoverUrl.value))
const secondCover = computed<SecondCoverInput | null>(() => {
  const medium = otherCoverMedium.value
  if (!medium) return null
  return {
    medium,
    candidates: secondResults.value,
    priority: otherCoverPriority.value,
    currentUrl: displayOtherCoverUrl.value,
    searching: secondSearching.value,
  }
})

function searchOtherCovers(params: MetadataQuery) {
  const medium = otherCoverMedium.value
  if (!medium) return
  // The ISBN names this file's edition, so the other format is looked up by title and author only.
  void secondSearch.search({
    title: params.title,
    author: params.author,
    mediaKind: medium === 'audio' ? 'audiobook' : 'ebook',
    ...(otherCoverPriority.value.length ? { providers: otherCoverPriority.value } : {}),
  })
}

function handleSearchSubmit(params: MetadataQuery) {
  const mediaKind = fileMediaKind.value
  if (mediaKind === 'ebook' || mediaKind === 'audiobook') {
    search({ ...params, mediaKind, mediaKinds: ['ebook', 'audiobook'] })
    searchOtherCovers(params)
    return
  }
  search(mediaKind === 'unknown' ? params : { ...params, mediaKind })
}

function backToEditor() {
  metaView.value = 'editor'
  fetchedCandidate.value = null
}

function handleRetry(provider: MetadataProviderKey) {
  void retryProvider(provider)
}

function handleSearchFresh() {
  void searchFresh()
  if (otherCoverMedium.value) void secondSearch.searchFresh()
}

async function handleApply(patch: MetadataDiffApply) {
  const p = patch.formPatch
  const bookDockPatch = { ...p }
  delete bookDockPatch.customMetadata
  passthroughMetadata.value = { ...passthroughMetadata.value, ...bookDockPatch }
  if ('title' in p) form.title = p.title ?? ''
  if ('subtitle' in p) form.subtitle = p.subtitle ?? ''
  if ('description' in p) form.description = p.description ?? ''
  if ('publisher' in p) form.publisher = p.publisher ?? ''
  if ('publishedDate' in p) form.publishedDate = p.publishedDate ?? ''
  if ('publishedYear' in p) form.publishedYear = p.publishedYear == null ? '' : String(p.publishedYear)
  if ('language' in p) form.language = p.language ?? ''
  if ('isbn13' in p) form.isbn13 = p.isbn13 ?? ''
  if ('isbn10' in p) form.isbn10 = p.isbn10 ?? ''
  if ('seriesName' in p) form.seriesName = p.seriesName ?? ''
  if ('seriesIndex' in p) form.seriesIndex = p.seriesIndex == null ? '' : String(p.seriesIndex)
  if ('authors' in p) form.authors = (p.authors ?? []).join(', ')
  if ('genres' in p) form.genres = (p.genres ?? []).join(', ')

  const ownCover = fileCoverMedium.value === 'audio' ? patch.audioCoverUrl : patch.coverUrl
  const otherCover = fileCoverMedium.value === 'audio' ? patch.coverUrl : patch.audioCoverUrl
  const coverUrl = otherCoverMedium.value ? ownCover : (patch.coverUrl ?? patch.audioCoverUrl)
  if (coverUrl !== undefined) {
    selectedCoverUrl.value = coverUrl
    passthroughMetadata.value.coverUrl = coverUrl
  }
  if (otherCoverMedium.value && otherCover !== undefined) otherCoverUrl.value = otherCover

  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const updated = await saveMetadata(props.file.id, buildMetadataPatchFromForm())
  if (updated) emit('updated', updated)

  backToEditor()
}

const hasFetchedMetadata = computed(() => {
  const f = props.file.fetchedMetadata
  if (!f) return false
  return Object.values(f).some((v) => v !== undefined && v !== null && v !== '')
})

const backendBookDockCoverUrl = computed(() => `${coverUrl(props.file.id)}?v=${new Date(props.file.updatedAt).getTime()}`)
const displaySelectedCoverUrl = computed(() => toDisplayCoverUrl(selectedCoverUrl.value))
const currentBookDockCoverUrl = computed(() => displaySelectedCoverUrl.value || backendBookDockCoverUrl.value)
const currentBookDockCoverFallbackUrl = computed(() => (displaySelectedCoverUrl.value ? backendBookDockCoverUrl.value : null))

function onCurrentBookDockCoverError(event: Event) {
  const img = event.target as HTMLImageElement
  const fallback = currentBookDockCoverFallbackUrl.value
  if (!fallback) {
    img.style.display = 'none'
    return
  }

  const resolvedFallback = new URL(fallback, window.location.origin).href
  const currentSrc = img.currentSrc || img.src
  if (currentSrc !== resolvedFallback) {
    img.src = fallback
    return
  }

  img.style.display = 'none'
}

function openFetchedDiff() {
  const f = props.file.fetchedMetadata
  if (!f) return
  fetchedCandidate.value = {
    provider: 'auto' as MetadataProviderKey,
    providerId: '',
    title: f.title ?? '',
    subtitle: f.subtitle ?? undefined,
    authors: f.authors,
    description: f.description ?? undefined,
    publisher: f.publisher ?? undefined,
    publishedDate: f.publishedDate ?? undefined,
    publishedYear: f.publishedYear ?? undefined,
    language: f.language ?? undefined,
    pageCount: f.pageCount ?? undefined,
    isbn10: f.isbn10 ?? undefined,
    isbn13: f.isbn13 ?? undefined,
    seriesName: f.seriesName ?? undefined,
    seriesIndex: f.seriesIndex ?? undefined,
    genres: f.genres,
    coverUrl: f.coverUrl ?? undefined,
    narrators: f.narrators,
    durationSeconds: f.durationSeconds ?? undefined,
    abridged: f.abridged ?? undefined,
    hardcoverEditionId: f.hardcoverEditionId ?? undefined,
    seriesMemberships: f.seriesMemberships ?? undefined,
    chapters: f.chapters ?? undefined,
    comicMetadata: f.comicMetadata ?? undefined,
  }
  metaView.value = 'diff'
}

onMounted(() => {
  fetchLibs()
  loadProviders()
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex">
    <div class="hidden sm:block flex-1 bg-scrim" @click="$emit('close')" />

    <div
      class="relative flex flex-col w-full h-full bg-background sm:border-l border-border shadow-2xl overflow-hidden transition-[width,max-width] duration-300"
      :class="sheetWidthClass"
    >
      <div class="h-px w-full bg-linear-to-r from-transparent via-primary to-transparent shrink-0 opacity-60" />

      <button
        class="absolute top-3 right-3 z-10 size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        @click="$emit('close')"
      >
        <X class="size-4" />
      </button>

      <div class="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 pr-12">
        <div class="relative size-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          <img
            :src="currentBookDockCoverUrl"
            alt=""
            class="size-full object-cover"
            @load="($event.target as HTMLImageElement).style.display = ''"
            @error="onCurrentBookDockCoverError"
          />
          <BookOpen class="size-5 text-muted-foreground absolute" />
        </div>
        <div
          v-if="displayOtherCoverUrl && otherCoverMedium"
          class="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted"
          :title="t(`bookDock.sheet.otherCover.${otherCoverMedium}`)"
          data-testid="book-dock-other-cover"
        >
          <img :src="displayOtherCoverUrl" :alt="t(`bookDock.sheet.otherCover.${otherCoverMedium}`)" class="size-full object-cover" />
          <span class="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[9px] font-medium leading-3 text-white">{{
            t(`bookDock.sheet.otherCover.short.${otherCoverMedium}`)
          }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate">{{ file.fileName }}</p>
          <div class="flex items-center gap-2 mt-0.5">
            <BookDockStatusBadge :status="file.status" />
            <span class="text-xs text-muted-foreground uppercase">{{ file.format }}</span>
            <span class="text-xs text-muted-foreground">{{ formatBytes(file.fileSize) }}</span>
          </div>
        </div>
        <div v-if="saved" class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <Check class="size-3.5" />
          {{ t('bookDock.sheet.saved') }}
        </div>
      </div>

      <!-- Metadata editor view -->
      <template v-if="metaView === 'editor'">
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <p v-if="file.errorMessage" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ file.errorMessage }}</p>

          <div v-if="saveError" class="flex items-center gap-2 p-2.5 rounded-lg border border-red-500/30 bg-red-500/5">
            <AlertCircle class="size-3.5 text-red-500 shrink-0" />
            <p class="flex-1 text-xs text-red-600 dark:text-red-400">{{ saveError }}</p>
            <button class="shrink-0 text-red-400 hover:text-red-600 transition-colors" @click="saveError = null">
              <X class="size-3.5" />
            </button>
          </div>

          <div v-if="hasFetchedMetadata" class="flex items-center gap-2.5 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <Wand2 class="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p class="flex-1 text-sm text-amber-700 dark:text-amber-300">
              {{ file.metadataEditedAt ? t('bookDock.sheet.providerMetadataFoundEdited') : t('bookDock.sheet.providerMetadataFound') }}
            </p>
            <button
              class="shrink-0 flex items-center gap-1.5 h-7 px-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-all active:scale-95"
              @click="openFetchedDiff"
            >
              {{ t('bookDock.sheet.review') }}
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.title') }}</span>
              <input
                v-model="form.title"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.subtitle') }}</span>
              <input
                v-model="form.subtitle"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label class="sm:col-span-2">
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.authorsCommaSeparated') }}</span>
              <input
                v-model="form.authors"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.publisher') }}</span>
              <input
                v-model="form.publisher"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.publishedDate') }}</span>
              <input
                v-model="form.publishedDate"
                type="date"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onPublishedDateChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.year') }}</span>
              <input
                v-model="form.publishedYear"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onPublishedYearChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.language') }}</span>
              <input
                v-model="form.language"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.isbn13') }}</span>
              <IdentifierInput
                v-model="form.isbn13"
                kind="isbn"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.isbn10') }}</span>
              <IdentifierInput
                v-model="form.isbn10"
                kind="isbn"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.series') }}</span>
              <InputWithSuggestions
                :model-value="form.seriesName"
                :search-fn="searchSeriesName"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @update:model-value="handleSeriesNameChange"
              />
            </label>
            <label>
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.seriesIndex') }}</span>
              <input
                v-model="form.seriesIndex"
                type="text"
                inputmode="decimal"
                :maxlength="SERIES_INDEX_MAX_LENGTH"
                :aria-invalid="seriesIndexError"
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                @input="onFieldChange"
              />
              <span v-if="seriesIndexError" class="mt-1 block text-xs text-destructive" role="alert">
                {{ t('bookDock.invalidSeriesIndex') }}
              </span>
            </label>
            <div class="sm:col-span-2">
              <label for="book-dock-genres" class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.genres') }}</label>
              <ChipInput v-model="genreList" input-id="book-dock-genres" :search-fn="searchGenres" :normalize="acceptGenre" class="mt-1" />
              <p v-if="genresRestricted" class="mt-1 text-xs text-muted-foreground">{{ t('bookDock.field.genresRestricted') }}</p>
            </div>
            <div class="sm:col-span-2">
              <label>
                <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.tagsCommaSeparated') }}</span>
                <input
                  v-model="form.tags"
                  class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  @input="onFieldChange"
                />
              </label>
              <div v-if="genreSuggestions.length" class="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span class="text-xs text-muted-foreground">{{ t('bookDock.field.tagsFromGenres') }}</span>
                <button
                  v-for="genre in genreSuggestions"
                  :key="genre"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  :aria-label="t('bookDock.field.addTag', { tag: genre })"
                  @click="addTagFromGenre(genre)"
                >
                  <Plus :size="11" aria-hidden="true" />
                  {{ genre }}
                </button>
                <button
                  v-if="genreSuggestions.length > 1"
                  type="button"
                  class="rounded-full px-2 py-0.5 text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  @click="addAllGenresAsTags"
                >
                  {{ t('bookDock.field.addAllGenres') }}
                </button>
              </div>
            </div>
            <div class="sm:col-span-2" data-testid="book-dock-description">
              <span class="text-xs font-medium text-muted-foreground">{{ t('bookDock.field.description') }}</span>
              <RichDescriptionEditor :model-value="form.description" class="mt-1 min-h-48" @update:model-value="handleDescriptionChange" />
            </div>
          </div>

          <BookDestinationFields
            :destination="destination"
            :library-label="t('bookDock.destinationLibrary')"
            :folder-label="t('bookDock.destinationFolder')"
            @change="persistTarget"
          />

          <p class="text-xs text-muted-foreground">{{ t('bookDock.sheet.added', { date: formatDate(file.createdAt) }) }}</p>
        </div>

        <div class="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0">
          <button
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-all active:scale-95"
            @click="handleDiscard"
          >
            <Trash2 class="size-3.5" />
            {{ t('bookDock.discard') }}
          </button>
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-primary-foreground text-sm font-medium transition-all active:scale-95"
              style="
                background: linear-gradient(to right, var(--primary), color-mix(in oklch, var(--primary) 65%, oklch(0.7 0.25 280)));
                box-shadow: 0 2px 10px color-mix(in oklch, var(--primary) 45%, transparent);
              "
              @click="openSearch"
            >
              <Sparkles class="size-3.5" />
              {{ t('common.search') }}
            </button>
            <button
              class="relative h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95"
              :disabled="finishing"
              @click="handleDone"
            >
              {{ t('bookDock.done') }}
            </button>
          </div>
        </div>
      </template>

      <!-- Metadata search and compare -->
      <template v-else>
        <div class="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <button
            class="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            :aria-label="t('common.back')"
            @click="backToEditor"
          >
            <ArrowLeft class="size-4" />
          </button>
          <Sparkles class="size-3.5 text-primary" />
          <span class="text-sm font-medium">{{
            metaView === 'diff' ? t('book.detail.editMetadata.searchDrawer.compareTitle') : t('bookDock.sheet.searchMetadata')
          }}</span>
        </div>
        <MetadataMatchWorkspace
          class="min-h-0 flex-1"
          :current="currentSource"
          :provider-ids="providerIds"
          :current-cover-url="currentBookDockCoverUrl"
          :cover-medium="fileCoverMedium"
          :cover-priority="fileCoverPriority"
          :second-cover="secondCover"
          :search-defaults="searchDefaults"
          :providers="providers"
          :results="filteredResults"
          :provider-counts="providerCounts"
          :selected-providers="selectedProviders"
          :interrupted-providers="interruptedProviders"
          :retrying-providers="retryingProviders"
          :provider-order="resultProviderOrder"
          :is-streaming="isStreaming"
          :has-searched="hasSearched"
          :fixed-candidate="metaView === 'diff' ? fetchedCandidate : null"
          :apply-hint="t('book.detail.editMetadata.match.footer.fileHint')"
          can-search-fresh
          :cache-summary="cacheSummary"
          :cache-info="cacheInfoFor"
          @search="handleSearchSubmit"
          @toggle-provider="toggleProvider"
          @select-all="clearProviderFilter"
          @select-field-rules="selectFieldRuleProviders"
          @retry-provider="handleRetry"
          @search-fresh="handleSearchFresh"
          @apply="handleApply"
          @cancel="backToEditor"
        />
      </template>
    </div>
  </div>
</template>
