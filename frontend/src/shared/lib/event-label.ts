import type { CalendarOccurrence } from '@/shared/lib/types'

/** Titlul pe grilă, cu numele omului când evenimentul nu e din calendarul tău — calendarele
 *  partajate nu se deosebesc doar prin culoare (regula de accesibilitate din CLAUDE.md). */
export function eventLabel(occ: CalendarOccurrence): string {
  return occ.access && occ.access !== 'owner' && occ.ownerName ? `${occ.title} · ${occ.ownerName}` : occ.title
}

/** Mutare prin tragere și editare: doar în calendarul tău sau într-unul primit cu „editează". */
export function canEditOccurrence(occ: CalendarOccurrence): boolean {
  return occ.kind === 'event' && (occ.access === 'owner' || occ.access === 'edit')
}
