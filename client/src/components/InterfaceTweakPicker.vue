<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BOX_DEPTH_IDS, BOX_OUTLINE_IDS, INTERFACE_FONT_IDS, INTERFACE_TEXT_SIZE_IDS } from '@bookorbit/types'
import type { BoxDepth, BoxOutline, InterfaceFont, InterfaceTextSize } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'

export type InterfaceTweakKind = 'boxDepth' | 'boxOutline' | 'interfaceFont' | 'interfaceTextSize'

const props = defineProps<{ kind: InterfaceTweakKind }>()

const { t } = useI18n()
const themeStore = useThemeStore()

/** How each font option names itself, so its button shows the face it picks. */
const FONT_PREVIEW: Record<InterfaceFont, string> = {
  default: 'var(--app-font-sans)',
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  atkinson: "'Atkinson Hyperlegible Next Variable', sans-serif",
  lexend: "'Lexend Variable', sans-serif",
  nunito: "'Nunito Variable', sans-serif",
  'source-serif': "'Source Serif 4 Variable', serif",
}

const options = computed<readonly string[]>(() => {
  if (props.kind === 'boxDepth') return BOX_DEPTH_IDS
  if (props.kind === 'boxOutline') return BOX_OUTLINE_IDS
  if (props.kind === 'interfaceFont') return INTERFACE_FONT_IDS
  return INTERFACE_TEXT_SIZE_IDS
})

const current = computed<string>(() => themeStore[props.kind])

function labelOf(id: string): string {
  return t(`settings.appearance.interface.${props.kind}.options.${id}`)
}

function fontOf(id: string): string | undefined {
  return props.kind === 'interfaceFont' ? FONT_PREVIEW[id as InterfaceFont] : undefined
}

function select(id: string) {
  if (props.kind === 'boxDepth') themeStore.setBoxDepth(id as BoxDepth)
  else if (props.kind === 'boxOutline') themeStore.setBoxOutline(id as BoxOutline)
  else if (props.kind === 'interfaceFont') themeStore.setInterfaceFont(id as InterfaceFont)
  else themeStore.setInterfaceTextSize(id as InterfaceTextSize)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/50 p-1" role="group" :data-testid="`tweak-${kind}`">
    <button
      v-for="id in options"
      :key="id"
      type="button"
      class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="current === id ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
      :style="{ fontFamily: fontOf(id) }"
      :aria-pressed="current === id"
      :data-option="id"
      @click="select(id)"
    >
      {{ labelOf(id) }}
    </button>
  </div>
</template>
