import { useLocation, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import type { FeatureKey } from '@/shared/lib/types'
import { ConturiTab } from './ConturiTab'
import { SetariTab } from './SetariTab'
import { t } from '@/shared/lib/i18n'

// Conturile bancare și cheile lor sunt „doar Vanadium" (`reconciliere.conturi`), iar potrivirea
// manuală e cu tot alta funcționalitate (`reconciliere.potrivire`).
const TABS: Array<{ key: string; label: string; feature?: FeatureKey }> = [
  { key: 'conturi', label: t('reconciliation:tabs.accounts'), feature: 'reconciliere.conturi' },
  { key: 'setari', label: t('common:nav.settings'), feature: 'reconciliere.conturi' },
]

export function ReconciliationPage() {
  const { can } = useMe()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // Revolut redirectează OAuth callback-ul aici (?code=...) — ateriz direct pe Setări,
  // nu pe tab-ul implicit Conturi, ca să vadă codul precompletat imediat.
  const isRevolutCallback = location.pathname.endsWith('/revolut-callback')
  const tabs = TABS.filter((tab) => can(tab.feature))
  const requested = searchParams.get('tab')
  const tab = tabs.some((entry) => entry.key === requested) ? (requested ?? '') : isRevolutCallback ? 'setari' : (tabs[0]?.key ?? 'conturi')

  return (
    <div className="space-y-6">
      <PageHeader title={t('common:nav.reconciliation')} />
      {tabs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('reconciliation:page.adminOnly')}
        </p>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v })}>
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="conturi">
            <ConturiTab />
          </TabsContent>
          <TabsContent value="setari">
            <SetariTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
