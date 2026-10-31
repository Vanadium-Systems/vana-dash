import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { Platform } from '@/shared/lib/types'
import { CalculatorTab } from './CalculatorTab'
import { ConfigPretTab } from './ConfigPretTab'
import { ProspectareTab } from './ProspectareTab'
import { t } from '@/shared/lib/i18n'

const TABS = [
  { key: 'prospectare', label: t('pricing:tabs.prospects') },
  { key: 'calculator', label: t('pricing:tabs.calculator') },
  { key: 'config', label: t('pricing:tabs.priceConfig') },
] as const

export function PricingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [platformId, setPlatformId] = useState('')

  const tab = searchParams.get('tab') ?? 'prospectare'

  const { can } = useMe()
  // Sales colleagues work here without `platforme.view`; asking anyway was a 403 on every visit.
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api.get<Platform[]>('/api/platforms'), enabled: can('platforme.view') })

  useEffect(() => {
    if (!platformId && platforms.data && platforms.data.length > 0) setPlatformId(platforms.data[0]!.id)
  }, [platformId, platforms.data])

  return (
    <div className="space-y-6">
      <PageHeader title={t('common:nav.clients')} />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('tab', v)
            if (v !== 'calculator') next.delete('prospectId')
            return next
          })
        }
      >
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="prospectare">
          <ProspectareTab />
        </TabsContent>
        <TabsContent value="calculator">
          <CalculatorTab platformId={platformId} setPlatformId={setPlatformId} platforms={platforms.data ?? []} />
        </TabsContent>
        <TabsContent value="config">
          <ConfigPretTab platformId={platformId} setPlatformId={setPlatformId} platforms={platforms.data ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
