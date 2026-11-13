export const RESOLVED_THEME_IDS = ["light", "dark"] as const;
export type ResolvedTheme = (typeof RESOLVED_THEME_IDS)[number];

export const THEME_IDS = [...RESOLVED_THEME_IDS, "system"] as const;
export type Theme = (typeof THEME_IDS)[number];

export const ACCENT_IDS = [
  "grey",
  "scarlet",
  "vermilion",
  "rose",
  "copper",
  "orange",
  "chartreuse",
  "marigold",
  "wasabi",
  "amber",
  "malachite",
  "yellow",
  "viridian",
  "turquoise",
  "lime",
  "green",
  "acid-green",
  "emerald",
  "teal",
  "electric-blue",
  "cyan",
  "jade",
  "ultramarine",
  "iris",
  "purple",
  "blue",
  "indigo",
  "violet",
  "amethyst",
  "fuchsia",
  "raspberry",
  "pink",
  "white",
  "rosewater",
  "salmon",
  "coral",
  "sand",
  "peach",
  "pear",
  "flax",
  "sprout",
  "butter",
  "aloe",
  "lemon",
  "foam",
  "aqua",
  "celadon",
  "sage",
  "pistachio",
  "mint",
  "seafoam",
  "baby-blue",
  "powder",
  "sea-glass",
  "bluebell",
  "cornflower",
  "thistle",
  "periwinkle",
  "wisteria",
  "lavender",
  "mauve",
  "orchid",
  "rose-quartz",
  "blush",
] as const;
export type Accent = (typeof ACCENT_IDS)[number];

export const RADIUS_IDS = ["sharp", "default", "rounded", "pill"] as const;
export type Radius = (typeof RADIUS_IDS)[number];

export const BACKGROUND_IDS = [
  "none",
  "dots",
  "cross",
  "millimeter",
  "blueprint",
  "brushed",
  "scanlines",
  "carbon",
  "vinyl",
  "perforated",
  "aurora",
  "horizon",
  "glow",
  "mesh",
  "elevation",
  "prism",
  "spectrum",
  "spectrum-x",
  "spectrum-plus",
  "eclipse",
] as const;
export type Background = (typeof BACKGROUND_IDS)[number];

/** Shell surface translucency, in percent. The floor keeps the sidebar and header
 *  readable over the busiest background patterns. */
export const SURFACE_OPACITY_MIN = 80;
export const SURFACE_OPACITY_MAX = 100;
export const SURFACE_OPACITY_DEFAULT = 92;

/** Top glow reach, in percent of the active style's own reach. 0 turns the glow off. */
export const GLOW_REACH_MIN = 0;
export const GLOW_REACH_MAX = 200;
export const GLOW_REACH_DEFAULT = 50;

/** A whole visual style: surfaces, type, shell material and component accents. Independent of
 *  mode, accent, radius and background, which keep their values when the style changes. */
export const STYLE_IDS = ["bookorbit", "nostalgia"] as const;
export type Style = (typeof STYLE_IDS)[number];
export const DEFAULT_STYLE: Style = "nostalgia";

/** Neutral ground palettes. Only styles that declare a surface palette control read them. */
export const SURFACE_PALETTE_IDS = [
  // Greys, darkest first, then tinted grounds.
  "onyx",
  "carbon",
  "neutral",
  "zinc",
  "iron",
  "steel",
  "ash",
  "smoke",
  "charcoal",
  "slate",
  "midnight-blue",
  "ocean",
  "pine",
  "olive",
  "stone",
  "sepia",
  "crimson",
  "plum",
] as const;
export type SurfacePalette = (typeof SURFACE_PALETTE_IDS)[number];
export const DEFAULT_SURFACE_PALETTE: SurfacePalette = "steel";

/** Fork only. Whole-app color themes that repaint surfaces, buttons, links, icons and pills on top of
 *  any style. "none" leaves the style and accent as they are. */
export const COLOR_THEME_IDS = [
  "none",
  "velvet-night",
  "neon-city",
  "graphite-citrus",
  "cotton-candy",
  "tropical-punch",
  "synthwave",
  "ocean-sunset",
  "blueberry-lemon",
  "arctic-aurora",
  "peach-fuzz",
  "royal-jewel",
  "bubblegum-pop",
  "noir-red",
] as const;
export type ColorTheme = (typeof COLOR_THEME_IDS)[number];
export const DEFAULT_COLOR_THEME: ColorTheme = "none";

export interface ThemePreferences {
  theme: Theme;
  accent: Accent;
  radius: Radius;
  background: Background;
  brightness: number;
  /** Optional so a client that sends it stays valid against a server that predates it. */
  surfaceOpacity?: number;
  /** Optional for the same reason; absent keeps the client's local or default style. */
  style?: Style;
  /** Optional for the same reason; absent means steel. */
  surfacePalette?: SurfacePalette;
  /** How far the accent glow reaches down the page, as a percent of the style's own reach; 0 turns it off.
   *  Optional for the same reason; absent means GLOW_REACH_DEFAULT. */
  glowReach?: number;
  /** Optional for the same reason; absent means "none". */
  colorTheme?: ColorTheme;
}
