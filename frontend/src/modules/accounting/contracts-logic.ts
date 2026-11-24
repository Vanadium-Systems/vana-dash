import type { StateTone } from '@/shared/components/ui/state-pill'
import { companyTimeZone, formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import type { ContractStatus } from './contracts-api'

export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: companyTimeZone() }).format(new Date())

export const statusLabel = (status: ContractStatus): string => t(`accounting:contracts.statuses.${status}`)

export const STATUS_TONE: Record<ContractStatus, StateTone> = {
  draft: 'neutral',
  to_sign: 'warning',
  signed: 'success',
  expired: 'neutral',
  terminated: 'neutral',
}

// Mirrors the backend's transition table; the backend still has the last word.
export const NEXT_STATUSES: Record<ContractStatus, ContractStatus[]> = {
  draft: ['to_sign', 'signed', 'terminated'],
  to_sign: ['draft', 'signed', 'terminated'],
  signed: ['expired', 'terminated'],
  expired: ['signed', 'terminated'],
  terminated: [],
}

export const NOTICE_WINDOW_DAYS = 30

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

export type NoticeState = { kind: 'overdue' } | { kind: 'soon'; days: number }

/** Only a running contract has a notice to worry about: a terminated one is history. */
export function noticeState(status: ContractStatus, noticeDeadline: string | null, today: string): NoticeState | null {
  if (status !== 'signed' || !noticeDeadline) return null
  const days = daysBetween(today, noticeDeadline)
  if (days < 0) return { kind: 'overdue' }
  return days <= NOTICE_WINDOW_DAYS ? { kind: 'soon', days } : null
}

/** "preaviz în 12 zile" / "preaviz depășit", or null when there is nothing to warn about. */
export function noticeText(row: { status: ContractStatus; noticeDeadline: string | null }): string | null {
  const notice = noticeState(row.status, row.noticeDeadline, todayIso())
  if (!notice) return null
  if (notice.kind === 'overdue') return t('accounting:contracts.registry.noticeOverdue')
  return notice.days === 0 ? t('accounting:contracts.registry.noticeToday') : t('accounting:contracts.registry.noticeIn', { count: notice.days, n: formatNumber(notice.days) })
}

export interface TermsForm {
  startsOn: string
  endsOn: string
  autoRenew: boolean
  renewalMonths: string
  noticeDays: string
}

export const EMPTY_TERMS: TermsForm = { startsOn: '', endsOn: '', autoRenew: false, renewalMonths: '', noticeDays: '' }

export type TermsErrors = Partial<Record<'endsOn' | 'renewalMonths' | 'noticeDays', TKey>>

function wholeNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null
}

/** The backend's rules for the terms (renewal needs months, notice needs an end, end after start). */
export function validateTerms(form: TermsForm): TermsErrors {
  const errors: TermsErrors = {}
  if (form.startsOn && form.endsOn && form.endsOn < form.startsOn) errors.endsOn = 'accounting:contracts.terms.errors.endBeforeStart'
  if (form.autoRenew) {
    const months = wholeNumber(form.renewalMonths)
    if (months === null || months < 1 || months > 120) errors.renewalMonths = 'accounting:contracts.terms.errors.renewalMonths'
  }
  if (form.noticeDays.trim()) {
    const days = wholeNumber(form.noticeDays)
    if (days === null || days < 1 || days > 730) errors.noticeDays = 'accounting:contracts.terms.errors.noticeDays'
    else if (!form.endsOn) errors.noticeDays = 'accounting:contracts.terms.errors.noticeNeedsEnd'
  }
  return errors
}

export function termsBody(form: TermsForm) {
  return {
    startsOn: form.startsOn || null,
    endsOn: form.endsOn || null,
    autoRenew: form.autoRenew,
    renewalMonths: form.autoRenew ? wholeNumber(form.renewalMonths) : null,
    noticeDays: form.noticeDays.trim() ? wholeNumber(form.noticeDays) : null,
  }
}

export function termsFormOf(contract: { startsOn: string | null; endsOn: string | null; autoRenew: boolean; renewalMonths: number | null; noticeDays: number | null }): TermsForm {
  return {
    startsOn: contract.startsOn ?? '',
    endsOn: contract.endsOn ?? '',
    autoRenew: contract.autoRenew,
    renewalMonths: contract.renewalMonths ? String(contract.renewalMonths) : '',
    noticeDays: contract.noticeDays ? String(contract.noticeDays) : '',
  }
}
