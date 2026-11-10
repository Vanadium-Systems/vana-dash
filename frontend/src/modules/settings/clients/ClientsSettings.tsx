import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { ProspectStatusesCard } from '@/modules/pricing/ProspectStatusesCard'
import { useMe } from '@/shared/hooks/use-me'
import { t, type TKey } from '@/shared/lib/i18n'
import { AutomationsSection } from './AutomationsSection'
import { ReleaseSection } from './ReleaseSection'
import { ScoreSection } from './ScoreSection'
import { SignalsSection } from './SignalsSection'

type Section = 'release' | 'statuses' | 'automations' | 'score' | 'signals'

const SECTION_TEXTS: Record<Section, TKey> = {
  release: 'clients:settings.sections.release',
  statuses: 'clients:settings.sections.statuses',
  automations: 'clients:settings.sections.automations',
  score: 'clients:settings.sections.score',
  signals: 'clients:settings.sections.signals',
}

/** Settings → Clienți. Reading is open to whoever sees the page; the writes follow the routes (`clienti.repartizare`, statuses `clienti.prospectare`). */
export function ClientsSettings() {
  const { can } = useMe()
  const canEdit = can('clienti.repartizare')
  const sections = (Object.keys(SECTION_TEXTS) as Section[]).filter((key) => key !== 'statuses' || can('clienti.prospectare'))
  const [section, setSection] = useState<Section>('release')
  const current = sections.includes(section) ? section : sections[0]!

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('clients:settings.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={current} onValueChange={(next) => setSection(next as Section)}>
          <TabsList variant="segmented">
            {sections.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(SECTION_TEXTS[key])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {!canEdit && current !== 'statuses' ? <p className="text-sm text-muted-foreground">{t('clients:settings.readOnly')}</p> : null}
        {current === 'release' ? <ReleaseSection canEdit={canEdit} /> : null}
        {current === 'statuses' ? <ProspectStatusesCard embedded /> : null}
        {current === 'automations' ? <AutomationsSection canEdit={canEdit} /> : null}
        {current === 'score' ? <ScoreSection canEdit={canEdit} /> : null}
        {current === 'signals' ? <SignalsSection canEdit={canEdit} /> : null}
      </CardContent>
    </Card>
  )
}
