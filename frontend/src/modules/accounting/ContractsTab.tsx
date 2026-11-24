import { useQuery } from '@tanstack/react-query'
import { Hash, Plus, Settings2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilterBar, useFilterState, useSearchState } from '@/shared/components/FilterBar'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { api } from '@/shared/lib/api'
import { errorCode } from '@/shared/lib/errors'
import type { FilterClause, FilterField } from '@/shared/lib/filters'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useMe } from '@/shared/hooks/use-me'
import { ContractNumbersDialog } from './ContractNumbersDialog'
import { CompanyTemplatesCard } from './CompanyTemplatesCard'
import { ContractTemplatesCard } from './ContractTemplatesCard'
import { UploadContractDialog } from './UploadContractDialog'
import { COUNTERPARTY_KINDS, CONTRACT_STATUSES, useContractCategories, type RegistryRow } from './contracts-api'
import { noticeText, STATUS_TONE, statusLabel } from './contracts-logic'

// Own URL params: `f` and `q` belong to the prospect list on the same page.
const FILTER_PARAM = 'cf'
const SEARCH_PARAM = 'cq'

const valuesOf = (clauses: FilterClause[], field: string): string[] => {
  const clause = clauses.find((c) => c.field === field)
  return clause && clause.op === 'in' ? clause.value : []
}

export function ContractsTab() {
  const navigate = useNavigate()
  const [clauses, setClauses] = useFilterState(FILTER_PARAM)
  const [search, setSearch] = useSearchState(SEARCH_PARAM)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { can } = useMe()
  const [numbersOpen, setNumbersOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const categories = useContractCategories()

  const fields: FilterField[] = [
    {
      key: 'state',
      label: t('common:labels.state'),
      type: 'enum',
      noNegate: true,
      defaultPinned: true,
      options: CONTRACT_STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
    },
    {
      key: 'category',
      label: t('common:labels.category'),
      type: 'enum',
      noNegate: true,
      defaultPinned: true,
      options: (categories.data ?? []).map((name) => ({ value: name, label: name })),
    },
    {
      key: 'kind',
      label: t('accounting:contracts.registry.kind'),
      type: 'enum',
      noNegate: true,
      options: COUNTERPARTY_KINDS.map((kind) => ({ value: kind, label: t(`accounting:contracts.kinds.${kind}`) })),
    },
  ]
  const status = valuesOf(clauses, 'state').join(',') || undefined
  // The backend takes one category and one kind: the first value of the clause.
  const category = valuesOf(clauses, 'category')[0]
  const kind = valuesOf(clauses, 'kind')[0]

  useEffect(() => setPage(0), [status, category, kind, search, pageSize])

  const params = { q: search, status, category, kind, page, pageSize }
  const list = useQuery({
    queryKey: ['contracts', 'registry', params],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) })
      if (search) query.set('q', search)
      if (status) query.set('status', status)
      if (category) query.set('category', category)
      if (kind) query.set('kind', kind)
      return api.get<{ items: RegistryRow[]; total: number }>(`/api/contracts/registry?${query}`)
    },
    placeholderData: (previous) => previous,
  })
  const summary = useQuery({ queryKey: ['contracts', 'settings-summary'], queryFn: () => api.get<{ reservedNumbers: number; templates: number }>('/api/contracts/settings-summary') })

  const filtered = Boolean(search || status || category || kind)
  const open = (id: string) => navigate(`/clients/contracte/${id}`)

  return (
    <div className="space-y-4">
      <FilterBar
        fields={fields}
        clauses={clauses}
        onChange={setClauses}
        search={search}
        onSearch={setSearch}
        count={list.data?.total}
        pinnedStorageKey="vd.filters.contracts"
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 aria-hidden="true" /> {t('accounting:contracts.list.settings')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setNumbersOpen(true)}>
              <Hash aria-hidden="true" /> {t('accounting:contracts.registry.numbers')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload aria-hidden="true" /> {t('accounting:contracts.registry.upload')}
            </Button>
            <Button type="button" onClick={() => navigate('/clients/contracte/nou')}>
              <Plus aria-hidden="true" /> {t('accounting:contracts.list.new')}
            </Button>
          </>
        }
      />
      {summary.data && summary.data.reservedNumbers > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('accounting:contracts.list.reservedLine', { count: summary.data.reservedNumbers, n: formatNumber(summary.data.reservedNumbers) })}
        </p>
      ) : null}

      {list.isPending ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <EmptyState
          kind="filtered"
          title={t('accounting:contracts.registry.loadFailed')}
          description={errorCode(list.error) ? t('common:errors.codeLine', { code: errorCode(list.error) }) : undefined}
          onReset={() => void list.refetch()}
        />
      ) : list.data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            kind="filtered"
            title={t('accounting:contracts.registry.noMatch')}
            onReset={() => {
              setClauses([])
              setSearch('')
            }}
          />
        ) : (
          <EmptyState
            kind="new"
            title={t('accounting:contracts.registry.empty')}
            description={t('accounting:contracts.registry.emptyHint')}
            action={<Button onClick={() => navigate('/clients/contracte/nou')}>{t('accounting:contracts.registry.emptyAction')}</Button>}
          />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('accounting:contracts.registry.contract')}</TableHead>
                <TableHead priority="md">{t('common:labels.number')}</TableHead>
                <TableHead>{t('common:labels.state')}</TableHead>
                <TableHead priority="md">{t('accounting:contracts.registry.end')}</TableHead>
                <TableHead priority="lg">{t('accounting:contracts.registry.owner')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((row) => {
                const number = row.number ?? row.externalNumber
                const notice = noticeText(row)
                const end = row.endsOn ? formatDate(row.endsOn) : null
                return (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => open(row.id)}>
                    <TableCell className="tbl-fill">
                      {/* native: row title link */}
                      <button
                        type="button"
                        className="block max-w-full truncate rounded-sm text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(e) => {
                          e.stopPropagation()
                          open(row.id)
                        }}
                      >
                        {row.title}
                      </button>
                      <div className="truncate text-xs text-muted-foreground">{row.counterpartyName}</div>
                      <TableDetails items={[number, end, notice, row.ownerName]} />
                    </TableCell>
                    <TableCell priority="md" className="whitespace-nowrap tabular-nums">
                      {number ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatePill tone={STATUS_TONE[row.status]}>{statusLabel(row.status)}</StatePill>
                    </TableCell>
                    <TableCell priority="md" className="whitespace-nowrap">
                      {end ?? '—'}
                      {notice ? <div className="text-xs text-warning-text">{notice}</div> : null}
                    </TableCell>
                    <TableCell priority="lg" truncate>
                      {row.ownerName ?? '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <TablePagination page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
        </>
      )}

      <UploadContractDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <ContractNumbersDialog open={numbersOpen} onOpenChange={setNumbersOpen} />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('accounting:contracts.list.settings')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto">
            <CompanyTemplatesCard canEdit={can('facturi.sabloane-contracte')} />
            <ContractTemplatesCard />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
