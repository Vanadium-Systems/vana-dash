import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Token-ii de înălțime (DESIGN.md) trebuie să se bată corect cu `h-8` & co. într-un className.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      h: [{ h: ['control-sm', 'control-md', 'control-lg'] }],
      w: [{ w: ['control-sm', 'control-md', 'control-lg'] }],
      'min-h': [{ 'min-h': ['control-md'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

/** Pentru căutare: fără diacritice (inclusiv ş/ţ cu sedilă din date vechi), fără majuscule. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Sumă tastată de om: „1.234,50", „1234,5", „1234.5", „-3". Virgula e zecimală; punctul e
 * zecimal când e singur, separator de mii când apare de mai multe ori sau lângă o virgulă.
 * Gol sau nevalid → NaN, ca parseFloat.
 */
export function parseRoDecimal(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input
  const raw = (input ?? '').trim().replace(/\s/g, '')
  if (!raw) return NaN
  let normalized = raw
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.')
  else if ((raw.match(/\./g) ?? []).length > 1) normalized = raw.replace(/\./g, '')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return NaN
  return Number(normalized)
}
