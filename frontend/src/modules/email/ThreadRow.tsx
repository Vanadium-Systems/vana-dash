import { Archive, Check, Clock, FileText, Image as ImageIcon, Mail, MailOpen, MoreHorizontal, Paperclip, ShieldAlert, Star, Trash2 } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { Highlight } from '@/shared/components/Highlight'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { ContextMenu, useContextMenu } from '@/shared/components/ui/context-menu'
import { DropdownMenuItem, DropdownMenuTrigger, MenuShortcut } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenu, ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { useSwipeRow } from '@/shared/hooks/use-swipe-row'
import { formatDateTime, formatListDate } from '@/shared/lib/format'
import { haptic } from '@/shared/lib/haptics'
import { t } from '@/shared/lib/i18n'
import type { EmailThread } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { SnoozeMenu, snoozeOptions } from './SnoozeMenu'

export type MoveFolder = 'archive' | 'spam' | 'trash'

/** "Ana Pop <ana@x.ro>" → "Ana Pop"; a bare address stays as it is. */
export function senderName(address: string | null): string {
  if (!address) return ''
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(address)
  return named?.[1]?.trim() || address.trim()
}

export function initials(address: string | null): string {
  const name = senderName(address).replace(/@.*/, '')
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export function Avatar({ address, size = 40 }: { address: string | null; size?: 32 | 40 }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground',
        size === 40 ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs',
      )}
    >
      {initials(address)}
    </span>
  )
}

const FOLDER_LABEL = {
  archive: 'email:folders.archive',
  spam: 'email:folders.spam',
  trash: 'email:folders.trash',
} as const

function AttachmentChip({ attachment, onOpen }: { attachment: EmailThread['attachments'][number]; onOpen: () => void }) {
  const Icon = attachment.contentType?.startsWith('image/') ? ImageIcon : attachment.contentType === 'application/pdf' ? FileText : Paperclip
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      title={attachment.filename}
      className="inline-flex max-w-40 items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{attachment.filename}</span>
    </button>
  )
}

function HoverAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
    >
      {children}
    </button>
  )
}

// E1-E5: one line on a desktop (sender · subject – snippet · attachments · date), a three-line
// card under 640px. Unread is the weight of the text, not a red dot (red stays for errors). On a
// device with a mouse the date gives way to the actions on hover or keyboard focus; on touch
// there is the swipe, the long press and the ⋯ that is always there.
export function ThreadRow({
  thread,
  query,
  opened,
  selected,
  focused,
  showFolder,
  mailboxLabel,
  onActivate,
  onToggle,
  onLongPress,
  onMove,
  onMarkRead,
  onStar,
  onSnooze,
  onOpenAttachment,
}: {
  thread: EmailThread
  query: string
  opened: boolean
  selected: boolean
  focused: boolean
  showFolder: boolean
  mailboxLabel: string | null
  onActivate: (e: MouseEvent) => void
  onToggle: () => void
  onLongPress: { start: () => void; cancel: () => void }
  onMove: (folder: MoveFolder) => void
  onMarkRead: (isRead: boolean) => void
  onStar: () => void
  onSnooze: (untilIso: string) => void
  onOpenAttachment: (attachmentId: string) => void
}) {
  const contextMenu = useContextMenu()
  const swipe = useSwipeRow({
    onSwipeLeft: () => {
      void haptic('tap')
      onMove('trash')
    },
  })
  const unread = !thread.isRead
  const sender = thread.fromAddress ? senderName(thread.fromAddress) : thread.participants.join(', ')
  const subject = thread.subject || t('email:labels.noSubject')
  const folderKey = showFolder && thread.folder && thread.folder !== 'inbox' ? FOLDER_LABEL[thread.folder] : undefined

  const menuItems = (
    <>
      <DropdownMenuItem onClick={() => onMove('archive')}>
        <Archive className="h-4 w-4" /> {t('common:actions.archive')}
        <MenuShortcut>E</MenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onMarkRead(unread)}>
        {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        {unread ? t('email:list.read') : t('common:states.unread')}
        <MenuShortcut>{unread ? `${t('common:keys.shift')} I` : `${t('common:keys.shift')} U`}</MenuShortcut>
      </DropdownMenuItem>
      {snoozeOptions(new Date()).map((option) => (
        <DropdownMenuItem key={option.key} onClick={() => onSnooze(option.at.toISOString())}>
          <Clock className="h-4 w-4" /> {t(`email:snooze.${option.key}`)}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onClick={() => onMove('spam')}>
        <ShieldAlert className="h-4 w-4" /> {t('email:folders.spam')}
        <MenuShortcut>!</MenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem destructive onClick={() => onMove('trash')}>
        <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
        <MenuShortcut>#</MenuShortcut>
      </DropdownMenuItem>
    </>
  )

  return (
    <div className="relative overflow-hidden border-b last:border-b-0" data-thread-id={thread.id}>
      {swipe.offset < 0 ? (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-end bg-destructive px-4 text-destructive-foreground">
          <Trash2 className="h-5 w-5" />
        </div>
      ) : null}
      <div
        className={cn(
          'group relative flex items-start gap-2 bg-card px-2 py-2 text-sm transition-colors hover:bg-muted sm:h-10 sm:items-center sm:py-0',
          (opened || selected) && 'bg-muted',
          focused && 'ring-1 ring-inset ring-ring',
        )}
        onContextMenu={contextMenu.onContextMenu}
        style={swipe.style}
        {...swipe.handlers}
      >
        <Checkbox
          className="hidden sm:inline-flex"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={subject}
        />
        <button
          type="button"
          title={thread.isStarred ? t('email:thread.unstar') : t('email:thread.star')}
          aria-label={thread.isStarred ? t('email:thread.unstar') : t('email:thread.star')}
          aria-pressed={thread.isStarred}
          onClick={(e) => {
            e.stopPropagation()
            onStar()
          }}
          className="hidden shrink-0 rounded p-1 text-muted-foreground hover:text-foreground sm:block"
        >
          <Star className={cn('h-4 w-4', thread.isStarred && 'fill-warning text-warning')} />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 select-none items-start gap-3 text-left sm:items-center"
          onClick={onActivate}
          onTouchStart={onLongPress.start}
          onTouchEnd={onLongPress.cancel}
          onTouchMove={onLongPress.cancel}
        >
          {/* Phone: avatar, then three lines. The avatar becomes a check when the row is selected. */}
          <span className="sm:hidden">
            {selected ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-5 w-5" />
              </span>
            ) : (
              <Avatar address={thread.fromAddress} />
            )}
          </span>
          <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
            <span className={cn('flex items-baseline gap-2 sm:w-44 sm:shrink-0', unread ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              <span className="min-w-0 flex-1 truncate">
                <Highlight text={sender} query={query} />
              </span>
              <time className="shrink-0 text-xs font-normal text-muted-foreground sm:hidden" dateTime={thread.lastMessageAt} title={formatDateTime(thread.lastMessageAt)}>
                {formatListDate(thread.lastMessageAt)}
              </time>
            </span>
            <span className="block min-w-0 truncate sm:flex-1">
              <span className={cn(unread ? 'font-semibold text-foreground' : 'text-foreground')}>
                <Highlight text={subject} query={query} />
              </span>
              {thread.snippet ? (
                <>
                  <span className="hidden text-muted-foreground sm:inline"> – </span>
                  <span className="block truncate text-muted-foreground sm:inline">
                    <Highlight text={thread.snippet} query={query} />
                  </span>
                </>
              ) : null}
            </span>
          </span>
        </button>
        <span className="hidden shrink-0 items-center gap-1 lg:flex">
          {thread.attachments.slice(0, 2).map((attachment) => (
            <AttachmentChip key={attachment.id} attachment={attachment} onOpen={() => onOpenAttachment(attachment.id)} />
          ))}
          {thread.attachments.length > 2 ? <span className="text-xs text-muted-foreground">+{thread.attachments.length - 2}</span> : null}
        </span>
        {thread.attachments.length > 0 ? <Paperclip className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block lg:hidden" aria-label={t('email:list.hasAttachment')} /> : null}
        {folderKey ? <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">{t(folderKey)}</span> : null}
        {mailboxLabel ? (
          <span className="hidden max-w-28 shrink-0 truncate text-xs text-muted-foreground xl:inline" title={t('email:list.receivedOn', { toAddress: thread.toAddress ?? '' })}>
            {mailboxLabel}
          </span>
        ) : null}
        <span className="relative hidden h-8 w-20 shrink-0 items-center justify-end sm:flex">
          <time
            className={cn(
              'text-xs tabular-nums [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:invisible [@media(hover:hover)_and_(pointer:fine)]:group-hover:invisible',
              unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
            dateTime={thread.lastMessageAt}
            title={formatDateTime(thread.lastMessageAt)}
          >
            {formatListDate(thread.lastMessageAt)}
          </time>
          <span className="absolute inset-y-0 right-0 hidden items-center rounded bg-muted [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:flex [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex">
            <HoverAction label={t('common:actions.archive')} onClick={() => onMove('archive')}>
              <Archive className="h-4 w-4" />
            </HoverAction>
            <HoverAction label={t('common:actions.delete')} onClick={() => onMove('trash')}>
              <Trash2 className="h-4 w-4" />
            </HoverAction>
            <HoverAction label={unread ? t('email:list.read') : t('common:states.unread')} onClick={() => onMarkRead(unread)}>
              {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            </HoverAction>
            <span onClick={(e) => e.stopPropagation()}>
              <SnoozeMenu onSnooze={onSnooze} triggerClassName="inline-flex rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground" />
            </span>
          </span>
        </span>
        {/* Touch and narrow screens: the row's actions are always one tap away. */}
        <ResponsiveMenu>
          <DropdownMenuTrigger className="mt-2 shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground sm:mt-0 [@media(hover:hover)_and_(pointer:fine)]:sm:hidden">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('common:actions.more')}</span>
          </DropdownMenuTrigger>
          <ResponsiveMenuContent title={subject} align="end">
            {menuItems}
          </ResponsiveMenuContent>
        </ResponsiveMenu>
        <ContextMenu state={contextMenu}>{menuItems}</ContextMenu>
      </div>
    </div>
  )
}
