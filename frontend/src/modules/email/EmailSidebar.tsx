import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  Clock,
  FileEdit,
  Inbox,
  Layers,
  Megaphone,
  Repeat,
  Send,
  Settings as SettingsIcon,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
} from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { useEmailUnreadCounts } from '@/shared/hooks/use-email-unread-counts'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import type { EmailLabel, SendQuotaUsage } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// Roșu peste 90% din limita zilnică SAU lunară — cea mai apropiată de prag decide culoarea,
// nu media, altfel un consum lunar mic ar masca o zi aproape de plafon.
function quotaTone(usage: SendQuotaUsage): string {
  const dailyRatio = usage.today / usage.dailyLimit
  const monthlyRatio = usage.month / usage.monthlyLimit
  const worst = Math.max(dailyRatio, monthlyRatio)
  if (worst >= 0.9) return 'text-destructive'
  if (worst >= 0.7) return 'text-warning'
  return 'text-muted-foreground'
}

function SendQuotaIndicator() {
  const quota = useQuery({
    queryKey: ['email', 'send-quota'],
    queryFn: () => api.get<SendQuotaUsage>('/api/email/send-quota'),
    staleTime: 5 * 60 * 1000,
  })
  if (!quota.data) return null
  return (
    <div className={cn('space-y-0.5 px-3 text-xs', quotaTone(quota.data))} title={t('email:sidebar.quotaHint')}>
      <div>{t('email:sidebar.quotaToday', { today: quota.data.today, dailyLimit: quota.data.dailyLimit })}</div>
      <div>{t('email:sidebar.quotaMonth', { month: quota.data.month, monthlyLimit: quota.data.monthlyLimit })}</div>
    </div>
  )
}

export type EmailView =
  | { kind: 'mailbox'; folder?: 'inbox' | 'archive' | 'trash' | 'spam' | 'all'; starred?: boolean; snoozed?: boolean; labelId?: string }
  | { kind: 'drafts' }
  | { kind: 'sent' }
  | { kind: 'templates' }
  | { kind: 'bulk' }
  | { kind: 'sequences' }
  | { kind: 'settings' }

interface NavItemProps {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
  unreadCount?: number
}

function NavItem({ active, icon, label, onClick, unreadCount }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {unreadCount ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </button>
  )
}

function viewKey(view: EmailView): string {
  if (view.kind !== 'mailbox') return view.kind
  return `mailbox:${view.folder ?? ''}:${view.starred ? '1' : '0'}:${view.snoozed ? '1' : '0'}:${view.labelId ?? ''}`
}

export function EmailSidebar({
  current,
  onNavigate,
  onCompose,
}: {
  current: EmailView
  onNavigate: (view: EmailView) => void
  onCompose: () => void
}) {
  const { can, canAny } = useMe()
  const labels = useQuery({
    queryKey: ['email', 'labels'],
    queryFn: () => api.get<EmailLabel[]>('/api/email/labels'),
    enabled: can('email.view'),
  })
  const unreadCounts = useEmailUnreadCounts()

  const currentKey = viewKey(current)
  const item = (view: EmailView, icon: React.ReactNode, label: string, unreadCount?: number) => (
    <NavItem
      key={viewKey(view)}
      active={viewKey(view) === currentKey}
      icon={icon}
      label={label}
      unreadCount={unreadCount}
      onClick={() => onNavigate(view)}
    />
  )

  return (
    <div className="flex w-full flex-col gap-4 md:w-52 md:shrink-0">
      {can('email.trimitere') ? (
        <Button className="w-full" onClick={onCompose}>
          {t('email:compose.title')}
        </Button>
      ) : null}

      <nav className="space-y-0.5">
        {item({ kind: 'mailbox', folder: 'inbox' }, <Inbox className="h-4 w-4" />, t('email:folders.inbox'), unreadCounts.data?.inbox)}
        {item({ kind: 'mailbox', starred: true }, <Star className="h-4 w-4" />, t('email:folders.starred'))}
        {item({ kind: 'mailbox', snoozed: true }, <Clock className="h-4 w-4" />, t('email:folders.snoozed'))}
        {item({ kind: 'drafts' }, <FileEdit className="h-4 w-4" />, t('email:folders.drafts'))}
        {item({ kind: 'sent' }, <Send className="h-4 w-4" />, t('email:folders.sent'))}
        {item({ kind: 'mailbox', folder: 'archive' }, <Archive className="h-4 w-4" />, t('email:folders.archive'))}
        {item({ kind: 'mailbox', folder: 'spam' }, <ShieldAlert className="h-4 w-4" />, t('email:folders.spam'), unreadCounts.data?.spam)}
        {item({ kind: 'mailbox', folder: 'trash' }, <Trash2 className="h-4 w-4" />, t('email:folders.trash'))}
        {item({ kind: 'mailbox', folder: 'all' }, <Layers className="h-4 w-4" />, t('email:folders.all'))}
      </nav>

      {labels.data?.length ? (
        <div className="space-y-0.5">
          <p className="px-3 text-xs text-muted-foreground">{t('email:labels.labels')}</p>
          {labels.data.map((label) =>
            item({ kind: 'mailbox', labelId: label.id }, <Tag className="h-4 w-4" style={{ color: label.color ?? undefined }} />, label.name),
          )}
        </div>
      ) : null}

      {/* Fiecare view are functionalitatea lui (PLAN.md C2): ce nu e pornit nu există
          pentru omul ăsta, nici măcar ca link. */}
      {canAny(['email.sabloane', 'email.bulk', 'email.setari']) ? (
        <div className="space-y-0.5 border-t pt-2">
          {can('email.sabloane') ? item({ kind: 'templates' }, <FileEdit className="h-4 w-4" />, t('email:sidebar.templates')) : null}
          {can('email.bulk') ? (
            <>
              {item({ kind: 'bulk' }, <Megaphone className="h-4 w-4" />, t('email:sidebar.bulk'))}
              {item({ kind: 'sequences' }, <Repeat className="h-4 w-4" />, t('email:sidebar.sequences'))}
            </>
          ) : null}
          {can('email.setari') ? item({ kind: 'settings' }, <SettingsIcon className="h-4 w-4" />, t('common:nav.settings')) : null}
        </div>
      ) : null}

      {can('email.bulk') ? (
        <div className="border-t pt-2">
          <SendQuotaIndicator />
        </div>
      ) : null}
    </div>
  )
}
