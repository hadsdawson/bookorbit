import { useMediaQuery } from '@vueuse/core'
import { getActivePinia } from 'pinia'
import { computed, type ComputedRef } from 'vue'

import { useThemeStore } from '@/stores/theme'

/**
 * Fork only. The interface text size as a number (1 at the default size), and a pixel length that
 * grows with it. Layout set in pixels (a resizable column, a sidebar) uses `scaledPx` so it keeps room
 * for text at a larger size, and divides pointer travel by `uiTextScale()` while it is resized.
 */
/** On a phone-sized screen the largest size steps down one, matching interface-tweaks.css. */
export const NARROW_SCREEN_QUERY = '(max-width: 639px)'
export const NARROW_SCREEN_MAX_SCALE = 1.1

export function uiTextScale(): number {
  if (typeof document === 'undefined') return 1
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-text-scale'))
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function scaledPx(px: number): string {
  return `calc(${px}px * var(--ui-text-scale, 1))`
}

/**
 * The text scale as a reactive number, for virtual lists that size their rows in pixels: a row
 * estimate multiplied by it keeps rows from overlapping when the text is larger.
 */
export function useUiTextScale(): ComputedRef<number> {
  // A component mounted on its own (in a test) has no store and draws at the default size.
  if (!getActivePinia()) return computed(() => 1)
  const themeStore = useThemeStore()
  const narrow = useMediaQuery(NARROW_SCREEN_QUERY)
  return computed(() =>
    narrow.value ? Math.min(themeStore.appliedInterfaceTextScale, NARROW_SCREEN_MAX_SCALE) : themeStore.appliedInterfaceTextScale,
  )
}
