import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useTeamMembers, memberName } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { actionLabel, type AuditListItem } from '@/shared/lib/audit'
import { t } from '@/shared/lib/i18n'

// „Cine a făcut ce" (PLAN.md C2, fișa „Istoric"). Filtrele stau în URL, ca un link să poată
// fi trimis („ce a schimbat ieri?") și ca lista să nu piardă filtrele la back.

const ENTITY_LABEL: Record<string, string> = {
  invoice: t('team:history.entities.invoice'),
  billing_client: t('team:history.entities.client'),
  contract_document: t('team:history.entities.contract'),
  contract_addendum: t('team:history.entities.annex'),
  contract_terms: t('team:history.entities.terms'),
  contract_reserved_numbers: t('team:history.entities.contractNumbers'),
  payment_match: t('team:history.entities.match'),
  role: t('team:history.entities.role'),
  user: t('team:history.entities.person'),
  prospect: t('team:history.entities.prospect'),
}

export function TeamHistoryPage() {
  const [params, setParams] = useSearchParams()
  const members = useTeamMembers()
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [rows, setRows] = useState<AuditListItem[] | null>(null)

  const actorId = params.get('actor') ?? ''
  const entityType = params.get('entityType') ?? ''

  const query = useQuery({
    queryKey: ['audit', { actorId, entityType, before: nextCursor }],
    queryFn: () => {
      const q = new URLSearchParams({ limit: '50' })
      if (actorId) q.set('actorId', actorId)
      if (entityType) q.set('entityType', entityType)
      if (nextCursor) q.set('before', nextCursor)
      return api.get<AuditListItem[]>(`/api/audit?${q.toString()}`)
    },
  })

  // Paginarea e pe cursor, deci listele se adună: paginile noi se lipesc de cele vechi.
  const items = rows ?? query.data ?? []
  const loadMore = () => {
    const last = query.data?.[query.data.length - 1]
    if (!last) return
    setRows([...items, ...(query.data ?? [])])
    setNextCursor(last.createdAt)
  }

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
    setRows(null)
    setNextCursor(null)
  }

  const hasFilter = Boolean(actorId || entityType)
  // Numele omului vine din lista de membri (un query deja făcut pentru filtrul „Om"); altfel
  // ar însemna încă un fetch ca să aflăm ce email are cineva care a șters contul.
  const actorName = (item: AuditListItem) => {
    if (!item.actor) return t('common:labels.system')
    const member = members.data?.find((m) => m.id === item.actor?.id)
    return member ? memberName(member) : (item.actor.displayName ?? t('common:history.someone'))
  }
  const activeFilters = [
    actorId ? { key: 'actor', label: `Om: ${memberName(members.data?.find((m) => m.id === actorId) ?? { displayName: null, email: actorId })}` } : null,
    entityType ? { key: 'entityType', label: `Obiect: ${ENTITY_LABEL[entityType] ?? entityType}` } : null,
  ].filter((f): f is { key: string; label: string } => f !== null)

  return (
    <div className="space-y-6" data-density="comfortable">
      <PageHeader title={t('common:nav.history')} description={t('team:history.description')} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="filter-actor">
            {t('team:labels.person')}
          </label>
          <Select
            id="filter-actor"
            value={actorId}
            onValueChange={(value) => setFilter('actor', value)}
            options={[{ value: '', label: t('team:history.everyone') }, ...(members.data ?? []).map((m) => ({ value: m.id, label: memberName(m) }))]}
          />
        </div>
        <div className="w-48">
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="filter-entity">
            {t('team:labels.object')}
          </label>
          <Select
            id="filter-entity"
            value={entityType}
            onValueChange={(value) => setFilter('entityType', value)}
            options={[{ value: '', label: t('common:labels.all') }, ...Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }))]}
          />
        </div>
        {/* Filtrele active stau ca chip-uri, cu o singură ieșire: „Resetează". Un `×` de 16px
            într-un chip de 20 e sub ținta de touch, deci nu merită. */}
        {activeFilters.map((filter) => (
          <Badge key={filter.key} variant="secondary" className="self-end">
            {filter.label}
          </Badge>
        ))}
        {hasFilter ? (
          <Button variant="outline" className="self-end" onClick={() => setParams({})}>
            {t('common:actions.reset')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="space-y-2 py-6 text-sm">
          <p>{t('team:history.loadFailed')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        hasFilter ? (
          <EmptyState
            kind="filtered"
            title={t('team:history.emptyFilteredTitle')}
            description={t('team:history.emptyFilteredHint')}
            onReset={() => setParams({})}
          />
        ) : (
          <EmptyState kind="new" title={t('team:history.emptyTitle')} description={t('team:history.emptyHint')} />
        )
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('team:history.tableCaption')}</caption>
            <thead>
              <tr>
                {[t('common:labels.when'), t('team:history.who'), t('team:history.what'), t('team:labels.object')].map((heading) => (
                  <th key={heading} scope="col" className="border-b pb-2 text-left text-xs font-normal text-muted-foreground">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="py-2 pr-3 text-muted-foreground" title={formatDateTime(item.createdAt)}>
                    {formatRelativeTime(item.createdAt)}
                  </td>
                  <td className="py-2 pr-3">{actorName(item)}</td>
                  <td className="py-2 pr-3">{actionLabel(item.action)}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {item.entityType}
                    {item.entityId ? <span className="font-mono text-xs"> {item.entityId.slice(0, 8)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.data && query.data.length === 50 ? (
            <Button variant="outline" onClick={loadMore}>
              <Plus className="h-4 w-4" />
              {t('team:history.more')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}
