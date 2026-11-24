<script setup lang="ts">
import { useWindowSize } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, ChevronLeft, ImageMinus, Layers, LayoutGrid, Link, List, Upload } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { AuthorDetail, AuthorNames, AuthorNeighbors, AuthorSummary, BookCard } from '@bookorbit/types'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import SingleSortControl from '@/features/book/components/sort-filter/SingleSortControl.vue'
import LibraryMenuButton from '@/components/browse-header/LibraryMenuButton.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { usePageTitle } from '@/composables/usePageTitle'
import { useDeleteBook } from '@/features/book/composables/useDeleteBook'
import AuthorHeader from '../components/AuthorHeader.vue'
import AuthorConfirmDialog from '../components/AuthorConfirmDialog.vue'
import AuthorFactsFields from '../components/AuthorFactsFields.vue'
import AuthorMatchSheet from '../components/AuthorMatchSheet.vue'
import AuthorAliasesCard from '../components/AuthorAliasesCard.vue'
import AuthorPenNameBooks from '../components/AuthorPenNameBooks.vue'
import AuthorPenNameChooser from '../components/AuthorPenNameChooser.vue'
import { authorFactsDraft, authorFactsPayload, sameFactsDraft, type AuthorFactsDraft, type AuthorFactsField } from '../lib/author-facts'
import {
  deleteAuthorImage,
  deleteAuthors,
  fetchAuthorNames,
  fetchAuthorNeighbors,
  fetchAuthors,
  mergeAuthors,
  MAX_AUTHOR_IMAGE_BYTES,
  refreshAuthorMetadata,
  updateAuthor,
  uploadAuthorImage,
  uploadAuthorImageFromUrl,
} from '../api/author'
import { useAuthorBooks } from '../composables/useAuthorBooks'
import type { AuthorBookSort, SortDirection } from '../types/author'
import { authorListParamsFromQuery } from '../lib/author-list-route'
import { useAuthorDetail } from '../composables/useAuthorDetail'
import { useAuthorMetadataPreview } from '../composables/useAuthorMetadataPreview'
import EntityNotFound from '@/components/EntityNotFound.vue'
import { showCacheFallbackToast } from '@/features/metadata-cache/lib/cache-feedback'
import { splitMetadataCacheUsage, usageFallbackProviders } from '@/features/metadata-cache/lib/metadata-cache'
import { metadataProviderLabel } from '@/features/book/lib/metadata-refresh-feedback'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
const { isSuperuser } = usePermissions()
const { width: windowWidth } = useWindowSize()

const { portraitCoverSize, gridGap } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()
const { hasPermissionInAnyLibrary } = useLibraryPermissions()

const authorBooksViewMode = ref<'grid' | 'list'>('grid')

// Kept alive per path, so this page's author never changes. The shared route moves on while the
// page is hidden, and following its `id` would load whichever author shares the next page's id.
const authorId = shallowRef(Number(route.params.id))
const { author, loading: loadingAuthor, error: authorError, notFound: authorNotFound, load: loadAuthor } = useAuthorDetail(authorId)
const {
  items: books,
  total,
  bookTotal,
  loading: loadingBooks,
  error: booksError,
  hasMore,
  sort,
  order,
  libraryId,
  collapseSeries,
  load: loadBooks,
} = useAuthorBooks(authorId)

// One flag for every author page, so the state carries from one author to the next rather than
// being re-chosen per author; the toggle below writes it back. Tracked rather than read once,
// because on a cold load of an author URL the signed-in user - and so the preference - can
// arrive after this component is set up.
const { getEffectivePreference, setPreference } = useSeriesCollapsePreference()
watch(
  () => getEffectivePreference({ authorPages: true }),
  (value) => (collapseSeries.value = value),
  { immediate: true },
)
const authorName = computed(() => author.value?.name ?? '')
const pinnedMatch = computed(() => {
  const value = author.value
  if (!value?.metadataProviderPinned || !value.metadataProvider || !value.metadataProviderId) return null
  return { provider: value.metadataProvider, providerId: value.metadataProviderId }
})
const pageTitle = computed(() => {
  if (author.value?.name) return t('author.detail.pageTitleNamed', { name: author.value.name })
  return Number.isFinite(authorId.value) ? t('author.detail.pageTitleId', { id: authorId.value }) : t('author.detail.pageTitle')
})
usePageTitle(pageTitle)
const {
  preview: metadataPreview,
  previewCache: metadataPreviewCache,
  cacheSummary: metadataCacheSummary,
  loading: loadingMetadataPreview,
  searched: metadataPreviewSearched,
  error: metadataPreviewError,
  cancel: cancelMetadataPreview,
  load: loadMetadataPreview,
  loadFresh: loadFreshMetadataPreview,
} = useAuthorMetadataPreview(authorName, pinnedMatch)

const canUpdate = computed(() => hasPermissionInAnyLibrary('library_edit_metadata', 'editor'))

// Fork: the other names this author goes by. A pen name has no page of its own: its page sends the
// reader on to the person behind it, or asks which one when the pen name is shared.
const emptyNames: AuthorNames = { spellings: [], penNames: [], penNameOf: [] }
const names = ref<AuthorNames>(emptyNames)
const namesLoadedFor = ref<number | null>(null)
const isPenName = computed(() => namesLoadedFor.value === authorId.value && names.value.penNameOf.length > 0)
const chooserOpen = computed(() => isPenName.value && names.value.penNameOf.length > 1)
const hasPenNames = computed(() => names.value.penNames.length > 0)

async function loadNames() {
  const id = authorId.value
  if (!id || Number.isNaN(id)) return
  try {
    const result = await fetchAuthorNames(id)
    if (id !== authorId.value) return
    names.value = result
  } catch {
    if (id !== authorId.value) return
    names.value = emptyNames
  }
  namesLoadedFor.value = id
  if (names.value.penNameOf.length === 1) openPenNameOwner(names.value.penNameOf[0]!.id)
}

function openPenNameOwner(ownerId: number) {
  void router.replace({ name: 'author-detail', params: { id: ownerId }, query: route.query, hash: `#pen-name-${authorId.value}` })
}

function handleChoosePenNameOwner(ownerId: number) {
  openPenNameOwner(ownerId)
}

function handleCancelPenNameChooser() {
  goBack()
}

function handleNamesUpdate(next: AuthorNames) {
  names.value = next
}

// Adding a spelling another author used folds that author in, and pen names change the counts.
function handleAliasesChanged() {
  void Promise.all([loadAuthor(), loadBooks(true)])
}

function handleOpenAuthor(id: number) {
  void router.push({ name: 'author-detail', params: { id } })
}
const canMerge = computed(() => isSuperuser.value)
const canDelete = computed(() => isSuperuser.value)

const editOpen = ref(false)
const mergeOpen = ref(false)
const confirmMergeOpen = ref(false)
const confirmDeleteOpen = ref(false)
const savingEdit = ref(false)
const merging = ref(false)
const deleting = ref(false)
const refreshingMetadata = ref(false)
const uploadingImage = ref(false)
const imageUrlDraft = ref('')
const removingImage = ref(false)
const authorImageInput = ref<HTMLInputElement | null>(null)

const draftName = ref('')
const draftSortName = ref('')
const draftDescription = ref('')
const draftFacts = ref<AuthorFactsDraft>(authorFactsDraft(null))
const invalidFacts = ref<AuthorFactsField[]>([])
const seededDrafts = ref<{ name: string; sortName: string; description: string; facts: AuthorFactsDraft } | null>(null)
const authorImageBusy = computed(() => uploadingImage.value || removingImage.value)
const matchSheetOpen = ref(false)

const draftsDirty = computed(() => {
  const seeded = seededDrafts.value
  if (!seeded) return false
  return (
    draftName.value !== seeded.name ||
    draftSortName.value !== seeded.sortName ||
    draftDescription.value !== seeded.description ||
    !sameFactsDraft(draftFacts.value, seeded.facts)
  )
})

const mergeQuery = ref('')
const mergeCandidates = ref<AuthorSummary[]>([])
const selectedMergeIds = ref<number[]>([])
const searchingMergeCandidates = ref(false)
let mergeSearchTimer: ReturnType<typeof setTimeout> | null = null

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const selectedMergeBookCount = computed(() => {
  const selected = new Set(selectedMergeIds.value)
  return mergeCandidates.value.filter((candidate) => selected.has(candidate.id)).reduce((sum, candidate) => sum + candidate.bookCount, 0)
})

const BOOK_SORT_FIELDS: AuthorBookSort[] = ['addedAt', 'title', 'publishedYear']

const bookSortLabels = computed<Record<AuthorBookSort, string>>(() => ({
  addedAt: t('author.detail.books.sort.recentlyAdded'),
  title: t('author.detail.books.sort.title'),
  publishedYear: t('author.detail.books.sort.publishedYear'),
}))

// 'move-to-library' is part of the shared card contract; this view does not
// opt in, so it never fires here.
type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'move-to-library' | 'delete'

const {
  pendingId: deleteBookId,
  deleting: deletingBook,
  editions: deleteEditions,
  promptDelete,
  cancelDelete,
  confirmDelete,
} = useDeleteBook((id) => {
  const previousLength = books.value.length
  books.value = books.value.filter((b) => b.id !== id)
  if (books.value.length === previousLength) return

  // Only a plain book card carries a delete action - a collapsed series row opens the series
  // instead - so the card that just went is worth exactly one row and one book.
  total.value = Math.max(0, total.value - 1)
  bookTotal.value = Math.max(0, bookTotal.value - 1)
  if (author.value) {
    author.value = {
      ...author.value,
      bookCount: Math.max(0, author.value.bookCount - 1),
      ...(author.value.workCount === undefined ? {} : { workCount: Math.max(0, author.value.workCount - 1) }),
    }
  }
})

function showRefreshResultToast(updated: { imageUrl?: string | null }) {
  if (!updated.imageUrl) {
    toast.warning(t('author.detail.toast.refreshedNoImage'))
    return
  }
  toast.success(t('author.detail.toast.refreshed'))
}

function seedDrafts(value: AuthorDetail | null) {
  const seeded = {
    name: value?.name ?? '',
    sortName: value?.sortName ?? '',
    description: value?.description ?? '',
    facts: authorFactsDraft(value),
  }
  draftName.value = seeded.name
  draftSortName.value = seeded.sortName
  draftDescription.value = seeded.description
  draftFacts.value = authorFactsDraft(value)
  invalidFacts.value = []
  seededDrafts.value = seeded
}

// Image uploads, image removal and metadata refresh all replace the whole author
// object, so re-seeding on every change would discard edits typed but not saved.
watch(
  author,
  (value, previous) => {
    const sameAuthor = previous != null && value != null && previous.id === value.id
    if (sameAuthor && draftsDirty.value) return
    seedDrafts(value)
  },
  { immediate: true },
)

// After a failed save, re-check as the user types so a corrected field loses its error at once.
watch(
  draftFacts,
  (draft) => {
    if (invalidFacts.value.length === 0 || !seededDrafts.value) return
    invalidFacts.value = authorFactsPayload(draft, seededDrafts.value.facts).invalid
  },
  { deep: true },
)

// Fork: steps to the author before or after this one in the Authors list it was opened from,
// under that list's sort and filters (the plain A-Z list when opened from anywhere else).
const neighbors = ref<AuthorNeighbors>({ previous: null, next: null })
const listQuery = computed(() => {
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  if (!from.startsWith('/authors')) return {}
  return Object.fromEntries(new URL(from, window.location.origin).searchParams.entries())
})

async function loadNeighbors() {
  const id = authorId.value
  if (!id || Number.isNaN(id)) return
  try {
    const result = await fetchAuthorNeighbors(id, authorListParamsFromQuery(listQuery.value))
    if (id === authorId.value) neighbors.value = result
  } catch {
    if (id === authorId.value) neighbors.value = { previous: null, next: null }
  }
}

function openNeighbor(id: number) {
  if (mainRef.value) mainRef.value.scrollTop = 0
  void router.push({ name: 'author-detail', params: { id }, query: route.query.from ? { from: route.query.from } : {} })
}

function goToPreviousAuthor() {
  if (neighbors.value.previous) openNeighbor(neighbors.value.previous.id)
}

function goToNextAuthor() {
  if (neighbors.value.next) openNeighbor(neighbors.value.next.id)
}

function goBack() {
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  if (from.startsWith('/authors')) {
    void router.push(from)
    return
  }
  if (window.history.length > 1) {
    router.back()
    return
  }
  void router.push({ name: 'authors' })
}

function toggleEdit() {
  editOpen.value = !editOpen.value
  if (editOpen.value) mergeOpen.value = false
}

function toggleMerge() {
  mergeOpen.value = !mergeOpen.value
  if (mergeOpen.value) editOpen.value = false
}

function handleBookAction(book: BookCard, action: BookActionType) {
  if (action === 'quick-view') {
    void router.push({ name: 'book-detail', params: { bookId: book.id } })
    return
  }

  if (action === 'delete') {
    promptDelete(book.id, book)
  }
}

function handleBookUpdate(updated: BookCard) {
  const idx = books.value.findIndex((b) => b.id === updated.id)
  if (idx !== -1) books.value = books.value.map((b, i) => (i === idx ? updated : b))
}

const collapseToggleLabel = computed(() => (collapseSeries.value ? t('views.bookView.expandSeries') : t('views.bookView.collapseSeries')))

async function handleToggleCollapse() {
  const next = !collapseSeries.value
  collapseSeries.value = next
  await setPreference({ authorPages: true }, next)
}

function loadIfSentinelVisible() {
  if (loadingBooks.value || !hasMore.value || !sentinel.value) return
  if (sentinel.value.getBoundingClientRect().top < window.innerHeight + 250) {
    void loadBooks()
  }
}

async function saveAuthorEdits() {
  if (!author.value || savingEdit.value) return
  const name = draftName.value.trim()
  if (!name) {
    toast.error(t('author.detail.toast.nameRequired'))
    return
  }

  const facts = authorFactsPayload(draftFacts.value, seededDrafts.value?.facts ?? authorFactsDraft(author.value))
  invalidFacts.value = facts.invalid
  if (facts.invalid.length > 0) return

  savingEdit.value = true
  try {
    const updated = await updateAuthor(author.value.id, {
      name,
      sortName: draftSortName.value.trim() || null,
      description: draftDescription.value.trim() || null,
      ...facts.payload,
    })
    author.value = updated
    seedDrafts(updated)
    editOpen.value = false
    toast.success(t('author.detail.toast.updated'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.toast.updateFailed'))
  } finally {
    savingEdit.value = false
  }
}

function openAuthorImagePicker() {
  if (!author.value || authorImageBusy.value) return
  authorImageInput.value?.click()
}

// Fork: set the photo from an image link instead of a file.
async function useAuthorImageUrl() {
  const url = imageUrlDraft.value.trim()
  if (!url || !author.value || authorImageBusy.value) return

  uploadingImage.value = true
  try {
    author.value = await uploadAuthorImageFromUrl(author.value.id, url)
    imageUrlDraft.value = ''
    toast.success(t('author.detail.toast.imageUpdated'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.toast.imageUploadFailed'))
  } finally {
    uploadingImage.value = false
  }
}

async function onAuthorImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !author.value || authorImageBusy.value) return

  uploadingImage.value = true
  try {
    const updated = await uploadAuthorImage(author.value.id, file)
    author.value = updated
    toast.success(t('author.detail.toast.imageUpdated'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.toast.imageUploadFailed'))
  } finally {
    uploadingImage.value = false
  }
}

async function removeAuthorImage() {
  if (!author.value || authorImageBusy.value || !author.value.imageUrl) return

  removingImage.value = true
  try {
    const updated = await deleteAuthorImage(author.value.id)
    author.value = updated
    toast.success(t('author.detail.toast.imageRemoved'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.toast.imageRemoveFailed'))
  } finally {
    removingImage.value = false
  }
}

async function searchMergeCandidates() {
  if (!mergeOpen.value || !mergeQuery.value.trim()) {
    mergeCandidates.value = []
    return
  }

  searchingMergeCandidates.value = true
  try {
    const page = await fetchAuthors({
      q: mergeQuery.value.trim(),
      page: 0,
      size: 20,
      sort: 'name',
      order: 'asc',
      libraryId: null,
    })

    mergeCandidates.value = page.items.filter((candidate) => candidate.id !== authorId.value)
  } catch {
    mergeCandidates.value = []
  } finally {
    searchingMergeCandidates.value = false
  }
}

function toggleMergeCandidate(candidateId: number, checked: boolean) {
  const current = new Set(selectedMergeIds.value)
  if (checked) current.add(candidateId)
  else current.delete(candidateId)
  selectedMergeIds.value = [...current]
}

function onMergeCandidateToggle(candidateId: number, event: Event) {
  const target = event.target as HTMLInputElement | null
  toggleMergeCandidate(candidateId, target?.checked ?? false)
}

async function runMerge() {
  if (!author.value || merging.value || selectedMergeIds.value.length === 0) return

  confirmMergeOpen.value = false
  merging.value = true
  try {
    const result = await mergeAuthors({
      targetAuthorId: author.value.id,
      sourceAuthorIds: selectedMergeIds.value,
    })

    author.value = result.target
    selectedMergeIds.value = []
    mergeCandidates.value = []
    mergeQuery.value = ''
    mergeOpen.value = false

    await loadBooks(true)
    void loadNames()
    toast.success(t('author.detail.toast.mergeSuccess', { count: result.mergedAuthorIds.length, books: result.affectedBookCount }))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.toast.mergeFailed'))
  } finally {
    merging.value = false
  }
}

async function runDelete() {
  if (!author.value || deleting.value) return

  confirmDeleteOpen.value = false
  deleting.value = true
  try {
    const result = await deleteAuthors({ authorIds: [author.value.id] })
    toast.success(t('author.detail.toast.deleteSuccess', { books: result.affectedBookCount }))
    await router.push({ name: 'authors' })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.toast.deleteFailed'))
  } finally {
    deleting.value = false
  }
}

function promptRunMerge() {
  if (!author.value || merging.value || selectedMergeIds.value.length === 0) return
  confirmMergeOpen.value = true
}

const mergeDialogTitle = computed(() => {
  if (!author.value) return t('author.detail.mergeDialog.titleFallback')
  return t('author.detail.mergeDialog.title', { count: selectedMergeIds.value.length, name: author.value.name })
})

const mergeDialogDescription = computed(() => {
  if (selectedMergeIds.value.length === 0) return t('author.detail.mergeDialog.descriptionEmpty')
  return t('author.detail.mergeDialog.description')
})

const isMobileLayout = computed(() => windowWidth.value < 640)
const authorBookCoverSize = computed(() => {
  const configuredSize = Number(portraitCoverSize.value)
  const normalizedSize = Number.isFinite(configuredSize) && configuredSize > 0 ? configuredSize : 130
  if (!isMobileLayout.value) return normalizedSize
  return Math.min(normalizedSize, 110)
})
const authorBookGridGap = computed(() => {
  const configuredGap = Number(gridGap.value)
  const normalizedGap = Number.isFinite(configuredGap) && configuredGap > 0 ? configuredGap : 20
  if (!isMobileLayout.value) return normalizedGap
  return Math.min(normalizedGap, 12)
})

function handleLibraryChange(value: number | null) {
  libraryId.value = value
}

function handleBookSort(field: AuthorBookSort, dir: SortDirection) {
  sort.value = field
  order.value = dir
}

async function refreshMetadata() {
  if (!author.value || refreshingMetadata.value) return
  refreshingMetadata.value = true
  try {
    const { value: updated, usage } = splitMetadataCacheUsage(await refreshAuthorMetadata(author.value.id))
    author.value = updated
    await loadMetadataPreview()
    showRefreshResultToast(updated)
    showCacheFallbackToast(usageFallbackProviders(usage), metadataProviderLabel)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('author.detail.toast.refreshFailed'))
  } finally {
    refreshingMetadata.value = false
  }
}

function searchMetadataPreviewFresh() {
  void loadFreshMetadataPreview()
}

function openMatchSheet() {
  matchSheetOpen.value = true
}

function closeMatchSheet() {
  matchSheetOpen.value = false
}

async function handleMatchUpdated(updated: AuthorDetail) {
  author.value = updated
  seedDrafts(updated)
  await loadMetadataPreview()
}

onMounted(async () => {
  void loadNames()
  void loadNeighbors()
  await fetchLibraries()
  await Promise.all([loadAuthor(), loadBooks(true)])

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loadingBooks.value && hasMore.value) {
        void loadBooks()
      }
    },
    { rootMargin: '280px' },
  )

  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => {
  observer?.disconnect()
  if (mergeSearchTimer) clearTimeout(mergeSearchTimer)
  cancelMetadataPreview()
})

watch([sort, order, libraryId, collapseSeries], () => {
  void loadBooks(true)
})

watch(mergeQuery, () => {
  if (mergeSearchTimer) clearTimeout(mergeSearchTimer)
  mergeSearchTimer = setTimeout(() => {
    void searchMergeCandidates()
  }, 220)
})

watch(
  loadingBooks,
  (isLoading) => {
    if (!isLoading) loadIfSentinelVisible()
  },
  { flush: 'post' },
)

watch(authorName, () => {
  void loadMetadataPreview()
})

defineOptions({ name: 'AuthorDetailView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <main ref="mainRef" class="flex flex-1 min-h-0 w-full min-w-0 flex-col overflow-y-auto overflow-x-hidden pr-0 sm:pr-2">
      <div class="mb-3 mt-2 mr-0 sm:mr-4 flex min-h-11 items-center gap-2 px-1">
        <button
          class="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="goBack"
        >
          <ChevronLeft :size="14" />
          {{ t('common.back') }}
        </button>
        <div v-if="!isPenName && (neighbors.previous || neighbors.next)" class="ml-auto flex items-center gap-1.5" data-testid="author-neighbors">
          <button
            type="button"
            class="inline-flex h-8 max-w-[11rem] items-center gap-1 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            :disabled="!neighbors.previous"
            :title="neighbors.previous ? t('author.detail.neighbors.previousNamed', { name: neighbors.previous.name }) : ''"
            :aria-label="
              neighbors.previous
                ? t('author.detail.neighbors.previousNamed', { name: neighbors.previous.name })
                : t('author.detail.neighbors.previous')
            "
            data-testid="author-previous"
            @click="goToPreviousAuthor"
          >
            <ArrowLeft :size="14" class="shrink-0" />
            <span class="hidden truncate sm:inline">{{ neighbors.previous?.name ?? t('author.detail.neighbors.previous') }}</span>
          </button>
          <button
            type="button"
            class="inline-flex h-8 max-w-[11rem] items-center gap-1 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            :disabled="!neighbors.next"
            :title="neighbors.next ? t('author.detail.neighbors.nextNamed', { name: neighbors.next.name }) : ''"
            :aria-label="neighbors.next ? t('author.detail.neighbors.nextNamed', { name: neighbors.next.name }) : t('author.detail.neighbors.next')"
            data-testid="author-next"
            @click="goToNextAuthor"
          >
            <span class="hidden truncate sm:inline">{{ neighbors.next?.name ?? t('author.detail.neighbors.next') }}</span>
            <ArrowRight :size="14" class="shrink-0" />
          </button>
        </div>
      </div>

      <div v-if="authorNotFound">
        <EntityNotFound :entity="t('author.detail.entityName')" />
      </div>

      <div v-else-if="isPenName" class="mb-4 rounded-lg border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
        {{ t('author.detail.penNameRedirect') }}
      </div>

      <template v-else>
        <div v-if="authorError" class="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {{ authorError }}
        </div>

        <div v-if="loadingAuthor && !author" class="mb-4 rounded-lg border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
          {{ t('author.detail.loadingAuthor') }}
        </div>
        <AuthorHeader
          v-else-if="author"
          :author="author"
          :image-url="author.imageUrl ?? metadataPreview?.imageUrl ?? null"
          :preview-description="metadataPreview?.description ?? null"
          :preview-provider="metadataPreview?.provider ?? null"
          :preview-cache="metadataPreviewCache"
          :cache-summary="metadataCacheSummary"
          :loading-preview="loadingMetadataPreview"
          :preview-searched="metadataPreviewSearched"
          :can-update="canUpdate"
          :can-merge="canMerge"
          :can-delete="canDelete"
          :refreshing="refreshingMetadata"
          @edit="toggleEdit"
          @merge="toggleMerge"
          @refresh="refreshMetadata"
          @search-fresh="searchMetadataPreviewFresh"
          @find-match="openMatchSheet"
          @delete="confirmDeleteOpen = true"
        />
        <AuthorMatchSheet v-if="author && matchSheetOpen && canUpdate" :author="author" @close="closeMatchSheet" @updated="handleMatchUpdated" />
        <AuthorAliasesCard
          v-if="author"
          :author-id="author.id"
          :author-name="author.name"
          :names="names"
          :can-edit="canUpdate"
          @update:names="handleNamesUpdate"
          @changed="handleAliasesChanged"
          @open="handleOpenAuthor"
        />

        <div v-if="metadataPreviewError" class="mt-3 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {{ t('author.detail.previewError') }}
        </div>

        <section v-if="author && (editOpen || mergeOpen)" class="mt-4 rounded-lg border border-border/70 bg-card/60 p-3 space-y-3">
          <div v-if="editOpen && canUpdate" class="space-y-2">
            <div class="grid gap-2 md:grid-cols-2">
              <label class="text-xs text-muted-foreground">
                {{ t('author.detail.edit.name') }}
                <input v-model="draftName" class="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm" />
              </label>
              <label class="text-xs text-muted-foreground">
                {{ t('author.detail.edit.sortName') }}
                <input v-model="draftSortName" class="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm" />
              </label>
            </div>
            <label class="block text-xs text-muted-foreground">
              {{ t('author.detail.edit.description') }}
              <textarea v-model="draftDescription" rows="3" class="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm" />
            </label>
            <AuthorFactsFields v-model="draftFacts" :invalid="invalidFacts" />
            <div class="space-y-1.5">
              <p class="text-xs text-muted-foreground">{{ t('author.detail.edit.image') }}</p>
              <input ref="authorImageInput" type="file" accept="image/*" class="hidden" :disabled="authorImageBusy" @change="onAuthorImageSelected" />
              <div class="flex flex-wrap items-center gap-2">
                <button
                  :disabled="authorImageBusy"
                  class="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  @click="openAuthorImagePicker"
                >
                  <Upload :size="14" />
                  {{
                    uploadingImage
                      ? t('author.detail.edit.uploading')
                      : author?.imageUrl
                        ? t('author.detail.edit.replaceImage')
                        : t('author.detail.edit.uploadImage')
                  }}
                </button>
                <button
                  :disabled="authorImageBusy || !author?.imageUrl"
                  class="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  @click="removeAuthorImage"
                >
                  <ImageMinus :size="14" />
                  {{ removingImage ? t('author.detail.edit.removing') : t('author.detail.edit.removeImage') }}
                </button>
              </div>
              <form class="flex flex-wrap items-center gap-2" @submit.prevent="useAuthorImageUrl">
                <input
                  v-model="imageUrlDraft"
                  type="url"
                  inputmode="url"
                  class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
                  :placeholder="t('author.detail.edit.imageUrlPlaceholder')"
                  :aria-label="t('author.detail.edit.imageUrlPlaceholder')"
                  :disabled="authorImageBusy"
                />
                <button
                  type="submit"
                  :disabled="authorImageBusy || !imageUrlDraft.trim()"
                  class="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <Link :size="14" />
                  {{ t('author.detail.edit.useImageUrl') }}
                </button>
              </form>
              <p class="text-[11px] text-muted-foreground">
                {{ t('author.detail.edit.imageHint', { size: Math.floor(MAX_AUTHOR_IMAGE_BYTES / 1024 / 1024) }) }}
              </p>
            </div>
            <div class="flex items-center justify-end gap-2">
              <button class="h-8 rounded-md border border-input px-3 text-sm text-muted-foreground hover:bg-muted" @click="editOpen = false">
                {{ t('common.cancel') }}
              </button>
              <button
                :disabled="savingEdit"
                class="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
                @click="saveAuthorEdits"
              >
                {{ savingEdit ? t('author.detail.edit.saving') : t('common.save') }}
              </button>
            </div>
          </div>

          <div v-if="mergeOpen && canMerge" class="space-y-2">
            <input
              v-model="mergeQuery"
              class="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
              :placeholder="t('author.detail.merge.searchPlaceholder')"
            />

            <div v-if="searchingMergeCandidates" class="text-xs text-muted-foreground">{{ t('author.detail.merge.searching') }}</div>

            <div v-if="mergeCandidates.length > 0" class="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/70 bg-background/50 p-2">
              <label v-for="candidate in mergeCandidates" :key="candidate.id" class="flex items-center gap-2 text-sm">
                <input type="checkbox" :checked="selectedMergeIds.includes(candidate.id)" @change="onMergeCandidateToggle(candidate.id, $event)" />
                <span class="min-w-0 flex-1 truncate">{{ candidate.name }}</span>
                <span class="text-xs text-muted-foreground">{{ t('author.detail.merge.bookCount', { count: candidate.bookCount }) }}</span>
              </label>
            </div>

            <div v-if="selectedMergeIds.length > 0" class="text-xs text-muted-foreground">
              {{ t('author.detail.merge.selectedSummary', { count: selectedMergeIds.length, books: selectedMergeBookCount }) }}
            </div>

            <div class="flex items-center justify-end">
              <button
                :disabled="merging || selectedMergeIds.length === 0"
                class="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
                @click="promptRunMerge"
              >
                {{ merging ? t('author.detail.merge.merging') : t('author.detail.merge.mergeSelected') }}
              </button>
            </div>
          </div>
        </section>

        <section class="mt-4 rounded-lg border border-border/70 bg-card/60 p-3">
          <div class="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <h2 class="text-sm font-semibold text-foreground">{{ hasPenNames && author ? author.name : t('author.detail.books.heading') }}</h2>
            <div class="w-full space-y-2 sm:hidden">
              <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                <div class="flex min-w-0 items-center">
                  <SingleSortControl
                    :field="sort"
                    :dir="order"
                    :fields="BOOK_SORT_FIELDS"
                    :labels="bookSortLabels"
                    default-field="addedAt"
                    default-dir="desc"
                    @change="handleBookSort"
                  />
                </div>

                <button
                  data-testid="author-collapse-series-toggle-mobile"
                  class="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                  :class="
                    collapseSeries
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                  "
                  :aria-label="collapseToggleLabel"
                  :aria-pressed="collapseSeries"
                  :title="collapseToggleLabel"
                  @click="handleToggleCollapse"
                >
                  <Layers :size="14" />
                </button>

                <div class="flex items-center rounded-md border border-input bg-background">
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-l-md transition-colors"
                    :class="
                      authorBooksViewMode === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    "
                    @click="authorBooksViewMode = 'grid'"
                  >
                    <LayoutGrid :size="14" />
                  </button>
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-r-md transition-colors"
                    :class="
                      authorBooksViewMode === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    "
                    @click="authorBooksViewMode = 'list'"
                  >
                    <List :size="14" />
                  </button>
                </div>
              </div>

              <div class="flex">
                <LibraryMenuButton
                  :library-id="libraryId"
                  :libraries="libraries"
                  :all-label="t('author.detail.books.allLibraries')"
                  @update:library-id="handleLibraryChange"
                />
              </div>
            </div>

            <div class="hidden flex-wrap items-center gap-2 sm:flex">
              <SingleSortControl
                :field="sort"
                :dir="order"
                :fields="BOOK_SORT_FIELDS"
                :labels="bookSortLabels"
                default-field="addedAt"
                default-dir="desc"
                @change="handleBookSort"
              />
              <LibraryMenuButton
                :library-id="libraryId"
                :libraries="libraries"
                :all-label="t('author.detail.books.allLibraries')"
                @update:library-id="handleLibraryChange"
              />

              <button
                data-testid="author-collapse-series-toggle"
                class="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                :class="
                  collapseSeries
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                "
                :aria-label="collapseToggleLabel"
                :aria-pressed="collapseSeries"
                :title="collapseToggleLabel"
                @click="handleToggleCollapse"
              >
                <Layers :size="14" />
              </button>

              <div class="flex items-center rounded-md border border-input bg-background">
                <button
                  class="flex h-8 w-8 items-center justify-center rounded-l-md transition-colors"
                  :class="
                    authorBooksViewMode === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  "
                  @click="authorBooksViewMode = 'grid'"
                >
                  <LayoutGrid :size="14" />
                </button>
                <button
                  class="flex h-8 w-8 items-center justify-center rounded-r-md transition-colors"
                  :class="
                    authorBooksViewMode === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  "
                  @click="authorBooksViewMode = 'list'"
                >
                  <List :size="14" />
                </button>
              </div>
            </div>
          </div>

          <div v-if="booksError" class="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {{ booksError }}
          </div>

          <p v-if="!loadingBooks && books.length === 0 && hasPenNames" class="text-xs text-muted-foreground">
            {{ t('author.detail.penNameSection.noOwnBooks', { name: author?.name ?? '' }) }}
          </p>
          <div v-else-if="!loadingBooks && books.length === 0" class="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p class="text-sm font-medium text-foreground">{{ t('author.detail.books.empty.title') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('author.detail.books.empty.hint') }}</p>
          </div>

          <VirtualBookGrid
            v-if="authorBooksViewMode === 'grid' && books.length > 0"
            :books="books"
            :cover-size="authorBookCoverSize"
            :grid-gap="authorBookGridGap"
            :virtualized="false"
            @action="handleBookAction"
            @update:book="handleBookUpdate"
          />

          <div v-if="authorBooksViewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
            <BookListRow v-for="book in books" :key="book.id" :book="book" @action="handleBookAction(book, $event)" />
          </div>

          <div ref="sentinel" class="mt-4 flex h-8 items-center justify-center">
            <span v-if="loadingBooks" class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
          </div>

          <AuthorPenNameBooks
            v-for="penName in names.penNames"
            :key="penName.id"
            :pen-name="penName"
            :view-mode="authorBooksViewMode"
            :cover-size="authorBookCoverSize"
            :grid-gap="authorBookGridGap"
            :sort="sort"
            :order="order"
            :library-id="libraryId"
            :collapse-series="collapseSeries"
            @action="handleBookAction"
          />
        </section>
      </template>
    </main>

    <AuthorConfirmDialog
      :open="confirmDeleteOpen"
      :title="t('author.detail.deleteDialog.title')"
      :description="t('author.detail.deleteDialog.description')"
      :confirm-label="t('common.delete')"
      :loading="deleting"
      destructive
      @confirm="runDelete"
      @cancel="confirmDeleteOpen = false"
    />

    <AuthorConfirmDialog
      :open="confirmMergeOpen"
      :title="mergeDialogTitle"
      :description="mergeDialogDescription"
      :confirm-label="t('author.detail.merge.confirmLabel')"
      :loading="merging"
      @confirm="runMerge"
      @cancel="confirmMergeOpen = false"
    />

    <AuthorPenNameChooser
      :open="chooserOpen"
      :pen-name="author?.name ?? ''"
      :people="names.penNameOf"
      @choose="handleChoosePenNameOwner"
      @cancel="handleCancelPenNameChooser"
    />

    <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />
    <DeleteBookDialog
      :open="deleteBookId !== null"
      :deleting="deletingBook"
      :editions="deleteEditions"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>
