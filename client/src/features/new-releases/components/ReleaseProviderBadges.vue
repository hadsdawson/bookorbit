<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NewReleaseItem } from '@bookorbit/types'

import { createBookProviderLinks, type BookProviderLink } from '@/features/book/lib/provider-links'
import { providerIconPathSafe } from '@/features/book/lib/provider-icons'
import { getProviderColor } from '@/lib/provider-colors'
import { useProviderLinkSettings } from '@/features/book/composables/useProviderLinkSettings'

/** Fork: the sites a release was found on, as link badges, like the ones on a book request. */
const props = defineProps<{ item: NewReleaseItem }>()
const { t } = useI18n()
const failedIcons = ref(new Set<string>())
const { settings: linkSettings, loadSettings } = useProviderLinkSettings()
void loadSettings()

const links = computed<BookProviderLink[]>(() => {
  const ids = props.item.providerIds
  const found = createBookProviderLinks(
    { hardcover: ids.hardcover, audible: ids.audible, amazon: ids.amazon, google: ids.google },
    linkSettings.value,
  )
  if (props.item.isbn13) {
    found.push({
      key: 'goodreads' as BookProviderLink['key'],
      label: 'Goodreads',
      url: `https://www.goodreads.com/book/isbn/${encodeURIComponent(props.item.isbn13)}`,
      iconUrl: providerIconPathSafe('goodreads'),
      fallback: 'GR',
    })
  }
  return found
})

function badgeStyle(key: string): Record<string, string> {
  const color = getProviderColor(key)
  return { borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }
}

function handleIconError(key: string) {
  failedIcons.value = new Set([...failedIcons.value, key])
}
</script>

<template>
  <div v-if="links.length > 0" class="flex flex-wrap items-center gap-1" :aria-label="t('newReleases.item.linksLabel', { title: item.title })">
    <a
      v-for="link in links"
      :key="link.key"
      :href="link.url"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex size-6 items-center justify-center rounded-md border transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      :style="badgeStyle(link.key)"
      :title="link.label"
      :aria-label="link.label"
    >
      <img
        v-if="link.iconUrl && !failedIcons.has(link.key)"
        :src="link.iconUrl"
        alt=""
        class="size-3.5 rounded-[2px] object-contain"
        loading="lazy"
        @error="handleIconError(link.key)"
      />
      <span v-else class="text-[8px] leading-none font-bold text-foreground">{{ link.fallback }}</span>
    </a>
  </div>
</template>
