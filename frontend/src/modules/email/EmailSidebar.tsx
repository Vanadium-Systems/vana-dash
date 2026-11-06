import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  Clock,
  FileEdit,
  Inbox,
  Layers,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Repeat,
  Send,
  Settings as SettingsIcon,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  UserCog,
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
  | { kind: 'mysettings' }

interface NavItemProps {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
  unreadCount?: number
  rail: boolean
}

function NavItem({ active, icon, label, onClick, unreadCount, rail }: NavItemProps) {
  const count = unreadCount ? (unreadCount > 99 ? '99+' : String(unreadCount)) : null
  const name = unreadCount ? t('email:sidebar.itemUnread', { label, count: unreadCount }) : label
  if (rail) {
    return (
      <button
        onClick={onClick}
        title={name}
        aria-label={name}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex w-full flex-col items-center gap-0.5 rounded-md py-1.5 transition-colors',
          active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {icon}
        {count ? <span className="text-xs leading-none tabular-nums text-muted-foreground">{count}</span> : null}
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-muted font-medium text-foreground' : 'hover:bg-muted hover:text-foreground',
        !active && (unreadCount ? 'font-semibold text-foreground' : 'text-muted-foreground'),
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span> : null}
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
  collapsed = false,
  onToggleCollapsed,
}: {
  current: EmailView
  onNavigate: (view: EmailView) => void
  onCompose: () => void
  // Rail of icons on desktop; the drawer on a phone never passes these.
  collapsed?: boolean
  onToggleCollapsed?: () => void
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
      rail={collapsed}
      onClick={() => onNavigate(view)}
    />
  )

  return (
    <div className={cn('flex flex-col gap-4', collapsed ? 'w-14 shrink-0' : 'w-full md:w-52 md:shrink-0')}>
      {onToggleCollapsed ? (
        <Button
          variant="ghost"
          size="icon"
          className={cn('hidden md:inline-flex', collapsed ? 'self-center' : 'self-end')}
          title={collapsed ? t('email:sidebar.expand') : t('email:sidebar.collapse')}
          aria-label={collapsed ? t('email:sidebar.expand') : t('email:sidebar.collapse')}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      ) : null}

      {can('email.trimitere') ? (
        collapsed ? (
          <Button size="icon" className="self-center" title={t('email:compose.titleWithKey')} aria-label={t('email:compose.title')} onClick={onCompose}>
            <PenLine className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="w-full" title={t('email:compose.titleWithKey')} onClick={onCompose}>
            <PenLine className="h-4 w-4" />
            {t('email:compose.title')}
            {/* The key is shown where there is a keyboard; ? lists the others. */}
            <kbd className="ml-auto hidden rounded border border-current/30 px-1.5 font-sans text-xs opacity-70 [@media(hover:hover)_and_(pointer:fine)]:inline">C</kbd>
          </Button>
        )
      ) : null}

      <nav className="space-y-0.5">
        {item({ kind: 'mailbox', folder: 'inbox' }, <Inbox className="h-4 w-4" />, t('email:folders.inbox'), unreadCounts.data?.inbox)}
        {item({ kind: 'mailbox', starred: true }, <Star className="h-4 w-4" />, t('email:folders.starred'))}
        {item({ kind: 'mailbox', snoozed: true }, <Clock className="h-4 w-4" />, t('email:folders.snoozed'))}
        {item({ kind: 'drafts' }, <FileEdit className="h-4 w-4" />, t('email:folders.drafts'))}
        {can('email.trimitere') ? item({ kind: 'sent' }, <Send className="h-4 w-4" />, t('email:folders.sent')) : null}
        {item({ kind: 'mailbox', folder: 'archive' }, <Archive className="h-4 w-4" />, t('email:folders.archive'))}
        {item({ kind: 'mailbox', folder: 'spam' }, <ShieldAlert className="h-4 w-4" />, t('email:folders.spam'), unreadCounts.data?.spam)}
        {item({ kind: 'mailbox', folder: 'trash' }, <Trash2 className="h-4 w-4" />, t('email:folders.trash'))}
        {item({ kind: 'mailbox', folder: 'all' }, <Layers className="h-4 w-4" />, t('email:folders.all'))}
      </nav>

      {labels.data?.length ? (
        <div className="space-y-0.5">
          {collapsed ? null : <p className="px-3 text-xs text-muted-foreground">{t('email:labels.labels')}</p>}
          {labels.data.map((label) =>
            item({ kind: 'mailbox', labelId: label.id }, <Tag className="h-4 w-4" style={{ color: label.color ?? undefined }} />, label.name),
          )}
        </div>
      ) : null}

      {/* Fiecare view are functionalitatea lui (PLAN.md C2): ce nu e pornit nu există
          pentru omul ăsta, nici măcar ca link. */}
      {canAny(['email.sabloane', 'email.bulk', 'email.setari', 'email.setari_proprii']) ? (
        <div className="space-y-0.5 border-t pt-2">
          {can('email.sabloane') ? item({ kind: 'templates' }, <FileEdit className="h-4 w-4" />, t('email:sidebar.templates')) : null}
          {can('email.bulk') ? (
            <>
              {item({ kind: 'bulk' }, <Megaphone className="h-4 w-4" />, t('email:sidebar.bulk'))}
              {item({ kind: 'sequences' }, <Repeat className="h-4 w-4" />, t('email:sidebar.sequences'))}
            </>
          ) : null}
          {can('email.setari_proprii') ? item({ kind: 'mysettings' }, <UserCog className="h-4 w-4" />, t('email:mySettings.title')) : null}
          {can('email.setari') ? item({ kind: 'settings' }, <SettingsIcon className="h-4 w-4" />, t('email:sidebar.companySettings')) : null}
        </div>
      ) : null}

      {can('email.bulk') && !collapsed ? (
        <div className="border-t pt-2">
          <SendQuotaIndicator />
        </div>
      ) : null}
    </div>
  )
}
