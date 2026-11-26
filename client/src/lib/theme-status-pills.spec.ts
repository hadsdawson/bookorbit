import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { facetChip } from '@/components/browse-header/browse-header'

const css = readFileSync(resolve(__dirname, '../assets/theme/color-themes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The selector of the status-pill rule that fills a pill in the theme's primary hue. */
function primaryPillSelector(): string {
  const rule = css
    .split('}')
    .map((block) => block.split('{')[0]!.trim())
    .find((selector) => selector.includes('.rounded-full') && selector.includes('bg-primary/'))
  if (!rule) throw new Error('primary status pill rule not found')
  return rule.replace(/\s+/g, ' ')
}

function element(className: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('button')
  el.className = className
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  document.body.appendChild(el)
  return el
}

describe('color theme status pills', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-color-theme')
  })

  it('fills a tinted status pill solid', () => {
    document.documentElement.setAttribute('data-color-theme', 'ombre-dusk')
    const pill = element('rounded-full border bg-primary/15 px-2 text-xs text-primary')
    expect(pill.matches(primaryPillSelector())).toBe(true)
  })

  it('leaves a format chip alone, picked or not, since its tint is only a pressed-state variant', () => {
    document.documentElement.setAttribute('data-color-theme', 'ombre-dusk')
    expect(element(facetChip).matches(primaryPillSelector())).toBe(false)
    expect(element(facetChip, { 'aria-pressed': 'true' }).matches(primaryPillSelector())).toBe(false)
  })
})
