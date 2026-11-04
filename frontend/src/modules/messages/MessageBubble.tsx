import { Check, CheckCheck, ChevronDown, Clock, Copy, Loader2, Paperclip, Pencil, Play, Reply, RotateCw, Trash2 } from 'lucide-react'
import { forwardRef, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RefCard } from '@/shared/components/entity-cards/RefCard'
import { FileTypeIcon } from '@/shared/components/FileTypeIcon'
import { Button } from '@/shared/components/ui/button'
import { ContextMenu, useContextMenu } from '@/shared/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, MenuShortcut } from '@/shared/components/ui/dropdown-menu'
import { BottomSheet } from '@/shared/components/ui/responsive-menu'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Textarea } from '@/shared/components/ui/textarea'
import { useSwipeRow } from '@/shared/hooks/use-swipe-row'
import { api } from '@/shared/lib/api'
import { companyTimeZone, formatDateTime, intlTag } from '@/shared/lib/format'
import { haptic } from '@/shared/lib/haptics'
import { t } from '@/shared/lib/i18n'
import type { ChatAttachment, ChatMessageRef, ChatReaction, ChatReplyPreview } from '@/shared/lib/types'
import { cn, formatBytes } from '@/shared/lib/utils'
import { ChatAvatar, personColor } from './ChatAvatar'

// One message. Yours on the right in the tinted bubble, the others' on the left; in a group, the
// first bubble of a series has the author's avatar and name in their colour. Actions come from
// three places with the same items: the arrow in the bubble's corner on hover or focus (desktop,
// as in WhatsApp: nothing floats over the thread), right click (with the key beside each item) and
// a long press that opens a bottom sheet (phone). Swiping a bubble to the right replies to it.

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const
const LONG_PRESS_MS = 500
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp']
// One to three emoji and nothing else: shown large, without a bubble.
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u

export type ReceiptState = 'sent' | 'delivered' | 'seen'

/** A message of the thread: from the server, or the optimistic one being sent. */
export interface ThreadRow {
  id?: string
  clientId: string
  conversationId: string
  authorUserId: string
  authorName: string
  body: string
  attachments: ChatAttachment[]
  replyTo: ChatReplyPreview | null
  reactions: ChatReaction[]
  refs: ChatMessageRef[]
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  pending: 'sending' | 'failed' | null
  error: string | null
}

export interface BubbleActions {
  onReply: () => void
  onReact: (emoji: string) => void
  onCopy: () => void
  onEditStart: () => void
  onEditSave: (body: string) => void
  onEditCancel: () => void
  onDelete: () => void
  onRetry: () => void
  onDiscard: () => void
  onOpenMedia: (attachment: ChatAttachment) => void
  onJumpToQuote: (messageId: string) => void
  onRequestAccess: (refItem: ChatMessageRef) => void
}

export const MessageBubble = forwardRef<
  HTMLDivElement,
  {
    message: ThreadRow
    own: boolean
    meId: string
    startsSeries: boolean
    showAuthor: boolean
    authorOnline?: boolean
    receipt: ReceiptState | null
    editing: boolean
    focused: boolean
    highlighted: boolean
    nameOf: (userId: string) => string
    actions: BubbleActions
  }
>(function MessageBubble({ message, own, meId, startsSeries, showAuthor, authorOnline, receipt, editing, focused, highlighted, nameOf, actions }, ref) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const contextMenu = useContextMenu()
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canAct = Boolean(message.id) && !message.pending && !editing && !message.deletedAt
  const swipe = useSwipeRow({ onSwipeRight: canAct ? actions.onReply : undefined, threshold: 64 })

  if (message.deletedAt) {
    return (
      <div ref={ref} data-message-id={message.id} className={cn('msg-row px-1 py-1', own && 'text-right')}>
        <p className="text-xs italic text-muted-foreground">{t('messages:thread.deleted')}</p>
      </div>
    )
  }

  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current)
    longPress.current = null
  }
  const startLongPress = () => {
    cancelLongPress()
    longPress.current = setTimeout(() => {
      void haptic('tap')
      setSheetOpen(true)
    }, LONG_PRESS_MS)
  }

  // The archive copies arrive as attachments too; their card already shows them.
  const cardFiles = new Set(message.refs.map((r) => r.card.attachmentId).filter(Boolean))
  const attachments = message.attachments.filter((a) => !cardFiles.has(a.id))
  const images = attachments.filter((a) => IMAGE_TYPES.includes(a.contentType))
  const emojiOnly = !message.replyTo && attachments.length === 0 && message.refs.length === 0 && EMOJI_ONLY.test(message.body.trim())
  const photoOnly = !message.body && images.length === 1 && attachments.length === 1 && message.refs.length === 0 && !message.replyTo

  const menuItems = (
    <>
      <DropdownMenuItem onClick={actions.onReply}>
        <Reply className="h-4 w-4" aria-hidden="true" />
        {t('messages:actions.reply')}
        <MenuShortcut>R</MenuShortcut>
      </DropdownMenuItem>
      {message.body ? (
        <DropdownMenuItem onClick={actions.onCopy}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          {t('messages:actions.copy')}
          <MenuShortcut>C</MenuShortcut>
        </DropdownMenuItem>
      ) : null}
      {own ? (
        <>
          <DropdownMenuItem onClick={actions.onEditStart} disabled={!message.body}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t('common:actions.edit')}
            <MenuShortcut>E</MenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem destructive onClick={actions.onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('common:actions.delete')}
            <MenuShortcut>{t('common:keys.delete')}</MenuShortcut>
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )

  const meta = (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap text-[11px]',
        // Over a photo: a dark chip that reads on any picture, ticks included (the blue stays blue).
        photoOnly
          ? 'rounded-full bg-black/55 px-1.5 py-0.5 leading-none text-white/90 [&_.text-muted-foreground]:text-white/90'
          : 'ml-2 translate-y-1 text-muted-foreground [float:right]',
      )}
    >
      {message.editedAt ? <span>{t('messages:thread.edited')}</span> : null}
      <time className="tnum" dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>
        {clock(message.createdAt)}
      </time>
      {message.pending === 'sending' ? (
        <span title={t('common:states.sending')} className="inline-flex">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t('common:states.sending')}</span>
        </span>
      ) : null}
      {receipt ? <Ticks state={receipt} /> : null}
    </span>
  )

  return (
    <div
      ref={ref}
      data-message-id={message.id}
      tabIndex={-1}
      className={cn(
        'msg-row group relative flex px-1 focus:outline-none',
        own ? 'justify-end' : 'justify-start',
        startsSeries ? 'pt-2' : 'pt-0.5',
        highlighted && 'msg-highlight',
      )}
    >
      {/* Revealed behind the bubble while swiping right. */}
      {swipe.offset > 0 ? (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">
          <Reply className="h-4 w-4" />
        </span>
      ) : null}
      {showAuthor && !own ? (
        // The column stays for the whole series, so its bubbles line up under the first one.
        <div className="mr-1.5 w-7 shrink-0 self-start">
          {startsSeries ? <ChatAvatar size="sm" userId={message.authorUserId} name={message.authorName} online={authorOnline} /> : null}
        </div>
      ) : null}
      <div
        className={cn(
          'relative flex min-w-0 max-w-[85%] flex-col md:max-w-[65%]',
          own ? 'items-end' : 'items-start',
          canAct && '[@media(pointer:coarse)]:select-none',
        )}
        style={swipe.style}
        {...(canAct ? swipe.handlers : {})}
        onContextMenu={canAct ? contextMenu.onContextMenu : undefined}
        onTouchStart={canAct ? startLongPress : undefined}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
      >
        {startsSeries && showAuthor && !own ? (
          <span className="mb-0.5 px-1 text-xs font-medium" style={{ color: personColor(message.authorUserId) }}>
            {message.authorName}
          </span>
        ) : null}

        {editing ? (
          <EditForm initial={message.body} onSave={actions.onEditSave} onCancel={actions.onEditCancel} />
        ) : (
          <div
            className={cn(
              'relative min-w-0 max-w-full',
              emojiOnly ? 'px-1' : 'rounded-lg',
              !emojiOnly && (own ? 'bg-bubble-own' : 'bg-bubble-other'),
              !emojiOnly && !photoOnly && 'px-2.5 py-1.5',
              photoOnly && 'p-1',
              !emojiOnly && startsSeries && (own ? 'rounded-tr-sm' : 'rounded-tl-sm'),
              focused && 'ring-2 ring-ring',
            )}
          >
            {message.replyTo ? <QuoteBlock reply={message.replyTo} onJump={actions.onJumpToQuote} /> : null}

            {attachments.length > 0 ? (
              <ul className={cn('flex flex-col gap-1', (message.body || message.refs.length > 0) && 'mb-1')}>
                {attachments.map((attachment) => (
                  <AttachmentItem
                    key={attachment.id}
                    attachment={attachment}
                    fill={photoOnly}
                    uploading={message.pending === 'sending'}
                    onOpen={() => actions.onOpenMedia(attachment)}
                  />
                ))}
              </ul>
            ) : null}

            {message.refs.length > 0 ? (
              <div className={cn('flex flex-col gap-1', message.body && 'mb-1')}>
                {message.refs.map((refItem) => (
                  <RefCard
                    key={refItem.id}
                    refItem={refItem}
                    onRequestAccess={own ? undefined : actions.onRequestAccess}
                    onOpenFile={(attachmentId) => {
                      const file = message.attachments.find((a) => a.id === attachmentId)
                      if (file) actions.onOpenMedia(file)
                    }}
                  />
                ))}
              </div>
            ) : null}

            {message.body ? (
              <div className={cn('whitespace-pre-wrap break-words', emojiOnly ? 'text-4xl leading-tight' : 'text-sm')}>
                {message.body}
                {emojiOnly ? null : meta}
              </div>
            ) : null}
            {!message.body || emojiOnly ? (
              <div className={cn('flex justify-end', photoOnly && 'absolute bottom-2 right-2')}>{meta}</div>
            ) : null}

            {canAct ? (
              // Desktop only (CSS): shown on hover, on focus and while its menu is open.
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger
                  className={cn(
                    'msg-actions absolute right-1 top-1 z-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    menuOpen && 'msg-actions-open',
                    photoOnly
                      ? 'rounded-full bg-black/55 p-0.5 text-white/90 hover:text-white'
                      : emojiOnly
                        ? 'rounded-full border bg-popover p-0.5'
                        : // Fades into the bubble, so the end of the first line does not look cut off.
                          cn('rounded-tr-lg bg-gradient-to-l via-60% to-transparent pb-1 pl-4 pr-0.5', own ? 'from-bubble-own via-bubble-own' : 'from-bubble-other via-bubble-other'),
                  )}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t('messages:thread.messageActions')}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={own ? 'end' : 'start'}>
                  <ReactionRow
                    onPick={(emoji) => {
                      setMenuOpen(false)
                      actions.onReact(emoji)
                    }}
                    className="px-1 pb-1"
                  />
                  {menuItems}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )}

        {message.reactions.length > 0 ? (
          <ReactionPills reactions={message.reactions} meId={meId} nameOf={nameOf} onToggle={actions.onReact} align={own ? 'end' : 'start'} />
        ) : null}

        {message.pending === 'failed' ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatePill tone="warning">{t('messages:thread.notSent')}</StatePill>
            <button type="button" className="flex items-center gap-1 underline underline-offset-2" onClick={actions.onRetry}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common:actions.tryAgainShort')}
            </button>
            <button type="button" className="underline underline-offset-2" onClick={actions.onDiscard}>
              {t('common:actions.discard')}
            </button>
          </div>
        ) : null}

      </div>

      <ContextMenu state={contextMenu}>
        <ReactionRow onPick={actions.onReact} className="px-1 pb-1" />
        {menuItems}
      </ContextMenu>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('messages:thread.messageActions')} role="menu">
        <ReactionRow
          onPick={(emoji) => {
            setSheetOpen(false)
            actions.onReact(emoji)
          }}
          className="justify-around px-2 pb-2"
          large
        />
        <SheetItem icon={Reply} label={t('messages:actions.reply')} onClick={() => (setSheetOpen(false), actions.onReply())} />
        {message.body ? <SheetItem icon={Copy} label={t('messages:actions.copy')} onClick={() => (setSheetOpen(false), actions.onCopy())} /> : null}
        {own && message.body ? <SheetItem icon={Pencil} label={t('common:actions.edit')} onClick={() => (setSheetOpen(false), actions.onEditStart())} /> : null}
        {own ? <SheetItem icon={Trash2} label={t('common:actions.delete')} destructive onClick={() => (setSheetOpen(false), actions.onDelete())} /> : null}
      </BottomSheet>
    </div>
  )
})

function SheetItem({ icon: Icon, label, onClick, destructive }: { icon: typeof Reply; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn('flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-base hover:bg-accent', destructive && 'text-destructive')}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {label}
    </button>
  )
}

function ReactionRow({ onPick, className, large }: { onPick: (emoji: string) => void; className?: string; large?: boolean }) {
  return (
    <div className={cn('flex items-center gap-1', className)} role="group" aria-label={t('messages:actions.react')}>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className={cn(
            'rounded-full hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            large ? 'h-12 w-12 text-2xl' : 'h-8 w-8 text-lg',
          )}
          aria-label={t('messages:actions.reactWith', { emoji })}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

function ReactionPills({
  reactions,
  meId,
  nameOf,
  onToggle,
  align,
}: {
  reactions: ChatReaction[]
  meId: string
  nameOf: (userId: string) => string
  onToggle: (emoji: string) => void
  align: 'start' | 'end'
}) {
  return (
    <ul className={cn('mt-0.5 flex flex-wrap gap-1', align === 'end' ? 'justify-end' : 'justify-start')} aria-label={t('messages:actions.reactions')}>
      {reactions.map((reaction) => {
        const mine = reaction.userIds.includes(meId)
        const names = reaction.userIds.map(nameOf).join(', ')
        return (
          <li key={reaction.emoji} className="reaction-pill">
            <button
              type="button"
              onClick={() => onToggle(reaction.emoji)}
              title={names}
              aria-pressed={mine}
              aria-label={t('messages:actions.reactionSummary', { emoji: reaction.emoji, count: reaction.userIds.length, names })}
              className={cn(
                'flex h-6 items-center gap-1 rounded-full px-1.5 text-xs tnum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mine ? 'bg-primary/10 ring-1 ring-ring' : 'bg-muted hover:bg-accent',
              )}
            >
              <span className="text-sm leading-none">{reaction.emoji}</span>
              {reaction.userIds.length}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function QuoteBlock({ reply, onJump }: { reply: ChatReplyPreview; onJump: (messageId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onJump(reply.id)}
      className="mb-1 block w-full min-w-0 rounded-md bg-background/60 px-2 py-1 text-left hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('messages:reply.jump', { name: reply.authorName })}
    >
      <span className="block truncate text-xs font-medium">{reply.authorName}</span>
      <span className="line-clamp-2 text-xs text-muted-foreground">
        {reply.deleted ? (
          <em>{t('messages:thread.deleted')}</em>
        ) : reply.body ? (
          reply.body
        ) : reply.hasAttachment ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" aria-hidden="true" />
            {t('messages:reply.attachment')}
          </span>
        ) : null}
      </span>
    </button>
  )
}

function EditForm({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial)
  return (
    <form
      className="mt-1 w-80 max-w-full space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft.trim()) onSave(draft)
      }}
    >
      <Textarea
        value={draft}
        autoFocus
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (draft.trim()) onSave(draft)
          }
        }}
        aria-label={t('messages:thread.editMessage')}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          {t('common:actions.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('common:actions.discard')}
        </Button>
      </div>
    </form>
  )
}

function AttachmentItem({ attachment, fill, uploading, onOpen }: { attachment: ChatAttachment; fill: boolean; uploading: boolean; onOpen: () => void }) {
  const href = `/api/chat/attachments/${attachment.id}`
  if (IMAGE_TYPES.includes(attachment.contentType)) {
    return (
      <li className="relative">
        <button type="button" onClick={onOpen} className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {/* The thumbnail (640px), not the original: a phone photo is megabytes. */}
          <img
            src={`${href}?size=thumb`}
            alt={attachment.filename}
            loading="lazy"
            className={cn('max-h-80 rounded-md object-cover', fill ? 'w-[min(320px,100%)]' : 'max-w-[min(280px,100%)]')}
          />
        </button>
        {uploading ? <Spinner /> : null}
      </li>
    )
  }
  if (VIDEO_TYPES.includes(attachment.contentType)) {
    return (
      <li className="relative">
        <button
          type="button"
          onClick={onOpen}
          className="relative block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('messages:thread.play', { filename: attachment.filename })}
        >
          {/* `#t=0.1` + metadata only: the first frame as the thumbnail, without pulling the video. */}
          <video src={`${href}#t=0.1`} preload="metadata" muted playsInline className="max-h-72 max-w-[min(280px,100%)] rounded-md bg-black" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="h-5 w-5" aria-hidden="true" />
            </span>
          </span>
        </button>
        {uploading ? <Spinner /> : null}
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => void api.download(`${href}?download=1`, attachment.filename).catch((err: Error) => toast.error(err.message))}
        className="flex w-64 max-w-full items-center gap-2.5 rounded-md bg-background/50 p-1.5 pr-2.5 text-left hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileTypeIcon filename={attachment.filename} contentType={attachment.contentType} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{attachment.filename}</span>
          <span className="block text-xs uppercase text-muted-foreground tnum">
            {formatBytes(attachment.sizeBytes)} · {attachment.filename.split('.').pop()}
          </span>
        </span>
      </button>
    </li>
  )
}

function Spinner() {
  return (
    <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/30" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden="true" />
      <span className="sr-only">{t('messages:composer.uploading')}</span>
    </span>
  )
}

function Ticks({ state }: { state: ReceiptState }) {
  const label = t(`messages:thread.receipt.${state}`)
  const Icon = state === 'sent' ? Check : CheckCheck
  return (
    <span title={label} className={cn('inline-flex', state === 'seen' ? 'text-tick-seen' : 'text-muted-foreground')}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat(intlTag(), { hour: '2-digit', minute: '2-digit', timeZone: companyTimeZone() }).format(new Date(iso))
}
