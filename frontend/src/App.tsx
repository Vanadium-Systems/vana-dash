import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { RequireFeature } from '@/shared/components/AccessDenied'
import { ChatStreamProvider } from '@/shared/components/chat/ChatStreamProvider'
import { AppLayout } from '@/shared/components/layout/AppLayout'
import { LinkedSection, RedirectToTab, TabbedSection } from '@/shared/components/layout/PageSection'
import { useAuth } from '@/shared/hooks/use-auth'
import { useShareIn } from '@/shared/lib/share-in'
import { syncLocaleWithProfile, t } from '@/shared/lib/i18n'

const AccountingPage = lazy(() => import('@/modules/accounting/AccountingPage').then((m) => ({ default: m.AccountingPage })))
const AlertsPage = lazy(() => import('@/modules/alerts/AlertsPage').then((m) => ({ default: m.AlertsPage })))
const ArchivePage = lazy(() => import('@/modules/archive/ArchivePage').then((m) => ({ default: m.ArchivePage })))
const AssetsPage = lazy(() => import('@/modules/assets/AssetsPage').then((m) => ({ default: m.AssetsPage })))
const AssetDetailPage = lazy(() => import('@/modules/assets/AssetDetailPage').then((m) => ({ default: m.AssetDetailPage })))
const AssistantPage = lazy(() => import('@/modules/assistant/AssistantPage').then((m) => ({ default: m.AssistantPage })))
const AcceptInvitePage = lazy(() => import('@/modules/auth/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage })))
const ForgotPasswordPage = lazy(() => import('@/modules/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })))
const LoginPage = lazy(() => import('@/modules/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const ResetPasswordPage = lazy(() => import('@/modules/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })))
const CalendarPage = lazy(() => import('@/modules/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const CryptoPage = lazy(() => import('@/modules/crypto/CryptoPage').then((m) => ({ default: m.CryptoPage })))
const CoinDetailPage = lazy(() => import('@/modules/crypto/CoinDetailPage').then((m) => ({ default: m.CoinDetailPage })))
const EmailPage = lazy(() => import('@/modules/email/EmailPage').then((m) => ({ default: m.EmailPage })))
const FinancialsPage = lazy(() => import('@/modules/financials/FinancialsPage').then((m) => ({ default: m.FinancialsPage })))
const MessagesPage = lazy(() => import('@/modules/messages/MessagesPage').then((m) => ({ default: m.MessagesPage })))
const SystemHealthPage = lazy(() => import('@/modules/monitoring/SystemHealthPage').then((m) => ({ default: m.SystemHealthPage })))
const NotesPage = lazy(() => import('@/modules/notes/NotesPage').then((m) => ({ default: m.NotesPage })))
const OverviewPage = lazy(() => import('@/modules/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const PlanPage = lazy(() => import('@/modules/plan/PlanPage').then((m) => ({ default: m.PlanPage })))
const PlatformsPage = lazy(() => import('@/modules/platforms/PlatformsPage').then((m) => ({ default: m.PlatformsPage })))
const PricingPage = lazy(() => import('@/modules/pricing/PricingPage').then((m) => ({ default: m.PricingPage })))
const ReconciliationPage = lazy(() => import('@/modules/reconciliation/ReconciliationPage').then((m) => ({ default: m.ReconciliationPage })))
const ReportsPage = lazy(() => import('@/modules/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const ModulesPage = lazy(() => import('@/modules/access/ModulesPage').then((m) => ({ default: m.ModulesPage })))
const ProfilePage = lazy(() => import('@/modules/auth/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const TeamHistoryPage = lazy(() => import('@/modules/team/TeamHistoryPage').then((m) => ({ default: m.TeamHistoryPage })))
const TeamPage = lazy(() => import('@/modules/team/TeamPage').then((m) => ({ default: m.TeamPage })))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const TendersPage = lazy(() => import('@/modules/tenders/TendersPage').then((m) => ({ default: m.TendersPage })))
const SupportPage = lazy(() => import('@/modules/support/SupportPage').then((m) => ({ default: m.SupportPage })))
const TicketPage = lazy(() => import('@/modules/support/TicketPage').then((m) => ({ default: m.TicketPage })))
const GuidesPage = lazy(() => import('@/modules/help/GuidesPage').then((m) => ({ default: m.GuidesPage })))
const UpdatesPage = lazy(() => import('@/modules/updates/UpdatesPage').then((m) => ({ default: m.UpdatesPage })))
const WishlistPage = lazy(() => import('@/modules/wishlist/WishlistPage').then((m) => ({ default: m.WishlistPage })))

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
  if (isPending) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
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
