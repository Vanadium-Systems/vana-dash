import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { api } from '@/shared/lib/api'
import type { Platform } from '@/shared/lib/types'
import { CalculatorTab } from './CalculatorTab'
import { ConfigPretTab } from './ConfigPretTab'
import { ProspectareTab } from './ProspectareTab'

const TABS = [
  { key: 'prospectare', label: 'Prospectare' },
  { key: 'calculator', label: 'Calculator' },
  { key: 'config', label: 'Config preț' },
] as const

export function PricingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [platformId, setPlatformId] = useState('')

  const tab = searchParams.get('tab') ?? 'prospectare'

  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api.get<Platform[]>('/api/platforms') })

  useEffect(() => {
    if (!platformId && platforms.data && platforms.data.length > 0) setPlatformId(platforms.data[0]!.id)
  }, [platformId, platforms.data])

  return (
    <div className="space-y-6">
      <PageHeader title="Clienți" />
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
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
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
