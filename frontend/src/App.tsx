import { lazy, Suspense, useEffect } from 'react'
import { listenNativeBack } from '@/shared/lib/native-back'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { RequireFeature } from '@/shared/components/AccessDenied'
import { ChatStreamProvider } from '@/shared/components/chat/ChatStreamProvider'
import { AppLayout } from '@/shared/components/layout/AppLayout'
import { LinkedSection, RedirectToTab, TabbedSection } from '@/shared/components/layout/PageSection'
import { useAuth } from '@/shared/hooks/use-auth'
import { useShareIn } from '@/shared/lib/share-in'
import { setCompanyTimeZone } from '@/shared/lib/format'
import { syncLocaleWithProfile, t } from '@/shared/lib/i18n'
import { registerPageCode } from '@/shared/lib/prefetch'
import { ShellSkeleton } from '@/shared/components/layout/ShellSkeleton'

const loadAccountingPage = () => import('@/modules/accounting/AccountingPage')
const AccountingPage = lazy(() => loadAccountingPage().then((m) => ({ default: m.AccountingPage })))
const loadAlertsPage = () => import('@/modules/alerts/AlertsPage')
const AlertsPage = lazy(() => loadAlertsPage().then((m) => ({ default: m.AlertsPage })))
const loadArchivePage = () => import('@/modules/archive/ArchivePage')
const ArchivePage = lazy(() => loadArchivePage().then((m) => ({ default: m.ArchivePage })))
const loadAssetsPage = () => import('@/modules/assets/AssetsPage')
const AssetsPage = lazy(() => loadAssetsPage().then((m) => ({ default: m.AssetsPage })))
const loadAssetDetailPage = () => import('@/modules/assets/AssetDetailPage')
const AssetDetailPage = lazy(() => loadAssetDetailPage().then((m) => ({ default: m.AssetDetailPage })))
const loadAssistantPage = () => import('@/modules/assistant/AssistantPage')
const AssistantPage = lazy(() => loadAssistantPage().then((m) => ({ default: m.AssistantPage })))
const loadAcceptInvitePage = () => import('@/modules/auth/AcceptInvitePage')
const AcceptInvitePage = lazy(() => loadAcceptInvitePage().then((m) => ({ default: m.AcceptInvitePage })))
const loadForgotPasswordPage = () => import('@/modules/auth/ForgotPasswordPage')
const ForgotPasswordPage = lazy(() => loadForgotPasswordPage().then((m) => ({ default: m.ForgotPasswordPage })))
const loadLoginPage = () => import('@/modules/auth/LoginPage')
const LoginPage = lazy(() => loadLoginPage().then((m) => ({ default: m.LoginPage })))
const loadResetPasswordPage = () => import('@/modules/auth/ResetPasswordPage')
const ResetPasswordPage = lazy(() => loadResetPasswordPage().then((m) => ({ default: m.ResetPasswordPage })))
const loadCalendarPage = () => import('@/modules/calendar/CalendarPage')
const CalendarPage = lazy(() => loadCalendarPage().then((m) => ({ default: m.CalendarPage })))
const loadCallsPage = () => import('@/modules/calls/CallsPage')
const CallsPage = lazy(() => loadCallsPage().then((m) => ({ default: m.CallsPage })))
const loadCallRoomPage = () => import('@/modules/calls/CallRoomPage')
const CallRoomPage = lazy(() => loadCallRoomPage().then((m) => ({ default: m.CallRoomPage })))
const loadPublicCallPage = () => import('@/modules/calls/PublicCallPage')
const PublicCallPage = lazy(() => loadPublicCallPage().then((m) => ({ default: m.PublicCallPage })))
const loadCryptoPage = () => import('@/modules/crypto/CryptoPage')
const CryptoPage = lazy(() => loadCryptoPage().then((m) => ({ default: m.CryptoPage })))
const loadCoinDetailPage = () => import('@/modules/crypto/CoinDetailPage')
const CoinDetailPage = lazy(() => loadCoinDetailPage().then((m) => ({ default: m.CoinDetailPage })))
const loadEmailPage = () => import('@/modules/email/EmailPage')
const EmailPage = lazy(() => loadEmailPage().then((m) => ({ default: m.EmailPage })))
const loadFinancialsPage = () => import('@/modules/financials/FinancialsPage')
const FinancialsPage = lazy(() => loadFinancialsPage().then((m) => ({ default: m.FinancialsPage })))
const loadMessagesPage = () => import('@/modules/messages/MessagesPage')
const MessagesPage = lazy(() => loadMessagesPage().then((m) => ({ default: m.MessagesPage })))
const loadSystemHealthPage = () => import('@/modules/monitoring/SystemHealthPage')
const SystemHealthPage = lazy(() => loadSystemHealthPage().then((m) => ({ default: m.SystemHealthPage })))
const loadNotesPage = () => import('@/modules/notes/NotesPage')
const NotesPage = lazy(() => loadNotesPage().then((m) => ({ default: m.NotesPage })))
const loadOverviewPage = () => import('@/modules/overview/OverviewPage')
const OverviewPage = lazy(() => loadOverviewPage().then((m) => ({ default: m.OverviewPage })))
const loadPlanPage = () => import('@/modules/plan/PlanPage')
const PlanPage = lazy(() => loadPlanPage().then((m) => ({ default: m.PlanPage })))
const loadPlatformsPage = () => import('@/modules/platforms/PlatformsPage')
const PlatformsPage = lazy(() => loadPlatformsPage().then((m) => ({ default: m.PlatformsPage })))
const loadPricingPage = () => import('@/modules/pricing/PricingPage')
const PricingPage = lazy(() => loadPricingPage().then((m) => ({ default: m.PricingPage })))
const loadReconciliationPage = () => import('@/modules/reconciliation/ReconciliationPage')
const ReconciliationPage = lazy(() => loadReconciliationPage().then((m) => ({ default: m.ReconciliationPage })))
const loadReportsPage = () => import('@/modules/reports/ReportsPage')
const ReportsPage = lazy(() => loadReportsPage().then((m) => ({ default: m.ReportsPage })))
const loadModulesPage = () => import('@/modules/access/ModulesPage')
const ModulesPage = lazy(() => loadModulesPage().then((m) => ({ default: m.ModulesPage })))
const loadProfilePage = () => import('@/modules/auth/ProfilePage')
const ProfilePage = lazy(() => loadProfilePage().then((m) => ({ default: m.ProfilePage })))
const loadTeamHistoryPage = () => import('@/modules/team/TeamHistoryPage')
const TeamHistoryPage = lazy(() => loadTeamHistoryPage().then((m) => ({ default: m.TeamHistoryPage })))
const loadTeamPage = () => import('@/modules/team/TeamPage')
const TeamPage = lazy(() => loadTeamPage().then((m) => ({ default: m.TeamPage })))
const loadSettingsPage = () => import('@/modules/settings/SettingsPage')
const SettingsPage = lazy(() => loadSettingsPage().then((m) => ({ default: m.SettingsPage })))
const loadTendersPage = () => import('@/modules/tenders/TendersPage')
const TendersPage = lazy(() => loadTendersPage().then((m) => ({ default: m.TendersPage })))
const loadTenantsPage = () => import('@/modules/tenants/TenantsPage')
const TenantsPage = lazy(() => loadTenantsPage().then((m) => ({ default: m.TenantsPage })))
const loadSupportPage = () => import('@/modules/support/SupportPage')
const SupportPage = lazy(() => loadSupportPage().then((m) => ({ default: m.SupportPage })))
const loadTicketPage = () => import('@/modules/support/TicketPage')
const TicketPage = lazy(() => loadTicketPage().then((m) => ({ default: m.TicketPage })))
const loadGuidesPage = () => import('@/modules/help/GuidesPage')
const GuidesPage = lazy(() => loadGuidesPage().then((m) => ({ default: m.GuidesPage })))
const loadUpdatesPage = () => import('@/modules/updates/UpdatesPage')
const UpdatesPage = lazy(() => loadUpdatesPage().then((m) => ({ default: m.UpdatesPage })))
const loadWishlistPage = () => import('@/modules/wishlist/WishlistPage')
const WishlistPage = lazy(() => loadWishlistPage().then((m) => ({ default: m.WishlistPage })))

// Hover / focus on a nav item loads the page's code ahead of the click (shared/lib/prefetch.ts).
registerPageCode('/', loadOverviewPage)
registerPageCode('/assistant', loadAssistantPage)
registerPageCode('/accounting', loadAccountingPage)
registerPageCode('/financials', loadFinancialsPage)
registerPageCode('/reconciliation', loadReconciliationPage)
registerPageCode('/pricing', loadPricingPage)
registerPageCode('/tenders', loadTendersPage)
registerPageCode('/crypto', loadCryptoPage)
registerPageCode('/email', loadEmailPage)
registerPageCode('/messages', loadMessagesPage)
registerPageCode('/calendar', loadCalendarPage)
registerPageCode('/calls', loadCallsPage)
registerPageCode('/archive', loadArchivePage)
registerPageCode('/notes', loadNotesPage)
registerPageCode('/team', loadTeamPage)
registerPageCode('/modules', loadModulesPage)
registerPageCode('/team/history', loadTeamHistoryPage)
registerPageCode('/alerts', loadAlertsPage)
registerPageCode('/platforms', loadPlatformsPage)
registerPageCode('/system-health', loadSystemHealthPage)
registerPageCode('/settings', loadSettingsPage)

const INVESTMENT_LINKS = [
  { to: '/crypto', label: t('common:nav.crypto') },
  { to: '/assets', label: t('common:nav.stocks') },
]

function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function RequireAuth() {
  const { isAuthenticated, isPending, session } = useAuth()
  useShareIn()
  // A copy of /me cached before this field existed has no language in it.
  useEffect(() => {
    if (session?.locale && session.enabledLocales) syncLocaleWithProfile(session.locale, session.enabledLocales)
  }, [session])
  // Before the pages render, so their dates come out in the company's zone. Idempotent, hence safe
  // in render; a /me cached before the field existed has no tenant zone and changes nothing.
  if (session?.tenant?.timeZone) setCompanyTimeZone(session.tenant.timeZone)
  // The shell's outline instead of a blank screen while the session loads (MA10).
  if (isPending) return <ShellSkeleton />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

export function App() {
  useEffect(() => listenNativeBack(), [])
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/apel/:publicId" element={<PublicCallPage />} />
        <Route element={<RequireAuth />}>
          {/* Provider-ul de flux stă deasupra lui AppLayout, nu în el: AppLayout folosește
              badge-ul de mesaje necitite, iar un context nu ajunge la propria componentă — pus
              în shell, ar arunca la fiecare pagină. */}
          <Route element={<ChatStreamProvider><Outlet /></ChatStreamProvider>}>
          <Route element={<AppLayout />}>
            <Route path="/accounting" element={<RequireFeature feature="facturi.view" page={t('common:nav.invoices')}><AccountingPage /></RequireFeature>} />
            <Route path="/archive" element={<RequireFeature feature="arhiva.view" page={t('common:nav.archive')}><ArchivePage /></RequireFeature>} />
            <Route path="/" element={<OverviewPage />} />
            <Route path="/assistant" element={<RequireFeature feature="asistent.view" page={t('common:nav.assistant')}><AssistantPage /></RequireFeature>} />
            <Route path="/platforms" element={<RequireFeature feature="platforme.view" page={t('common:nav.platforms')}><PlatformsPage /></RequireFeature>} />
            <Route
              path="/financials"
              element={
                <RequireFeature feature="financiar.view" page={t('common:nav.financials')}>
                <TabbedSection
                  title={t('common:nav.financials')}
                  tabs={[
                    { key: 'pnl', label: t('common:nav.profitAndLoss'), element: <FinancialsPage /> },
                    { key: 'rapoarte', label: t('common:nav.reports'), element: <ReportsPage />, feature: 'financiar.rapoarte' },
                  ]}
                />
                </RequireFeature>
              }
            />
            <Route path="/reconciliation/*" element={<RequireFeature feature="reconciliere.view" page={t('common:nav.reconciliation')}><ReconciliationPage /></RequireFeature>} />
            <Route path="/crypto" element={<RequireFeature feature="investitii.view" page={t('common:nav.investments')}><LinkedSection title={t('common:nav.investments')} links={INVESTMENT_LINKS}><CryptoPage /></LinkedSection></RequireFeature>} />
            <Route path="/crypto/coin/:id" element={<RequireFeature feature="investitii.view" page={t('common:nav.investments')}><CoinDetailPage /></RequireFeature>} />
            <Route path="/assets" element={<RequireFeature feature="investitii.view" page={t('common:nav.investments')}><LinkedSection title={t('common:nav.investments')} links={INVESTMENT_LINKS}><AssetsPage /></LinkedSection></RequireFeature>} />
            <Route path="/assets/:category/:symbol" element={<RequireFeature feature="investitii.view" page={t('common:nav.investments')}><AssetDetailPage /></RequireFeature>} />
            <Route path="/pricing" element={<RequireFeature feature="clienti.view" page={t('common:nav.clients')}><PricingPage /></RequireFeature>} />
            <Route path="/tenders" element={<RequireFeature feature="licitatii.view" page={t('common:nav.tenders')}><TendersPage /></RequireFeature>} />
            <Route path="/email" element={<RequireFeature feature="email.view" page={t('common:nav.email')}><EmailPage /></RequireFeature>} />
            <Route path="/messages" element={<RequireFeature feature="mesaje.view" page={t('common:nav.messages')}><MessagesPage /></RequireFeature>} />
            <Route path="/messages/:id" element={<RequireFeature feature="mesaje.view" page={t('common:nav.messages')}><MessagesPage /></RequireFeature>} />
            <Route path="/calendar" element={<RequireFeature feature="calendar.view" page={t('common:nav.calendar')}><CalendarPage /></RequireFeature>} />
            <Route path="/calls" element={<RequireFeature feature="apeluri.view" page={t('common:nav.calls')}><CallsPage /></RequireFeature>} />
            <Route path="/calls/:id" element={<RequireFeature feature="apeluri.manage" page={t('common:nav.calls')}><CallRoomPage /></RequireFeature>} />
            <Route
              path="/notes"
              element={
                <RequireFeature feature="notite.view" page={t('common:nav.notes')}>
                <TabbedSection
                  title={t('common:nav.notes')}
                  tabs={[
                    { key: 'notite', label: t('common:nav.notes'), element: <NotesPage /> },
                    { key: 'plan', label: t('common:nav.plan'), element: <PlanPage /> },
                    { key: 'wishlist', label: t('common:nav.wishlist'), element: <WishlistPage /> },
                  ]}
                />
                </RequireFeature>
              }
            />
            <Route path="/wishlist" element={<RedirectToTab to="/notes" tab="wishlist" />} />
            <Route path="/plan" element={<RedirectToTab to="/notes" tab="plan" />} />
            <Route path="/alerts" element={<RequireFeature feature="alerte.view" page={t('common:nav.alerts')}><AlertsPage /></RequireFeature>} />
            <Route path="/reports" element={<RedirectToTab to="/financials" tab="rapoarte" />} />
            <Route path="/system-health" element={<RequireFeature feature="server.view" page={t('common:nav.server')}><SystemHealthPage /></RequireFeature>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/me" element={<ProfilePage />} />
            <Route path="/team" element={<TeamPage />} />
            {/* Ajutor (PLAN.md C5): al oricărui om, fără funcționalitate. Rutele de platformă le
                apără serverul: fără contul de platformă, lista răspunde 404 și pagina o spune. */}
            <Route path="/support" element={<SupportPage scope="mine" />} />
            <Route path="/support/:id" element={<TicketPage scope="mine" />} />
            <Route path="/platform/support" element={<SupportPage scope="platform" />} />
            <Route path="/platform/tenants" element={<TenantsPage />} />
            <Route path="/platform/support/:id" element={<TicketPage scope="platform" />} />
            <Route path="/help" element={<GuidesPage />} />
            <Route path="/updates" element={<UpdatesPage />} />
            <Route path="/team/history" element={<RequireFeature feature="echipa.istoric" page={t('common:nav.history')}><TeamHistoryPage /></RequireFeature>} />
            <Route path="/modules" element={<RequireFeature feature="echipa.administrare" page={t('common:nav.modules')}><ModulesPage /></RequireFeature>} />
          </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
