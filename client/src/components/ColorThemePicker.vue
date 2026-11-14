<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { COLOR_THEME_IDS, colorThemesForStyle, type ColorTheme, type ColorThemeStyle } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'

/** Fork. The themes of one color-theme style (Solid or Ombre), shown under the Style control while it is picked. */
const props = defineProps<{
  group: ColorThemeStyle
}>()

const { t } = useI18n()
const themeStore = useThemeStore()

const themes = computed(() => colorThemesForStyle(props.group))
const selectedLabel = computed(() => labelOf(themeStore.colorTheme))

function labelOf(id: ColorTheme): string {
  return t(`settings.appearance.theme.colorTheme.themes.${id}`)
}

function isSelected(id: ColorTheme): boolean {
  return themeStore.colorTheme === id
}

function selectTheme(event: Event) {
  const id = (event.currentTarget as HTMLElement | null)?.dataset.theme
  if (id && (COLOR_THEME_IDS as readonly string[]).includes(id)) themeStore.setColorTheme(id as ColorTheme)
}
</script>

<template>
  <div class="w-full space-y-2" :data-testid="`color-theme-group-${group}`">
    <!-- Each tile carries its theme, so it shows that theme's real ground, button and pill colours in the current mode. -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
      <button
        v-for="id in themes"
        :key="id"
        type="button"
        :data-theme="id"
        :data-color-theme="id"
        class="color-theme-tile flex min-h-11 flex-col gap-1.5 rounded-md p-2 text-start outline-offset-2 transition-[outline-color] focus-visible:ring-2 focus-visible:ring-ring"
        :class="isSelected(id) ? 'outline-2 outline-primary' : 'outline-2 outline-transparent hover:outline-border'"
        :aria-pressed="isSelected(id)"
        @click="selectTheme"
      >
        <span class="flex items-center gap-1.5">
          <span class="color-theme-tile-primary h-2 w-6 shrink-0 rounded-full" aria-hidden="true" />
          <span class="truncate text-xs font-medium">{{ labelOf(id) }}</span>
        </span>
        <span class="flex gap-1" aria-hidden="true">
          <span class="color-theme-tile-wait h-2.5 w-4 rounded-full" />
          <span class="color-theme-tile-progress h-2.5 w-4 rounded-full" />
          <span class="color-theme-tile-done h-2.5 w-4 rounded-full" />
          <span class="color-theme-tile-fail h-2.5 w-4 rounded-full" />
        </span>
      </button>
    </div>
    <p class="text-xs text-muted-foreground" aria-live="polite">{{ selectedLabel }}</p>
  </div>
</template>
