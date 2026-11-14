import type { Plugin } from 'vite'

/**
 * Fork only. Lets the interface text size setting reach text sized in pixels.
 *
 * The setting scales rem-sized text through the root font size, but much of the interface sets its
 * text in pixels (`text-[11px]`), which a root font size cannot reach. Every pixel `font-size` in the
 * app's own CSS is rewritten to multiply by `--ui-text-scale`, which is unset (so 1) unless a larger
 * size is picked. With the default size the result is the same as before.
 */
const PX_FONT_SIZE = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g

export function scalePxFontSizes(css: string): string {
  return css.replace(PX_FONT_SIZE, (match, size: string) => (Number(size) === 0 ? match : `font-size:calc(${size}px * var(--ui-text-scale, 1))`))
}

export function uiTextScalePlugin(): Plugin {
  return {
    name: 'bookorbit-ui-text-scale',
    enforce: 'post',
    transform: {
      filter: { id: { include: [/\.css(?:\?.*)?$/, /[?&]type=style/], exclude: [/node_modules/] } },
      handler(code) {
        if (!code.includes('font-size')) return null
        return { code: scalePxFontSizes(code), map: null }
      },
    },
    // A production build turns CSS into assets without passing it through the transform above, so the
    // finished stylesheets are rewritten here too.
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset' || !output.fileName.endsWith('.css')) continue
        const source = typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source)
        if (source.includes('font-size')) output.source = scalePxFontSizes(source)
      }
    },
  }
}
