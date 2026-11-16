// Categories come from the style tokens (--s1..--s3, --s0 for neutral). The last two slots stay
// hex until they get a token; they only show up with more than 3 series. Fixed order, never
// reordered or cycled per page.
export const CHART_COLORS = [
  'var(--s1)',
  'var(--s2)',
  'var(--s3)',
  '#e87ba4', // magenta
  '#008300', // green
] as const

// Neutral for "other"/unknown categories; not part of the categorical set.
export const CHART_NEUTRAL = 'var(--s0)'

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_NEUTRAL
}
