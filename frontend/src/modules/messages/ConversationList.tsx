import { BellOff, Hash, Image, MessageSquarePlus, Paperclip, Users } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useChatTyping, useLiveChatConversations } from '@/shared/hooks/use-chat'
import { motionLevel } from '@/shared/lib/motion'
import { memberName } from '@/shared/hooks/use-team'
import { cn } from '@/shared/lib/utils'
import { formatRelativeTime } from '@/shared/lib/format'
import type { ChatConversation } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// The conversation column: "Groups" and "Direct" sections, unread ones with the name in bold and
// a count in a `Badge`, so not colour alone. A row is two lines (#17): name and time, then the
// preview and the count. Presence lives in the thread's header. When a conversation moves to the
// top, the rows slide to their new place (FLIP, full motion only, #22).

/** DM = celălalt om. Grupul = numele lui. */
export function conversationTitle(conversation: ChatConversation, meId: string): string {
  if (conversation.kind === 'group') return conversation.name ?? t('messages:list.group')
  const other = conversation.members.find((member) => member.id !== meId)
  return other ? memberName(other) : t('messages:list.conversation')
}

export function presenceLabel(presence: 'online' | 'away' | undefined, lastSeenAt: string | null): string {
  if (presence === 'online') return t('messages:presence.activeNow')
  if (!lastSeenAt) return t('messages:presence.unknown')
  return t('messages:presence.seen', { lastSeenAt: formatRelativeTime(lastSeenAt) })
}

export function ConversationList({ meId, onNew }: { meId: string; onNew: () => void }) {
  const conversations = useLiveChatConversations()
  const typing = useChatTyping()
  const listRef = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, number>())
  const order = conversations.data?.map((c) => c.id).join(',')

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const rows = list.querySelectorAll<HTMLElement>('[data-conversation-id]')
    const animate = motionLevel() === 'full' && positions.current.size > 0
    const next = new Map<string, number>()
    rows.forEach((row) => {
      const id = row.dataset.conversationId!
      const top = row.offsetTop
      next.set(id, top)
      const before = positions.current.get(id)
      if (!animate || before === undefined || before === top) return
      row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], {
        duration: 200,
        easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-in-out').trim() || 'ease-in-out',
      })
    })
    positions.current = next
  }, [order])

  if (conversations.isPending) {
    return (
      <div className="space-y-2 p-3" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (conversations.isError) {
    return (
      <p className="p-4 text-sm">
        {t('messages:list.loadFailed')}{' '}
        {/* Acțiune de text în interiorul unei propoziții, fără carapacă de buton — de aceea
            nativ, nu `Button` (ar fi 32px înălțime și padding într-o frază). */}
        <button type="button" className="underline underline-offset-2" onClick={() => void conversations.refetch()}>
          {t('common:actions.retry')}
        </button>
      </p>
    )
  }

  const groups = conversations.data.filter((c) => c.kind === 'group')
  const direct = conversations.data.filter((c) => c.kind === 'dm')

  if (conversations.data.length === 0) {
    return (
      <EmptyState
        kind="new"
        title={t('messages:list.emptyTitle')}
        description={t('messages:list.emptyDescription')}
        action={
          <Button onClick={onNew}>
            <MessageSquarePlus className="h-4 w-4" />
            {t('messages:list.writeToSomeone')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('messages:list.title')}</h2>
        <Button variant="ghost" size="icon" aria-label={t('messages:list.newConversation')} onClick={onNew}>
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>
      <div ref={listRef} className="scroll-subtle min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.length > 0 ? (
          <Section title={t('messages:list.groups')}>
            {groups.map((conversation) => (
              <Row key={conversation.id} conversation={conversation} meId={meId} typingIds={typing.get(conversation.id) ?? []} />
            ))}
          </Section>
        ) : null}
        {direct.length > 0 ? (
          <Section title={t('messages:list.direct')}>
            {direct.map((conversation) => (
              <Row key={conversation.id} conversation={conversation} meId={meId} typingIds={typing.get(conversation.id) ?? []} />
            ))}
          </Section>
        ) : null}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{title}</div>
      <ul>{children}</ul>
    </section>
  )
}

function Row({ conversation, meId, typingIds }: { conversation: ChatConversation; meId: string; typingIds: string[] }) {
  const title = conversationTitle(conversation, meId)
  const unread = conversation.unreadCount > 0
  const others = typingIds.filter((id) => id !== meId)
  const typingNames = others.map((id) => {
    const member = conversation.members.find((m) => m.id === id)
    return member ? memberName(member) : '?'
  })

  return (
    <li data-conversation-id={conversation.id}>
      <NavLink
        to={`/messages/${conversation.id}`}
        state={{ fromList: true }}
        className={({ isActive }) =>
          // Selection is a surface tint, not an accent with a border (DESIGN.md).
          cn('flex items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', isActive && 'bg-accent')
        }
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground" aria-hidden="true">
          {conversation.kind === 'group' ? <Users className="h-4 w-4" /> : initials(title)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-sm', unread && 'font-semibold')}>{title}</span>
            {conversation.lastMessage ? (
              <span className={cn('shrink-0 text-xs tnum', unread ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {formatRelativeTime(conversation.lastMessage.createdAt)}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {typingNames.length > 0 ? (
              <span className="min-w-0 flex-1 truncate italic">{t('messages:typing.named', { names: typingNames.join(', '), count: typingNames.length })}</span>
            ) : (
              <Preview conversation={conversation} meId={meId} unread={unread} />
            )}
            {conversation.muted ? <BellOff className="h-3.5 w-3.5 shrink-0" aria-label={t('messages:list.muted')} /> : null}
            {unread ? <Badge variant="destructive">{conversation.unreadCount}</Badge> : null}
          </span>
        </span>
      </NavLink>
    </li>
  )
}

/** The last message in one line: what it carries (photo, file, object) before its text (#23). */
function Preview({ conversation, meId, unread }: { conversation: ChatConversation; meId: string; unread: boolean }) {
  const last = conversation.lastMessage
  if (!last) return <span className="min-w-0 flex-1 truncate">{t('messages:list.noMessagesYet')}</span>
  const Icon = last.refType ? Hash : last.attachmentKind === 'image' ? Image : last.attachmentKind === 'file' ? Paperclip : null
  const fallback = last.refType
    ? t(`messages:refs.types.${last.refType}`)
    : last.attachmentKind === 'image'
      ? t('messages:list.photo')
      : last.attachmentKind === 'file'
        ? t('messages:reply.attachment')
        : ''
  return (
    <span className={cn('flex min-w-0 flex-1 items-center gap-1', unread && 'font-medium text-foreground')}>
      {last.authorId === meId ? <span className="shrink-0">{t('messages:list.youPrefix')}</span> : null}
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0 truncate">{last.body || fallback}</span>
    </span>
  )
}

function initials(name: string): string {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}