import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import type { FeatureKey } from '@/shared/lib/types'
import { ClientsTab } from './ClientsTab'
import { ContractsTab } from './ContractsTab'
import { DeclarationsTab } from './DeclarationsTab'
import { EmiseTab } from './EmiseTab'
import { MesajeTab } from './MesajeTab'
import { PrimiteTab } from './PrimiteTab'
import { SettingsTab } from './SettingsTab'

// Fiecare tab are funcționalitatea lui (PLAN.md C2): fără `facturi.anaf` nu există
// tab-ul Mesaje SPV, iar butonul „Trimite la ANAF" din Emise dispare odată cu el.
const TABS: Array<{ key: string; label: string; feature?: FeatureKey }> = [
  { key: 'emise', label: 'Emise' },
  { key: 'primite', label: 'Primite' },
  { key: 'declaratii', label: 'Declarații', feature: 'facturi.declaratii' },
  { key: 'mesaje', label: 'Mesaje SPV', feature: 'facturi.anaf' },
  { key: 'clienti', label: 'Clienți', feature: 'facturi.clienti' },
  { key: 'contracte', label: 'Contracte', feature: 'facturi.contracte' },
  { key: 'setari', label: 'Setări', feature: 'facturi.setari' },
]

export function AccountingPage() {
  // Tabul stă în URL (pattern-ul period din CLAUDE.md) — refresh/share păstrează contextul.
  const { can } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabs = TABS.filter((t) => can(t.feature))
  // Omul a venit pe un tab pe care nu-l are (link, favorite) — îl ducem pe primul pe care îl are.
  const tab = tabs.some((t) => t.key === searchParams.get('tab')) ? (searchParams.get('tab') as string) : tabs[0]?.key

  return (
    <div className="space-y-6">
      <PageHeader title="Facturi" />
      <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v })}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="emise">
          <EmiseTab />
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
        <TabsContent value="clienti">
          <ClientsTab />
        </TabsContent>
        <TabsContent value="contracte">
          <ContractsTab />
        </TabsContent>
        <TabsContent value="setari">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
