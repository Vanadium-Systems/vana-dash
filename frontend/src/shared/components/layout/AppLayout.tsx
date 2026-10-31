import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, Building2, Download, Ellipsis, Inbox, LifeBuoy, LogOut, Megaphone, PanelLeftClose, PanelLeftOpen, Search, User, X } from 'lucide-react'
import { guideRouteOf } from '@/modules/help/guides'
import { useSupportUnread } from '@/modules/support/support-api'
import { isUnseen, visibleReleases } from '@/modules/updates/releases'
import { Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CommandPalette, PALETTE_SHORTCUT } from '@/shared/components/CommandPalette'
import { OfflineBanner } from '@/shared/components/OfflineBanner'
import { ShortcutsHelp } from '@/shared/components/ShortcutsHelp'
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
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { useInstallPrompt } from '@/shared/hooks/use-install-prompt'
import { useNavLayout } from '@/shared/hooks/use-nav-layout'
import { useOfflinePrefetch } from '@/shared/hooks/use-offline-prefetch'
import { useOnline } from '@/shared/hooks/use-online'
import { isNative } from '@/shared/lib/native'
import { clearReadEmailNotifications, onNativeNotificationTap, registerNativeDeviceToken } from '@/shared/lib/native-push'
import { MOBILE_BOTTOM_TOS, NAV_GROUP_ORDER, findNavItem, navGroupLabel } from '@/shared/lib/nav-items'
import { BrandMark } from '@/shared/components/BrandMark'
import { ContentSkeleton } from '@/shared/components/layout/ShellSkeleton'
import { BottomSheet } from '@/shared/components/ui/responsive-menu'
import { prefetchPage } from '@/shared/lib/prefetch'
import { isPlainClick, markRouteCommitted, navigateWithTransition } from '@/shared/lib/view-transition'
import { sessionUserName } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'
import { getTenantOverride, setTenantOverride } from '@/shared/lib/tenant-override'

// Shell-ul nou (Contractul F, sprint UI remake 2026-08-25): sidebar cu nav grupat pe etichete
// mici, iteme compacte h-8, stare activă = fundal muted + text foreground; footer curat cu
// user/temă/logout. Mobil (Contractul H): bottom nav fix cu 4 shortcut-uri + "Mai mult" care
// deschide drawer-ul complet — o singură sursă NAV (nav-items.ts + config din Setări).

function NavBadge({ count, compact }: { count: number; compact?: boolean }) {
  if (compact) return <span aria-hidden="true" className="absolute right-1.5 top-1 size-2 rounded-full bg-destructive" />
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
  compact,
}: {
  items: ReturnType<typeof useNavLayout>['items']
  unreadTotal: number | undefined
  chatUnread: number | undefined
  activeAlerts: number | undefined
  onNavigate?: () => void
  compact: boolean
}) {
  const location = useLocation()
  const navLink = useNavLinkProps()
  const groups = NAV_GROUP_ORDER.map((group) => [group, items.filter((i) => i.group === group)] as const)

  return (
    <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
      {groups
        .filter(([, groupItems]) => groupItems.length > 0)
        .map(([group, groupItems], sectionIndex) => (
          <div key={group} className={cn(sectionIndex > 0 && 'mt-4')}>
            {compact ? null : <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{navGroupLabel(group)}</div>}
            {groupItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={compact ? item.label : undefined}
                {...navLink(item.to, onNavigate)}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-control-md items-center gap-2.5 rounded-sm px-2 text-sm',
                    compact && 'justify-center',
                    isActive || item.activeOn?.some((prefix) => location.pathname.startsWith(prefix))
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className={compact ? 'sr-only' : 'truncate'}>{item.label}</span>
                {item.to === '/email' && unreadTotal ? <NavBadge count={unreadTotal} compact={compact} /> : null}
                {item.to === '/messages' && chatUnread ? <NavBadge count={chatUnread} compact={compact} /> : null}
                {item.to === '/alerts' && activeAlerts ? <NavBadge count={activeAlerts} compact={compact} /> : null}
              </NavLink>
            ))}
          </div>
        ))}
    </nav>
  )
}

/**
 * Hover or focus loads the page ahead of the click; a plain click cross-fades into it. Ctrl / middle
 * click keep the browser's own behaviour (new tab).
 */
function useNavLinkProps() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { can } = useMe()
  return (to: string, onNavigate?: () => void) => {
    const prefetch = () => prefetchPage(to, queryClient, can)
    return {
      onMouseEnter: prefetch,
      onFocus: prefetch,
      onTouchStart: prefetch,
      onClick: (e: React.MouseEvent) => {
        onNavigate?.()
        if (!isPlainClick(e)) return
        e.preventDefault()
        navigateWithTransition(() => navigate(to))
      },
    }
  }
}

// Narrower than this, the sidebar shows icons only (T6): a 768-1023px screen keeps its width for content.
const wideQuery = window.matchMedia?.('(min-width: 1024px)')
const COLLAPSED_KEY = 'vana-dash-sidebar-collapsed'

function useSidebarCompact() {
  const wide = useSyncExternalStore(
    (onChange) => {
      wideQuery?.addEventListener('change', onChange)
      return () => wideQuery?.removeEventListener('change', onChange)
    },
    () => wideQuery?.matches ?? true,
  )
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')
  const toggle = () => {
    setCollapsed((current) => {
      localStorage.setItem(COLLAPSED_KEY, current ? '0' : '1')
      return !current
    })
  }
  return { compact: !wide || collapsed, canToggle: wide, collapsed, toggle }
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
  const sidebar = useSidebarCompact()
  const navLink = useNavLinkProps()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
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
  // Wide working tables get the whole width, so a desktop shows their secondary columns too.
  const isFullWidthPage = ['/email', '/messages', '/pricing', '/tenders'].some((path) => location.pathname.startsWith(path))
  // Într-o conversație, pe telefon, firul ocupă tot ecranul; bara de jos ar acoperi câmpul de scris.
  const inConversation = /^\/messages\/[^/]+/.test(location.pathname)

  // Montat o singură dată per sesiune (AppLayout rămâne montat peste navigare) — la boot și
  // la fiecare revenire online.
  useOfflinePrefetch(online)

  // <main> stays mounted across routes, so without this a new page keeps the old scroll position.
  // scrollTop instead of scrollTo(): the same in every WebView, and jsdom (tests) has it too.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [location.pathname])

  useLayoutEffect(() => markRouteCommitted(), [location.pathname])

  // Token FCM al APK-ului (Contract C) — doar în shell-ul nativ, doar autentificat.
  useEffect(() => {
    if (user) void registerNativeDeviceToken()
  }, [user])

  useEffect(() => onNativeNotificationTap((path) => navigate(path)), [navigate])

  // Emails read on another device: their notifications go when the app comes back to the front.
  useEffect(() => {
    if (!user) return
    void clearReadEmailNotifications()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void clearReadEmailNotifications()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user])

  // Un 403 FEATURE_FORBIDDEN înseamnă că rolul i-a fost schimbat sub om: reîncărcăm `/me`
  // ca nav-ul, tab-urile și butoanale să dispară fără reîncărcarea paginii (PLAN.md C2).
  useEffect(() => {
    onForbiddenRefreshMe(async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    })
  }, [queryClient])

  useHotkeys([
    {
      keys: 'mod+k',
      label: t('common:shortcuts.search'),
      allowInInputs: true,
      onKey: (e) => {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      },
    },
  ])

  const renderSidebarContent = (onClose?: () => void, compact = false) => (
    <>
      <div className={cn('flex h-14 items-center gap-2.5 border-b px-3', compact && 'justify-center px-0')}>
        <BrandMark className="h-7 w-7" />
        {compact ? null : <span className="font-semibold">VanaDash</span>}
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
          title={compact ? `${t('common:actions.search')} (${PALETTE_SHORTCUT})` : undefined}
          className={cn(
            'flex h-control-md w-full items-center gap-2 rounded-md border border-border px-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            compact && 'justify-center',
          )}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className={compact ? 'sr-only' : undefined}>{t('common:actions.search')}</span>
          {compact ? null : <kbd className="ml-auto hidden font-sans text-xs md:inline">{PALETTE_SHORTCUT}</kbd>}
        </button>
      </div>
      <SidebarNav
        items={navItems.items}
        unreadTotal={unreadCounts.data?.total}
        chatUnread={chatUnread || undefined}
        activeAlerts={activeAlertsCount.data?.count}
        onNavigate={onClose}
        compact={compact}
      />
      <div className={cn('border-t p-3', compact && 'flex flex-col items-center gap-2 px-1')}>
        {canInstall && !compact ? (
          <Button variant="outline" className="mb-2 w-full" onClick={promptInstall}>
            <Download className="h-4 w-4" />
            {t('common:shell.installApp')}
          </Button>
        ) : null}
        <div className={compact ? undefined : 'mb-2'}>
          <ThemeToggle compact={compact} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent', compact && 'justify-center px-1')}>
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {initials}
              {helpUnread > 0 ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive" aria-hidden="true" /> : null}
            </span>
            <span className={compact ? 'sr-only' : 'min-w-0 flex-1'}>
              <span className="block truncate text-sm">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            </span>
            {helpUnread > 0 ? <span className="sr-only">{t('common:shell.unreadInHelp')}</span> : null}
            {compact ? null : <Ellipsis className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
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
        {!onClose && sidebar.canToggle ? (
          <button
            type="button"
            onClick={sidebar.toggle}
            title={compact ? t('common:shell.expandSidebar') : undefined}
            className={cn(
              'mt-1 flex h-control-md w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
              compact && 'justify-center',
            )}
          >
            {compact ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
            <span className={compact ? 'sr-only' : undefined}>{compact ? t('common:shell.expandSidebar') : t('common:shell.collapseSidebar')}</span>
          </button>
        ) : null}
      </div>
    </>
  )

  return (
    <ConfirmProvider>
    <div className="flex min-h-screen">
      {isNative ? <PullToRefresh /> : null}
      {/* Desktop: sidebar lipit pe înălțimea ecranului, cu scroll propriu; documentul rămâne containerul de scroll. */}
      <aside className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-card md:flex', sidebar.compact ? 'w-14' : 'w-[232px]')}>
        {renderSidebarContent(undefined, sidebar.compact)}
      </aside>

      {/* Mobil: drawer deschis din "Mai mult" (bottom nav) — al doilea apăsare îl închide.
          safe-top = sub bara de notificări (S24+); padding jos = bottom nav (h-16) + safe area,
          altfel footer-ul cu temă/logout stă sub el. */}
      {/* "Mai mult" rises from the bottom bar, within reach of the thumb, and closes with a swipe
          down, a tap outside or Back (MA3, D43). */}
      <BottomSheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('common:actions.more')}>
        <div className="flex flex-col md:hidden">{renderSidebarContent(() => setDrawerOpen(false))}</div>
      </BottomSheet>

      {isNative ? (
        // The status bar is transparent over the WebView; this keeps scrolled content from showing under it.
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top,0px)] bg-background" />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <main ref={mainRef} className="safe-top flex-1 overflow-auto pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
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
          {/* Only the content waits for a page's code; the bar and the nav stay (MA10). */}
          <div className={cn('p-4 md:p-6', isFullWidthPage ? '' : 'mx-auto max-w-6xl')} style={{ viewTransitionName: 'page' }}>
            <Suspense fallback={<ContentSkeleton />}>
              <Outlet />
            </Suspense>
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
                {...navLink(to)}
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
      <ShortcutsHelp />
    </div>
    </ConfirmProvider>
  )
}
