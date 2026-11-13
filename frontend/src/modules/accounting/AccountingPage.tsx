import { Navigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import type { FeatureKey } from '@/shared/lib/types'
import { DeclarationsTab } from './DeclarationsTab'
import { EmiseTab } from './EmiseTab'
import { MesajeTab } from './MesajeTab'
import { PrimiteTab } from './PrimiteTab'
import { ProformasTab } from './ProformasTab'
import { SettingsTab } from './SettingsTab'
import { t } from '@/shared/lib/i18n'

// Fiecare tab are funcționalitatea lui (PLAN.md C2): fără `facturi.anaf` nu există
// tab-ul Mesaje SPV, iar butonul „Trimite la ANAF" din Emise dispare odată cu el.
const TABS: Array<{ key: string; label: string; feature?: FeatureKey }> = [
  { key: 'emise', label: t('accounting:tabs.issued') },
  { key: 'proforme', label: t('accounting:proformas.tab') },
  { key: 'primite', label: t('accounting:tabs.received') },
  { key: 'declaratii', label: t('accounting:tabs.declarations'), feature: 'facturi.declaratii' },
  { key: 'mesaje', label: t('accounting:tabs.spvMessages'), feature: 'facturi.anaf' },
  { key: 'setari', label: t('common:nav.settings'), feature: 'facturi.setari' },
]

export function AccountingPage() {
  // Tabul stă în URL (pattern-ul period din CLAUDE.md) — refresh/share păstrează contextul.
  const { can } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabs = TABS.filter((tab) => can(tab.feature))
  // Omul a venit pe un tab pe care nu-l are (link, favorite) — îl ducem pe primul pe care îl are.
  // Links from before the document page (Ctrl K, shared messages) carry `?record=<id>`.
  const recordId = searchParams.get('record')
  const tab = tabs.some((entry) => entry.key === searchParams.get('tab')) ? (searchParams.get('tab') as string) : tabs[0]?.key

  if (recordId) return <Navigate to={`/accounting/records/${encodeURIComponent(recordId)}`} replace />

  return (
    <div className="space-y-6">
      <PageHeader title={t('common:nav.invoices')} />
      <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v })}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="emise">
          <EmiseTab />
        </TabsContent>
        <TabsContent value="proforme">
          <ProformasTab />
        </TabsContent>
        <TabsContent value="primite">
          <PrimiteTab />
        </TabsContent>
        <TabsContent value="declaratii">
          <DeclarationsTab />
        </TabsContent>
        <TabsContent value="mesaje">
          <MesajeTab />
        </TabsContent>
        <TabsContent value="setari">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
