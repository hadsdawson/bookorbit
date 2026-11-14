import { describe, expect, it } from 'vitest'

import { scalePxFontSizes } from '../../../build/vite-plugin-ui-text-scale'
import { scaledPx } from '../ui-text-scale'

describe('scalePxFontSizes', () => {
  it('multiplies every pixel font size by the interface text scale', () => {
    expect(scalePxFontSizes('.text-\\[11px\\]{font-size:11px}')).toBe('.text-\\[11px\\]{font-size:calc(11px * var(--ui-text-scale, 1))}')
    expect(scalePxFontSizes('a { font-size: 12.5px; }')).toBe('a { font-size:calc(12.5px * var(--ui-text-scale, 1)); }')
  })

  it('leaves rem, keyword and zero sizes alone', () => {
    const css = '.a{font-size:.75rem}.b{font-size:inherit}.c{font-size:0px}.d{font-size:var(--text-sm)}'
    expect(scalePxFontSizes(css)).toBe(css)
  })
})

describe('scaledPx', () => {
  it('grows a pixel length with the interface text scale', () => {
    expect(scaledPx(260)).toBe('calc(260px * var(--ui-text-scale, 1))')
  })
})
