import { CalendarClock, Check, Copy, Mail, Phone, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { ProspectSheet } from './types'

export function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
  return (
    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {letters}
    </span>
  )
}

function CopyCui({ cif }: { cif: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={t('clients:sheet.header.copyCui')}
      aria-label={t('clients:sheet.header.copyCui')}
      className="inline-flex items-center gap-1 rounded-sm tabular-nums hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() =>
        void navigator.clipboard?.writeText(cif).then(
          () => {
            setCopied(true)
            toast.success(t('clients:sheet.header.cuiCopied'))
            window.setTimeout(() => setCopied(false), 1500)
          },
          () => toast.error(t('messages:actions.copyFailed')),
        )
      }
    >
      {t('clients:sheet.header.cui', { cif })}
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  )
}

interface SheetHeaderProps {
  sheet: ProspectSheet
  canClaim: boolean
  canCall: boolean
  canWrite: boolean
  onCall: () => void
  onWrite: () => void
  onSchedule: () => void
  onClaim: () => void
  onCollaborators: () => void
  menu: ReactNode
}

export function SheetHeader({ sheet, canClaim, canCall, canWrite, onCall, onWrite, onSchedule, onClaim, onCollaborators, menu }: SheetHeaderProps) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="truncate text-xl font-semibold">{sheet.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {sheet.cif ? <CopyCui cif={sheet.cif} /> : <span>{t('clients:sheet.header.noCui')}</span>}
            {sheet.score !== null ? (
              <Badge variant="secondary" title={t('clients:sheet.header.score')}>
                {sheet.priority} · <span className="tabular-nums">{formatNumber(Number(sheet.score))}</span>
              </Badge>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={!canCall} title={canCall ? undefined : t('clients:sheet.header.noPhone')} onClick={onCall}>
            <Phone aria-hidden="true" /> {t('clients:sheet.header.call')}
          </Button>
          <Button type="button" variant="outline" disabled={!canWrite} title={canWrite ? undefined : t('clients:sheet.header.noEmail')} onClick={onWrite}>
            <Mail aria-hidden="true" /> {t('clients:sheet.header.write')}
          </Button>
          {sheet.canEdit ? (
            <Button type="button" onClick={onSchedule}>
              <CalendarClock aria-hidden="true" /> {t('clients:sheet.header.schedule')}
            </Button>
          ) : null}
          {menu}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {sheet.assignedUserId ? (
          <span className="flex min-w-0 items-center gap-2">
            <Initials name={sheet.ownerName ?? '?'} />
            <span className="min-w-0 truncate font-medium">{sheet.ownerName}</span>
            {sheet.claimedAt ? <span className="shrink-0 text-xs text-muted-foreground">{t('clients:sheet.header.since', { date: formatDate(sheet.claimedAt) })}</span> : null}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">{t('clients:sheet.header.free')}</span>
            {canClaim ? (
              <Button type="button" size="sm" variant="outline" onClick={onClaim}>
                {t('clients:sheet.team.claim')}
              </Button>
            ) : null}
          </span>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCollaborators}>
          <Users aria-hidden="true" />
          {sheet.collaborators.length > 0 ? t('clients:sheet.header.collaborators', { count: sheet.collaborators.length }) : t('clients:sheet.header.noCollaborators')}
        </Button>
      </div>
    </header>
  )
}
