import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { RequireFeature } from '@/shared/components/AccessDenied'
import { ChatStreamProvider } from '@/shared/components/chat/ChatStreamProvider'
import { AppLayout } from '@/shared/components/layout/AppLayout'
import { LinkedSection, RedirectToTab, TabbedSection } from '@/shared/components/layout/PageSection'
import { useAuth } from '@/shared/hooks/use-auth'
import { useShareIn } from '@/shared/lib/share-in'

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
  { to: '/crypto', label: 'Crypto' },
  { to: '/assets', label: 'Acțiuni' },
]

function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function RequireAuth() {
  const { isAuthenticated, isPending } = useAuth()
  useShareIn()
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
            <Route path="/accounting" element={<RequireFeature feature="facturi.view" page="Facturi"><AccountingPage /></RequireFeature>} />
            <Route path="/archive" element={<RequireFeature feature="arhiva.view" page="Arhivă"><ArchivePage /></RequireFeature>} />
            <Route path="/" element={<OverviewPage />} />
            <Route path="/assistant" element={<RequireFeature feature="asistent.view" page="Asistent"><AssistantPage /></RequireFeature>} />
            <Route path="/platforms" element={<RequireFeature feature="platforme.view" page="Platforme"><PlatformsPage /></RequireFeature>} />
            <Route
              path="/financials"
              element={
                <RequireFeature feature="financiar.view" page="Financiar">
                <TabbedSection
                  title="Financiar"
                  tabs={[
                    { key: 'pnl', label: 'Profit și pierdere', element: <FinancialsPage /> },
                    { key: 'rapoarte', label: 'Rapoarte', element: <ReportsPage />, feature: 'financiar.rapoarte' },
                  ]}
                />
                </RequireFeature>
              }
            />
            <Route path="/reconciliation/*" element={<RequireFeature feature="reconciliere.view" page="Reconciliere"><ReconciliationPage /></RequireFeature>} />
            <Route path="/crypto" element={<RequireFeature feature="investitii.view" page="Investiții"><LinkedSection title="Investiții" links={INVESTMENT_LINKS}><CryptoPage /></LinkedSection></RequireFeature>} />
            <Route path="/crypto/coin/:id" element={<RequireFeature feature="investitii.view" page="Investiții"><CoinDetailPage /></RequireFeature>} />
            <Route path="/assets" element={<RequireFeature feature="investitii.view" page="Investiții"><LinkedSection title="Investiții" links={INVESTMENT_LINKS}><AssetsPage /></LinkedSection></RequireFeature>} />
            <Route path="/assets/:category/:symbol" element={<RequireFeature feature="investitii.view" page="Investiții"><AssetDetailPage /></RequireFeature>} />
            <Route path="/pricing" element={<RequireFeature feature="clienti.view" page="Clienți"><PricingPage /></RequireFeature>} />
            <Route path="/tenders" element={<RequireFeature feature="licitatii.view" page="Licitații"><TendersPage /></RequireFeature>} />
            <Route path="/email" element={<RequireFeature feature="email.view" page="Email"><EmailPage /></RequireFeature>} />
            <Route path="/messages" element={<RequireFeature feature="mesaje.view" page="Mesaje"><MessagesPage /></RequireFeature>} />
            <Route path="/messages/:id" element={<RequireFeature feature="mesaje.view" page="Mesaje"><MessagesPage /></RequireFeature>} />
            <Route path="/calendar" element={<RequireFeature feature="calendar.view" page="Calendar"><CalendarPage /></RequireFeature>} />
            <Route
              path="/notes"
              element={
                <RequireFeature feature="notite.view" page="Notițe">
                <TabbedSection
                  title="Notițe"
                  tabs={[
                    { key: 'notite', label: 'Notițe', element: <NotesPage /> },
                    { key: 'plan', label: 'Plan', element: <PlanPage /> },
                    { key: 'wishlist', label: 'Wishlist', element: <WishlistPage /> },
                  ]}
                />
                </RequireFeature>
              }
            />
            <Route path="/wishlist" element={<RedirectToTab to="/notes" tab="wishlist" />} />
            <Route path="/plan" element={<RedirectToTab to="/notes" tab="plan" />} />
            <Route path="/alerts" element={<RequireFeature feature="alerte.view" page="Alerte"><AlertsPage /></RequireFeature>} />
            <Route path="/reports" element={<RedirectToTab to="/financials" tab="rapoarte" />} />
            <Route path="/system-health" element={<RequireFeature feature="server.view" page="Server"><SystemHealthPage /></RequireFeature>} />
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
            <Route path="/team/history" element={<RequireFeature feature="echipa.istoric" page="Istoric"><TeamHistoryPage /></RequireFeature>} />
            <Route path="/modules" element={<RequireFeature feature="echipa.administrare" page="Module"><ModulesPage /></RequireFeature>} />
          </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
