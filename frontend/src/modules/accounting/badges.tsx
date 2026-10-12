import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import type { AnafStatus, PaymentStatus } from '@/shared/lib/types'
import { intlTag } from '@/shared/lib/format'

const ANAF_STYLES: Record<AnafStatus, { label: string; tone: StateTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending: { label: 'Trimisă ANAF', tone: 'warning' },
  validated: { label: 'Validată', tone: 'success' },
  rejected: { label: 'Respinsă', tone: 'critical' },
}

export function AnafStatusBadge({ status }: { status: AnafStatus | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>
  const style = ANAF_STYLES[status]
  return <StatePill tone={style.tone}>{style.label}</StatePill>
}

const PAYMENT_STYLES: Record<PaymentStatus, { label: string; tone: StateTone }> = {
  unpaid: { label: 'Neplătită', tone: 'warning' },
  partial: { label: 'Parțial', tone: 'warning' },
  paid: { label: 'Plătită', tone: 'success' },
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const style = PAYMENT_STYLES[status]
  return <StatePill tone={style.tone}>{style.label}</StatePill>
}

export function formatMoney(amount: string | number, currency: string): string {
  return `${Number(amount).toLocaleString(intlTag(), { minimumFractionDigits: 2 })} ${currency}`
}

export function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(intlTag()) : '—'
}
