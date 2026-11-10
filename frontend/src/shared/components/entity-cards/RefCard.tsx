import { CalendarDays, FileText, Lock, Mail, Receipt, StickyNote, UserRound, type LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { Money } from '@/shared/components/Money'
import { linkFor, type LinkExtra } from '@/shared/lib/entity-links'
import { companyTimeZone, formatDate, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { ChatMessageRef, RefType } from '@/shared/lib/types'
import { cn, formatBytes } from '@/shared/lib/utils'
import { ProspectCardActions, requestableProspectId } from './ProspectCardActions'

// The card of an object shared into a message: one level inside the bubble (no card in a card),
// the type's icon, the title (a link when the reader can open it) and two or three facts on one
// muted line. `denied` and `gone` are handled here, the same for every type.

export interface RefCardBodyProps {
  card: Record<string, unknown> & { title: string }
}

interface RefCardType {
  icon: LucideIcon
  /** The facts under the title. */
  Body?: ComponentType<RefCardBodyProps>
  extra?: (card: RefCardBodyProps['card']) => LinkExtra
  /** Buttons under the facts, for a card you can act on from the message. */
  Actions?: ComponentType<{ refItem: ChatMessageRef }>
  /** The card asks for access itself, so the generic "ask an administrator" link is left out. */
  asksAccess?: (refItem: ChatMessageRef) => boolean
}

const registry = new Map<RefType, RefCardType>()

export function registerRefCard(type: RefType, entry: RefCardType): void {
  registry.set(type, entry)
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

export function RefCard({
  refItem,
  onRequestAccess,
  onOpenFile,
}: {
  refItem: ChatMessageRef
  onRequestAccess?: (refItem: ChatMessageRef) => void
  onOpenFile?: (attachmentId: string) => void
}) {
  const entry = registry.get(refItem.type)
  const Icon = refItem.state === 'denied' ? Lock : (entry?.icon ?? FileText)
  const { card } = refItem
  const href = refItem.canOpen && refItem.refId ? linkFor(refItem.type, refItem.refId, entry?.extra?.(card)) : null
  const attachmentId = refItem.type === 'archive_file' ? str(card.attachmentId) : null

  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md bg-background/70 px-2 py-1.5" data-ref-type={refItem.type}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="sr-only">{t(`messages:refs.types.${refItem.type}`)}: </span>
          {href ? (
            <Link to={href} className="min-w-0 truncate text-sm font-medium underline-offset-2 hover:underline">
              {card.title || t('messages:refs.untitled')}
            </Link>
          ) : attachmentId && onOpenFile ? (
            <button
              type="button"
              onClick={() => onOpenFile(attachmentId)}
              className="min-w-0 truncate text-left text-sm font-medium underline-offset-2 hover:underline"
            >
              {card.title}
            </button>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium">{card.title || t('messages:refs.untitled')}</span>
          )}
        </div>
        {refItem.state === 'denied' ? (
          <p className="text-xs text-muted-foreground">
            {refItem.grantors ? t('messages:refs.deniedByRole') : t('messages:refs.denied')}
            {onRequestAccess && !entry?.asksAccess?.(refItem) && (!refItem.grantors || refItem.grantors.length > 0) ? (
              <>
                {' · '}
                <button type="button" className="underline underline-offset-2" onClick={() => onRequestAccess(refItem)}>
                  {t('messages:refs.requestAccess')}
                </button>
              </>
            ) : null}
          </p>
        ) : refItem.state === 'gone' ? (
          <p className="text-xs text-muted-foreground">{t('messages:refs.gone')}</p>
        ) : entry?.Body ? (
          <entry.Body card={card} />
        ) : null}
        {entry?.Actions && refItem.state !== 'gone' ? <entry.Actions refItem={refItem} /> : null}
      </div>
    </div>
  )
}

function Facts({ items, className }: { items: (string | null | undefined | false)[]; className?: string }) {
  const shown = items.filter((item): item is string => Boolean(item))
  if (shown.length === 0) return null
  return <p className={cn('truncate text-xs text-muted-foreground', className)}>{shown.join(' · ')}</p>
}

function Excerpt({ text }: { text: string | null }) {
  return text ? <p className="line-clamp-2 text-xs text-muted-foreground">{text}</p> : null
}

/** YYYY-MM-DD of an instant in the company's zone: the calendar opens on that day. */
function dayInCompanyZone(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: companyTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

registerRefCard('prospect', {
  icon: UserRound,
  Actions: ProspectCardActions,
  asksAccess: (refItem) => requestableProspectId(refItem) !== null,
  Body: ({ card }) => (
    <Facts
      items={[
        str(card.statusLabel),
        str(card.ownerName),
        str(card.lastContactAt) && t('messages:refs.lastContact', { when: formatRelativeTime(str(card.lastContactAt)!) }),
      ]}
    />
  ),
})

registerRefCard('invoice', {
  icon: Receipt,
  extra: (card) => ({ tab: card.direction === 'in' ? 'primite' : 'emise' }),
  Body: ({ card }) => (
    <p className="flex min-w-0 items-baseline gap-1 truncate text-xs text-muted-foreground">
      {str(card.clientName) ? <span className="truncate">{str(card.clientName)}</span> : null}
      {card.total != null && str(card.currency) ? (
        <>
          <span aria-hidden="true">·</span>
          <Money amount={Number(card.total)} currency={str(card.currency)!} className="tnum" />
        </>
      ) : null}
      {str(card.status) ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{t(`messages:refs.invoiceStatus.${str(card.status) as 'unpaid' | 'partial' | 'paid'}`)}</span>
        </>
      ) : null}
    </p>
  ),
})

registerRefCard('email_thread', {
  icon: Mail,
  Body: ({ card }) => (
    <>
      <Facts items={[str(card.from)]} />
      {str(card.quote) ? (
        <blockquote className="mt-1 line-clamp-4 whitespace-pre-wrap border-l-2 border-muted-foreground/40 pl-2 text-xs">{str(card.quote)}</blockquote>
      ) : (
        <Excerpt text={str(card.excerpt)} />
      )}
    </>
  ),
})

registerRefCard('calendar_event', {
  icon: CalendarDays,
  extra: (card) => (str(card.startAt) ? { date: dayInCompanyZone(str(card.startAt)!) } : {}),
  Body: ({ card }) => {
    const start = str(card.startAt)
    const end = str(card.endAt)
    const when = start
      ? card.allDay
        ? formatDate(start, { dateStyle: 'medium' })
        : `${formatDate(start, { dateStyle: 'medium', timeStyle: 'short' })}${end ? `–${formatDate(end, { timeStyle: 'short' })}` : ''}`
      : null
    const names = Array.isArray(card.attendeeNames) ? (card.attendeeNames as string[]) : []
    return <Facts items={[when, names.length > 0 && names.join(', ')]} />
  },
})

registerRefCard('archive_file', {
  icon: FileText,
  extra: (card) => (str(card.folderId) ? { folderId: str(card.folderId)! } : {}),
  Body: ({ card }) => <Facts items={[typeof card.sizeBytes === 'number' && formatBytes(card.sizeBytes)]} className="tnum" />,
})

registerRefCard('note', {
  icon: StickyNote,
  Body: ({ card }) => <Excerpt text={str(card.excerpt)} />,
})
