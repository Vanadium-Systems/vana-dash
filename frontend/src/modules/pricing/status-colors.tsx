import type { StatusColorToken } from '@/shared/lib/types'

// Statusurile de prospect au culori alese de Stefan: sunt categorii, nu stări, deci nu intră în
// paleta de UI (DESIGN.md). Culoarea apare doar ca punct lângă eticheta scrisă; pastila rămâne
// neutră. Mirror STATUS_COLOR_TOKENS (shared/lib/types.ts) — un token nou acolo cere o intrare aici.
export const STATUS_DOT_COLOR: Record<StatusColorToken, string> = {
  slate: '#64748b',
  gray: '#6b7280',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  emerald: '#10b981',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  purple: '#a855f7',
  indigo: '#6366f1',
}

export function StatusDot({ token }: { token: StatusColorToken }) {
  return <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STATUS_DOT_COLOR[token] }} />
}
