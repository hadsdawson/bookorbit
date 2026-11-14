<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import { COLOR_THEME_IDS, type ColorTheme } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

const THEMES = COLOR_THEME_IDS.filter((id) => id !== 'none')
const SOLID_THEMES = THEMES.filter((id) => !id.startsWith('ombre-'))
const OMBRE_THEMES = THEMES.filter((id) => id.startsWith('ombre-'))
const GROUPS = [
  { key: 'solid', themes: SOLID_THEMES },
  { key: 'ombre', themes: OMBRE_THEMES },
] as const

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
  <div class="w-full space-y-2">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
      <button
        type="button"
        data-theme="none"
        class="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 text-xs font-medium text-muted-foreground outline-offset-2 transition-[outline-color] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        :class="isSelected('none') ? 'outline-2 outline-primary' : 'outline-2 outline-transparent'"
        :aria-pressed="isSelected('none')"
        @click="selectTheme"
      >
        <Check v-if="isSelected('none')" :size="12" aria-hidden="true" />
        {{ labelOf('none') }}
      </button>
    </div>
    <!-- Each tile carries its theme, so it shows that theme's real ground, button and pill colours in the current mode. -->
    <section v-for="group in GROUPS" :key="group.key" class="space-y-1.5" :data-testid="`color-theme-group-${group.key}`">
      <h3 class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {{ t(`settings.appearance.theme.colorTheme.groups.${group.key}`) }}
      </h3>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
        <button
          v-for="id in group.themes"
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
    </section>
    <p class="text-xs text-muted-foreground" aria-live="polite">{{ selectedLabel }}</p>
  </div>
</template>
