import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import { CALL_FILTERS, useCalls } from './calls-api'
import { CallsTable } from './CallsTable'
import { NewCallDialog } from './NewCallDialog'
import type { CallFilter } from './types'

export function CallsPage() {
  // The filter lives in the URL so a link shared with a colleague opens the same list.
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('status')
  const status: CallFilter = raw === 'open' || raw === 'ended' ? raw : 'all'
  const setStatus = (next: CallFilter) => setSearchParams(next === 'all' ? {} : { status: next }, { replace: true })

  const [creating, setCreating] = useState(false)
  const { can } = useMe()
  const canManage = can('apeluri.manage')
  const calls = useCalls(status)

  const newCallButton = canManage && (
    <Button size="sm" onClick={() => setCreating(true)}>
      <Plus className="h-4 w-4" />
      {t('calls:newCall')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader title={t('calls:title')} description={t('calls:description')} actions={newCallButton || undefined} />

      <div className="w-40">
        <Select
          size="sm"
          aria-label={t('calls:filter.label')}
          value={status}
          onValueChange={(value) => setStatus(value as CallFilter)}
          options={CALL_FILTERS.map((filter) => ({ value: filter, label: t(`calls:filter.${filter}`) }))}
        />
      </div>

      {calls.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : calls.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('calls:error')}</p>
          <Button variant="outline" size="sm" onClick={() => void calls.refetch()}>
            {t('calls:retry')}
          </Button>
        </div>
      ) : calls.data.length === 0 ? (
        status === 'all' ? (
          <EmptyState
            kind="new"
            title={t('calls:empty.title')}
            description={t('calls:empty.body')}
            action={newCallButton || undefined}
          />
        ) : (
          <EmptyState kind="filtered" title={t('calls:empty.filtered')} onReset={() => setStatus('all')} />
        )
      ) : (
        <CallsTable calls={calls.data} />
      )}

      {canManage ? <NewCallDialog open={creating} onOpenChange={setCreating} /> : null}
    </div>
  )
}
