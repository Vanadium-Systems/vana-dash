import { useQuery } from '@tanstack/react-query'
import { BarChart3, Calculator, CheckSquare, FileText, ListChecks, Search, Settings2, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClientsTab } from '@/modules/accounting/ClientsTab'
import { ContractsTab } from '@/modules/accounting/ContractsTab'
import { CalculatorTab } from '@/modules/pricing/CalculatorTab'
import { ConfigPretTab } from '@/modules/pricing/ConfigPretTab'
import { HealthTab } from './health/HealthTab'
import { ListsTab } from './lists/ListsTab'
import { ProspectsTab } from './prospects/ProspectsTab'
import { ReportsTab } from './reports/ReportsTab'
import { TasksPageTab } from './tasks/TasksPage'
import { PageHeader } from '@/shared/components/PageHeader'
import { TabbedSection } from '@/shared/components/layout/PageSection'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { usePageActions } from '@/shared/lib/page-actions'
import type { FeatureKey, Platform } from '@/shared/lib/types'

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-density="comfortable" className="space-y-6">
      <PageHeader title={t('common:nav.clients')} />
      {children}
    </div>
  )
}

export function ClientsPage() {
  const [, setSearchParams] = useSearchParams()
  const [platformId, setPlatformId] = useState('')
  const { can } = useMe()
  // Sales colleagues work here without `platforme.view`; asking anyway was a 403 on every visit.
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api.get<Platform[]>('/api/platforms'), enabled: can('platforme.view') })
  useEffect(() => {
    if (!platformId && platforms.data && platforms.data.length > 0) setPlatformId(platforms.data[0]!.id)
  }, [platformId, platforms.data])

  const tabs: Array<{ key: string; label: string; element: ReactNode; feature: FeatureKey; icon: typeof Users }> = [
    { key: 'prospectare', label: t('pricing:tabs.prospects'), element: <ProspectsTab />, feature: 'clienti.view', icon: Search },
    { key: 'taskuri', label: t('clients:tabs.tasks'), element: <TasksPageTab />, feature: 'clienti.view', icon: CheckSquare },
    { key: 'liste', label: t('clients:tabs.lists'), element: <ListsTab />, feature: 'clienti.view', icon: ListChecks },
    { key: 'rapoarte', label: t('clients:tabs.reports'), element: <ReportsTab />, feature: 'clienti.view', icon: BarChart3 },
    { key: 'sanatate', label: t('clients:tabs.health'), element: <HealthTab />, feature: 'clienti.prospectare', icon: ShieldCheck },
    { key: 'activi', label: t('clients:tabs.active'), element: <ClientsTab />, feature: 'facturi.clienti', icon: Users },
    { key: 'contracte', label: t('accounting:tabs.contracts'), element: <ContractsTab />, feature: 'facturi.contracte', icon: FileText },
    { key: 'calculator', label: t('pricing:tabs.calculator'), element: <CalculatorTab platformId={platformId} setPlatformId={setPlatformId} platforms={platforms.data ?? []} />, feature: 'clienti.calculator', icon: Calculator },
    { key: 'config', label: t('pricing:tabs.priceConfig'), element: <ConfigPretTab platformId={platformId} setPlatformId={setPlatformId} platforms={platforms.data ?? []} />, feature: 'clienti.config-pret', icon: Settings2 },
  ]

  usePageActions(
    tabs
      .filter((tab) => can(tab.feature))
      .map((tab) => ({
        id: `clients-tab-${tab.key}`,
        label: t('clients:palette.goTo', { tab: tab.label }),
        icon: tab.icon,
        // Params of the tab being left (prospect id, filters) mean nothing on the next one.
        run: () => setSearchParams(tab.key === 'prospectare' ? {} : { tab: tab.key }),
      })),
  )

  return <TabbedSection title={t('common:nav.clients')} tabs={tabs.map((tab) => ({ key: tab.key, label: tab.label, feature: tab.feature, element: <Frame>{tab.element}</Frame> }))} />
}
