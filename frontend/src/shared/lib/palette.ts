export const THEME_PALETTES = ['vanadium', 'grafit', 'padure', 'chihlimbar', 'ardezie'] as const
export type ThemePalette = (typeof THEME_PALETTES)[number]

export const PALETTE_STORAGE_KEY = 'vana-dash-palette'

export interface PaletteSwatches {
  light: { bg: string; primary: string; glow: string }
  dark: { bg: string; primary: string; glow: string }
}

export const PALETTE_SWATCHES: Record<ThemePalette, PaletteSwatches> = {
  vanadium: {
    light: { bg: '#f2efe9', primary: '#0a5fd8', glow: '#088c95' },
    dark: { bg: '#070d1c', primary: '#4f95ff', glow: '#46e0de' },
  },
  grafit: {
    light: { bg: '#f4f5f7', primary: '#3a5f8f', glow: '#b7791f' },
    dark: { bg: '#0e0f11', primary: '#7aa2d6', glow: '#e0b44c' },
  },
  padure: {
    light: { bg: '#eef1ec', primary: '#1f6f4a', glow: '#a88124' },
    dark: { bg: '#0b1410', primary: '#5cc28f', glow: '#e2c15b' },
  },
  chihlimbar: {
    light: { bg: '#f5efe6', primary: '#b45309', glow: '#0e7490' },
    dark: { bg: '#15100a', primary: '#f0a03c', glow: '#4fc3d9' },
  },
  ardezie: {
    light: { bg: '#eef1f4', primary: '#2f5d7c', glow: '#0d9482' },
    dark: { bg: '#0d1217', primary: '#6fa8d0', glow: '#5fd3c0' },
  },
}

export function isThemePalette(value: unknown): value is ThemePalette {
  return typeof value === 'string' && (THEME_PALETTES as readonly string[]).includes(value)
}

/** Applied synchronously here and from the inline script in index.html before first paint. */
export function applyPalette(palette: ThemePalette) {
  const safe: ThemePalette = isThemePalette(palette) ? palette : 'vanadium'
  localStorage.setItem(PALETTE_STORAGE_KEY, safe)
  if (safe === 'vanadium') {
    delete document.documentElement.dataset.palette
  } else {
    document.documentElement.dataset.palette = safe
  }
}
