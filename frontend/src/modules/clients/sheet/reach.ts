import type { ProspectSheet, SheetContactPoint } from './types'

/** The first number or address that may be used: not of a person who objected, not dead, not unsubscribed. */
export function firstReachable(sheet: ProspectSheet, kind: 'phone' | 'email'): SheetContactPoint | undefined {
  const objecting = new Set(sheet.people.filter((person) => person.doNotContact).map((person) => person.id))
  return [...sheet.contactPoints]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .find((point) => point.kind === kind && !(point.personId && objecting.has(point.personId)) && (kind === 'phone' ? point.status !== 'invalid' : point.status === 'ok'))
}
