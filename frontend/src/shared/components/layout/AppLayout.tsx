import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, Building2, Download, Ellipsis, Inbox, LifeBuoy, LogOut, Megaphone, Search, User, X } from 'lucide-react'
import { guideRouteOf } from '@/modules/help/guides'
import { useSupportUnread } from '@/modules/support/support-api'
import { isUnseen, visibleReleases } from '@/modules/updates/releases'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CommandPalette, PALETTE_SHORTCUT } from '@/shared/components/CommandPalette'
import { OfflineBanner } from '@/shared/components/OfflineBanner'
import { PullToRefresh } from '@/shared/components/PullToRefresh'
import { ThemeToggle } from '@/shared/components/ThemeToggle'
import { Button } from '@/shared/components/ui/button'
import { ConfirmProvider } from '@/shared/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { onForbiddenRefreshMe } from '@/shared/lib/api'
import { useActiveAlertsCount } from '@/shared/hooks/use-active-alerts-count'
import { useChatUnreadTotal } from '@/shared/hooks/use-chat'
import { useAuth, useLogout } from '@/shared/hooks/use-auth'
import { ME_QUERY_KEY, useMe } from '@/shared/hooks/use-me'
import { useEmailUnreadCounts } from '@/shared/hooks/use-email-unread-counts'
import { useInstallPrompt } from '@/shared/hooks/use-install-prompt'
import { useNavLayout } from '@/shared/hooks/use-nav-layout'
import { useOfflinePrefetch } from '@/shared/hooks/use-offline-prefetch'
import { useOnline } from '@/shared/hooks/use-online'
import { isNative } from '@/shared/lib/native'
import { registerNativeDeviceToken } from '@/shared/lib/native-push'
import { MOBILE_BOTTOM_TOS, NAV_GROUP_ORDER, findNavItem, navGroupLabel } from '@/shared/lib/nav-items'
import { BrandMark } from '@/shared/components/BrandMark'
import { sessionUserName } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'
import { getTenantOverride, setTenantOverride } from '@/shared/lib/tenant-override'

// Shell-ul nou (Contractul F, sprint UI remake 2026-08-25): sidebar cu nav grupat pe etichete
// mici, iteme compacte h-8, stare activă = fundal muted + text foreground; footer curat cu
// user/temă/logout. Mobil (Contractul H): bottom nav fix cu 4 shortcut-uri + "Mai mult" care
// deschide drawer-ul complet — o singură sursă NAV (nav-items.ts + config din Setări).

function NavBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 tnum text-xs font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function SidebarNav({
  items,
  unreadTotal,
  chatUnread,
  activeAlerts,
  onNavigate,
}: {
  items: ReturnType<typeof useNavLayout>['items']
  unreadTotal: number | undefined
  chatUnread: number | undefined
  activeAlerts: number | undefined
  onNavigate?: () => void
}) {
  const location = useLocation()
  const groups = NAV_GROUP_ORDER.map((group) => [group, items.filter((i) => i.group === group)] as const)

  return (
    <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
      {groups
        .filter(([, groupItems]) => groupItems.length > 0)
        .map(([group, groupItems], sectionIndex) => (
          <div key={group} className={cn(sectionIndex > 0 && 'mt-4')}>
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{navGroupLabel(group)}</div>
            {groupItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex h-control-md items-center gap-2.5 rounded-sm px-2 text-sm',
                    isActive || item.activeOn?.some((prefix) => location.pathname.startsWith(prefix))
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {item.to === '/email' && unreadTotal ? <NavBadge count={unreadTotal} /> : null}
                {item.to === '/messages' && chatUnread ? <NavBadge count={chatUnread} /> : null}
                {item.to === '/alerts' && activeAlerts ? <NavBadge count={activeAlerts} /> : null}
              </NavLink>
            ))}
          </div>
        ))}
    </nav>
  )
}

/** Numărul din dreapta unui item de meniu; textul pentru cititorul de ecran spune ce numără. */
function MenuCount({ count, label }: { count: number | null | undefined; label: string }) {
  if (!count) return null
  return (
    <span className="ml-auto tnum text-xs text-muted-foreground">
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  )
}

export function AppLayout() {
  const queryClient = useQueryClient()
  const { user, session } = useAuth()
  const logout = useLogout()
  const location = useLocation()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const navItems = useNavLayout()
  const unreadCounts = useEmailUnreadCounts()
  const chatUnread = useChatUnreadTotal()
  const activeAlertsCount = useActiveAlertsCount()
  const { can } = useMe()
  const { canInstall, promptInstall } = useInstallPrompt()
  const online = useOnline()
  const supportUnread = useSupportUnread()
  const tenantOverride = getTenantOverride()
  const unseenUpdates = session ? visibleReleases(can).filter((release) => isUnseen(release, session.updatesSeenAt)).length : 0
  const helpUnread = unseenUpdates + (supportUnread.data?.mine ?? 0) + (supportUnread.data?.platform ?? 0)

  const name = sessionUserName(session)
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  // Email are nevoie de tot lățimea disponibilă (listă + reading pane, ca un client de mail
  // real) — constrângerea de lățime lăsa reading pane-ul îngust pe orice monitor. Mesaje au
  // nevoie de altfel: coloană de conversații + fir, deci ocupă lățimea tot. Restul modulelor
  // rămân pe max-w-6xl.
  const isFullWidthPage = location.pathname.startsWith('/email') || location.pathname.startsWith('/messages')
  // Într-o conversație, pe telefon, firul ocupă tot ecranul; bara de jos ar acoperi câmpul de scris.
  const inConversation = /^\/messages\/[^/]+/.test(location.pathname)

  // Montat o singură dată per sesiune (AppLayout rămâne montat peste navigare) — la boot și
  // la fiecare revenire online.
  useOfflinePrefetch(online)

  // Token FCM al APK-ului (Contract C) — doar în shell-ul nativ, doar autentificat.
  useEffect(() => {
    if (user) void registerNativeDeviceToken()
  }, [user])

  // Un 403 FEATURE_FORBIDDEN înseamnă că rolul i-a fost schimbat sub om: reîncărcăm `/me`
  // ca nav-ul, tab-urile și butoanale să dispară fără reîncărcarea paginii (PLAN.md C2).
  useEffect(() => {
    onForbiddenRefreshMe(async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    })
  }, [queryClient])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const renderSidebarContent = (onClose?: () => void) => (
    <>
      <div className="flex h-14 items-center gap-2.5 border-b px-3">
        <BrandMark className="h-7 w-7" />
        <span className="font-semibold">VanaDash</span>
        {onClose ? (
          <button
            className="touch-target -mr-1 ml-auto flex items-center justify-center rounded-sm p-1 hover:bg-accent"
            onClick={onClose}
          >
            <span className="sr-only">{t('common:shell.closeMenu')}</span>
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={() => {
            onClose?.()
            setPaletteOpen(true)
          }}
          className="flex h-control-md w-full items-center gap-2 rounded-md border border-border px-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('common:actions.search')}
          <kbd className="ml-auto hidden font-sans text-xs md:inline">{PALETTE_SHORTCUT}</kbd>
        </button>
      </div>
      <SidebarNav
        items={navItems.items}
        unreadTotal={unreadCounts.data?.total}
        chatUnread={chatUnread || undefined}
        activeAlerts={activeAlertsCount.data?.count}
        onNavigate={onClose}
      />
      <div className="border-t p-3">
        {canInstall ? (
          <Button variant="outline" className="mb-2 w-full" onClick={promptInstall}>
            <Download className="h-4 w-4" />
            {t('common:shell.installApp')}
          </Button>
        ) : null}
        <div className="mb-2">
          <ThemeToggle />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent">
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {initials}
              {helpUnread > 0 ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive" aria-hidden="true" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            </span>
            {helpUnread > 0 ? <span className="sr-only">{t('common:shell.unreadInHelp')}</span> : null}
            <Ellipsis className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => navigate('/me')}>
              <User className="h-4 w-4" aria-hidden="true" />
              {t('common:nav.myProfile')}
            </DropdownMenuItem>
            {/* Ajutor: trei pagini rare, ținute în meniul contului ca să nu ocupe nav-ul. */}
            <DropdownMenuItem onClick={() => navigate('/support', { state: { from: guideRouteOf(location.pathname) } })}>
              <LifeBuoy className="h-4 w-4" aria-hidden="true" />
              {t('common:nav.support')}
              <MenuCount count={supportUnread.data?.mine} label={t('common:shell.withUnreadReply')} />
            </DropdownMenuItem>
            {session?.isPlatformAdmin ? (
              <DropdownMenuItem onClick={() => navigate('/platform/support')}>
                <Inbox className="h-4 w-4" aria-hidden="true" />
                {t('common:shell.supportTickets')}
                <MenuCount count={supportUnread.data?.platform} label={t('common:shell.unread')} />
              </DropdownMenuItem>
            ) : null}
            {session?.isPlatformAdmin ? (
              <DropdownMenuItem onClick={() => navigate('/platform/tenants')}>
                <Building2 className="h-4 w-4" aria-hidden="true" />
                {t('tenants:title')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => navigate('/help')}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              {t('common:nav.guides')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/updates')}>
              <Megaphone className="h-4 w-4" aria-hidden="true" />
              {t('common:nav.updates')}
              <MenuCount count={unseenUpdates} label={t('common:shell.new')} />
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => logout.mutate()}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {t('common:shell.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )

  return (
    <ConfirmProvider>
    <div className="flex min-h-screen">
      {isNative ? <PullToRefresh /> : null}
      {/* Desktop: sidebar lipit pe înălțimea ecranului, cu scroll propriu; documentul rămâne containerul de scroll. */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r bg-card md:flex">{renderSidebarContent()}</aside>

      {/* Mobil: drawer deschis din "Mai mult" (bottom nav) — al doilea apăsare îl închide.
          safe-top = sub bara de notificări (S24+); padding jos = bottom nav (h-16) + safe area,
          altfel footer-ul cu temă/logout stă sub el. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <aside className="safe-top relative flex h-full w-64 flex-col border-r bg-card pb-[calc(4rem+env(safe-area-inset-bottom,0px))]">{renderSidebarContent(() => setDrawerOpen(false))}</aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="safe-top flex-1 overflow-auto pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          {!online ? (
            <div className="px-4 pt-4 md:px-6 md:pt-6">
              <OfflineBanner visible={!online} />
            </div>
          ) : null}
          {tenantOverride ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 bg-warning/15 px-4 py-2 text-sm md:px-6">
              <span>{t('tenants:banner.text', { name: tenantOverride.name })}</span>
              <Button variant="outline" size="sm" onClick={() => setTenantOverride(null)}>
                {t('tenants:banner.back')}
              </Button>
            </div>
          ) : null}
          <div className={cn('p-4 md:p-6', isFullWidthPage ? '' : 'mx-auto max-w-6xl')}>
            <Outlet />
          </div>
        </main>

        {/* Bottom nav mobil (Contractul H) — safe area jos, touch targets ≥44px prin .touch-target.
            Ascuns când se tastează (QoL Asistent, 2026-08-26): regula CSS body:has(:focus) din index.css. */}
        <nav
          className={cn(
            'safe-bottom mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid-cols-5 border-t bg-card md:hidden',
            inConversation ? 'hidden' : 'grid',
          )}
        >
          {MOBILE_BOTTOM_TOS.map((to) => {
            const item = findNavItem(to)
            // Un shortcut fără funcționalitate nu apare; dacă omul are un singur shortcut
            // (ex. doar Azi), grila rămâne 5 coloane și el ocupă doar prima.
            if (!item || !can(item.feature)) return null
            const Icon = item.icon
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn('relative flex h-16 w-full flex-col items-center justify-center gap-1 text-xs', isActive ? 'text-foreground' : 'text-muted-foreground')
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className={cn(isActive && 'font-medium')}>{item.label}</span>
                    {to === '/email' && unreadCounts.data?.total ? (
                      <span className="absolute right-[22%] top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 tnum text-xs font-semibold text-white">
                        {unreadCounts.data.total > 99 ? '99+' : unreadCounts.data.total}
                      </span>
                    ) : null}
                    {to === '/messages' && chatUnread ? (
                      <span className="absolute right-[22%] top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 tnum text-xs font-semibold text-white">
                        {chatUnread > 99 ? '99+' : chatUnread}
                      </span>
                    ) : null}
                    {isActive ? <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary" /> : null}
                  </>
                )}
              </NavLink>
            )
          })}
          <button
            type="button"
            className="flex h-16 w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Ellipsis className="h-5 w-5" strokeWidth={1.8} />
            {t('common:actions.more')}
          </button>
        </nav>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
    </ConfirmProvider>
  )
}
