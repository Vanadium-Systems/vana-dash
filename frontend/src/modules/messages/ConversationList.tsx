import { BellOff, MessageSquarePlus, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useLiveChatConversations } from '@/shared/hooks/use-chat'
import { memberName } from '@/shared/hooks/use-team'
import { cn } from '@/shared/lib/utils'
import { formatRelativeTime } from '@/shared/lib/format'
import type { ChatConversation } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// Coloana de conversații (fișa „Mesaje"): secțiuni „Grupuri" și „Directe", necititele cu nume
// îngroșat + număr în `Badge` — deci nu doar culoare. Prezența e text („Activ acum"), nu
// doar punctul verde.

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
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.length > 0 ? (
          <Section title={t('messages:list.groups')}>
            {groups.map((conversation) => (
              <Row key={conversation.id} conversation={conversation} meId={meId} />
            ))}
          </Section>
        ) : null}
        {direct.length > 0 ? (
          <Section title={t('messages:list.direct')}>
            {direct.map((conversation) => (
              <Row key={conversation.id} conversation={conversation} meId={meId} />
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

function Row({ conversation, meId }: { conversation: ChatConversation; meId: string }) {
  const title = conversationTitle(conversation, meId)
  const other = conversation.kind === 'dm' ? conversation.members.find((member) => member.id !== meId) : undefined
  const unread = conversation.unreadCount > 0
  const preview = conversation.lastMessage?.body ?? t('messages:list.noMessagesYet')

  return (
    <li>
      <NavLink
        to={`/messages/${conversation.id}`}
        state={{ fromList: true }}
        className={({ isActive }) =>
          // Selecția e tentă de suprafață, nu accent + border (regula din DESIGN.md).
          cn(
            'flex items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive && 'bg-accent',
          )
        }
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium',
            unread ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {conversation.kind === 'group' ? <Users className="h-4 w-4" /> : initials(title)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-sm', unread && 'font-semibold')}>{title}</span>
            {unread ? <Badge variant="destructive">{conversation.unreadCount}</Badge> : null}
            {conversation.muted ? <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t('messages:list.muted')} /> : null}
          </span>
          <span className={cn('mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground', unread ? 'font-medium' : '')}>
            <span className="min-w-0 flex-1 truncate">{preview}</span>
            {conversation.lastMessage ? <span className="shrink-0 tnum">{formatRelativeTime(conversation.lastMessage.createdAt)}</span> : null}
          </span>
          {other ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {presenceLabel(other.presence, other.lastSeenAt)}
            </span>
          ) : null}
        </span>
      </NavLink>
    </li>
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