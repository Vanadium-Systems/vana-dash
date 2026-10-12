import type { StateTone } from '@/shared/components/ui/state-pill'
import type { EmailSendStatus } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// Sursă unică pt. label/culoare de status (SentTab + BulkSendTab) — status-ul unui send trece
// prin 'sent' → 'delivered' (sau bounced/complained/delayed), actualizat de webhook-ul Resend
// (nu doar 'sent' vs 'failed' binar — un check `=== 'sent'` arăta greșit "Eșuat" pe orice email
// deja livrat, bug raportat live de Stefan, 2026-08-11).
export const STATUS_LABEL: Record<EmailSendStatus, string> = {
  sent: t('email:status.sent'),
  delivered: t('email:status.delivered'),
  bounced: t('email:status.bounced'),
  complained: t('email:folders.spam'),
  delayed: t('email:status.delayed'),
  failed: t('email:status.failed'),
}

export const STATUS_TONE: Record<EmailSendStatus, StateTone> = {
  sent: 'neutral',
  delivered: 'success',
  bounced: 'critical',
  complained: 'critical',
  delayed: 'warning',
  failed: 'critical',
}

// Singurele stări care înseamnă o problemă reală — restul (sent/delivered/delayed) sunt
// variante de "a ajuns sau e pe drum", nu eșecuri.
const FAILURE_STATUSES: ReadonlySet<EmailSendStatus> = new Set(['failed', 'bounced', 'complained'])

export function isFailureStatus(status: EmailSendStatus): boolean {
  return FAILURE_STATUSES.has(status)
}
