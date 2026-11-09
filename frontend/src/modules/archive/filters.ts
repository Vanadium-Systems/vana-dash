import { FILTER_FILE_TYPES } from '@/shared/lib/file-type'

export type TypeFilter = (typeof FILTER_FILE_TYPES)[number]
export const MODIFIED_RANGES = ['today', '7d', '30d', '90d'] as const
export type ModifiedRange = (typeof MODIFIED_RANGES)[number]

export const isTypeFilter = (value: string): value is TypeFilter => (FILTER_FILE_TYPES as readonly string[]).includes(value)
export const isModifiedRange = (value: string): value is ModifiedRange => (MODIFIED_RANGES as readonly string[]).includes(value)

/** The `modifiedAfter` the server gets for a range: midnight of the first day, local time. */
export function modifiedAfterIso(range: ModifiedRange, now: Date = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range !== 'today') start.setDate(start.getDate() - Number.parseInt(range, 10))
  return start.toISOString()
}
