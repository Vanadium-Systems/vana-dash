import { extendTailwindMerge } from 'tailwind-merge'
import { intlTag } from './format'

export type ClassValue =
  | ClassValue[]
  | Record<string, unknown>
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined

function toVal(mix: ClassValue): string {
  if (typeof mix === 'string' || typeof mix === 'number') return String(mix)
  if (!mix || typeof mix !== 'object') return ''
  const parts: string[] = []
  if (Array.isArray(mix)) {
    for (const item of mix) {
      const val = item && toVal(item)
      if (val) parts.push(val)
    }
  } else {
    for (const [k, v] of Object.entries(mix)) {
      if (v) parts.push(k)
    }
  }
  return parts.join(' ')
}

export function clsx(...inputs: ClassValue[]): string {
  const parts: string[] = []
  for (const input of inputs) {
    const val = input && toVal(input)
    if (val) parts.push(val)
  }
  return parts.join(' ')
}

type ConfigSchema = Record<string, Record<string, ClassValue>>
type ConfigVariants<T extends ConfigSchema> = {
  [Variant in keyof T]?: keyof T[Variant] | null | undefined
}
type Config<T extends ConfigSchema> = {
  variants?: T
  defaultVariants?: ConfigVariants<T>
  compoundVariants?: Array<
    ConfigVariants<T> & {
      class?: ClassValue
      className?: ClassValue
    }
  >
}

export type VariantProps<Component extends (...args: never[]) => unknown> = Omit<
  NonNullable<Parameters<Component>[0]>,
  'class' | 'className'
>

export function cva<T extends ConfigSchema>(base?: ClassValue, config?: Config<T>) {
  return (props?: ConfigVariants<T> & { class?: ClassValue; className?: ClassValue }): string => {
    if (!config?.variants) return clsx(base, props?.class, props?.className)
    const { variants, defaultVariants, compoundVariants } = config
    const resolved: Record<string, unknown> = { ...defaultVariants }
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v !== undefined && k !== 'class' && k !== 'className') resolved[k] = v
      }
    }
    const variantClasses: ClassValue[] = []
    for (const [variant, map] of Object.entries(variants)) {
      const selected = resolved[variant]
      if (selected != null && typeof selected === 'string') {
        variantClasses.push(map[selected])
      }
    }
    if (compoundVariants) {
      for (const cv of compoundVariants) {
        const matches = Object.entries(cv).every(([k, v]) => {
          if (k === 'class' || k === 'className') return true
          return resolved[k] === v
        })
        if (matches) variantClasses.push(cv.class, cv.className)
      }
    }
    return clsx(base, variantClasses, props?.class, props?.className)
  }
}

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

// One formatter per language: formatBytes runs once per row in the archive and upload lists.
const byteFormatters = new Map<string, Intl.NumberFormat>()
function oneDecimal(): Intl.NumberFormat {
  const tag = intlTag()
  let formatter = byteFormatters.get(tag)
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    byteFormatters.set(tag, formatter)
  }
  return formatter
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
  return `${oneDecimal().format(value)} ${units[i]}`
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
