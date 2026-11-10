import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { useMarkNotificationsRead, useNotifications, type AppNotification } from '@/shared/hooks/use-notifications'
import { formatNumber, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

/** The unread count is a weighted number, not a red dot: a mention is worth reading, not an alarm. */
export function NotificationBell({ className }: { className?: string }) {
  const navigate = useNavigate()
  const query = useNotifications()
  const markRead = useMarkNotificationsRead()
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? []
  const unread = query.data?.pages[0]?.unread ?? 0

  const open = (item: AppNotification) => {
    if (!item.readAt) markRead.mutate({ ids: [item.id] })
    // Only in-app paths: the url is text written on the server, never a place to leave the app for.
    if (item.url?.startsWith('/')) navigate(item.url)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'relative inline-flex h-control-md w-control-md shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          unread > 0 && 'text-foreground',
          className,
        )}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 ? (
          <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border bg-background px-1 tnum text-xs font-semibold text-foreground">
            {unread > 99 ? '99+' : formatNumber(unread)}
          </span>
        ) : null}
        <span className="sr-only">{unread > 0 ? t('common:notifications.openUnread', { count: unread, n: formatNumber(unread) }) : t('common:notifications.open')}</span>
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={t('common:notifications.title')} align="start">
        <div className="w-[min(22rem,calc(100vw-2rem))] max-w-full">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-sm font-medium">{t('common:notifications.title')}</span>
            <Button type="button" size="sm" variant="ghost" disabled={unread === 0 || markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
              {t('common:notifications.markAll')}
            </Button>
          </div>
          {query.isPending ? <p className="px-2 py-3 text-sm text-muted-foreground">{t('common:states.loading')}</p> : null}
          {query.isError ? <p className="px-2 py-3 text-sm text-muted-foreground">{t('common:notifications.loadFailed')}</p> : null}
          {query.isSuccess && rows.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t('common:notifications.empty')}</p> : null}
          <div className="max-h-96 overflow-y-auto">
            {rows.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => open(item)} className="items-start">
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm', item.readAt ? 'text-muted-foreground' : 'font-semibold')}>
                    {item.readAt ? null : <span className="sr-only">{t('common:notifications.unread')} </span>}
                    {item.title}
                  </span>
                  {item.body ? <span className="line-clamp-2 block text-xs text-muted-foreground">{item.body}</span> : null}
                  <span className="block text-xs text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
                </span>
                {item.readAt ? null : <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" />}
              </DropdownMenuItem>
            ))}
          </div>
          {query.hasNextPage ? (
            <div className="px-2 py-1">
              <Button type="button" size="sm" variant="ghost" className="w-full" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {t('common:notifications.more')}
              </Button>
            </div>
          ) : null}
        </div>
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}
