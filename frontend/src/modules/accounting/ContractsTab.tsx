import { useQuery } from '@tanstack/react-query'
import { Plus, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FilterBar, useFilterState, useSearchState } from '@/shared/components/FilterBar'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { SidePeek, usePeek } from '@/shared/components/ui/side-peek'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { api } from '@/shared/lib/api'
import { formatDate, formatNumber } from '@/shared/lib/format'
import type { FilterField } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import { ContractClientPicker } from './ContractClientPicker'
import { ContractDetail } from './ContractDetail'
import { ContractTemplatesCard } from './ContractTemplatesCard'
import { ReservedNumbersCard } from './ReservedNumbersCard'

type ContractState = 'none' | 'generated' | 'signed' | 'addendum'

interface ContractRow {
  clientId: string
  clientName: string
  contractNumber: string | null
  contractDate: string | null
  plan: string | null
  state: ContractState
  lastDocument: { id: string; kind: string; createdAt: string } | null
}

const STATES: ContractState[] = ['none', 'generated', 'signed', 'addendum']
const STATE_TONE: Record<ContractState, StateTone> = { none: 'neutral', generated: 'warning', signed: 'success', addendum: 'success' }
const STATE_LABEL: Record<ContractState, () => string> = {
  none: () => t('accounting:contracts.list.states.none'),
  generated: () => t('accounting:contracts.list.states.generated'),
  signed: () => t('accounting:contracts.list.states.signed'),
  addendum: () => t('accounting:contracts.list.states.addendum'),
}
const DOC_KIND_LABEL: Record<string, () => string> = {
  contract: () => t('accounting:docTypes.contract'),
  anexa: () => t('accounting:docTypes.priceAnnex'),
  act_aditional: () => t('accounting:docTypes.addendum'),
}

// Own URL params: `f` and `q` belong to the prospect list on the same page.
const FILTER_PARAM = 'cf'
const SEARCH_PARAM = 'cq'

export function ContractsTab() {
  const [clauses, setClauses] = useFilterState(FILTER_PARAM)
  const [search, setSearch] = useSearchState(SEARCH_PARAM)
  const [peekId, openPeek, closePeek] = usePeek('contract')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const fields: FilterField[] = [
    {
      key: 'state',
      label: t('common:labels.state'),
      type: 'enum',
      noNegate: true,
      defaultPinned: true,
      options: STATES.map((state) => ({ value: state, label: STATE_LABEL[state]() })),
    },
  ]
  const stateClause = clauses.find((c) => c.field === 'state')
  const state = stateClause && stateClause.op === 'in' && stateClause.value.length > 0 ? stateClause.value.join(',') : undefined

  useEffect(() => setPage(0), [state, search, pageSize])

  const list = useQuery({
    queryKey: ['contracts', 'list', { q: search, state, page, pageSize }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) })
      if (search) params.set('q', search)
      if (state) params.set('state', state)
      return api.get<{ rows: ContractRow[]; total: number }>(`/api/contracts/list?${params}`)
    },
    placeholderData: (previous) => previous,
  })
  const summary = useQuery({ queryKey: ['contracts', 'settings-summary'], queryFn: () => api.get<{ reservedNumbers: number; templates: number }>('/api/contracts/settings-summary') })

  const peeked = list.data?.rows.find((row) => row.clientId === peekId)
  const filtered = Boolean(search || state)

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
            <Button type="button" onClick={() => setPickerOpen(true)}>
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
        <EmptyState kind="filtered" title={t('accounting:contracts.list.loadFailed')} onReset={() => void list.refetch()} />
      ) : list.data.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            kind="filtered"
            title={t('accounting:contracts.list.noMatch')}
            onReset={() => {
              setClauses([])
              setSearch('')
            }}
          />
        ) : (
          <EmptyState kind="new" title={t('accounting:contracts.list.empty')} />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.client')}</TableHead>
                <TableHead priority="md">{t('accounting:contracts.list.number')}</TableHead>
                <TableHead priority="lg">{t('common:labels.date')}</TableHead>
                <TableHead priority="lg">{t('accounting:contracts.list.plan')}</TableHead>
                <TableHead>{t('common:labels.state')}</TableHead>
                <TableHead priority="lg">{t('accounting:contracts.list.lastDocument')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((row) => (
                <TableRow key={row.clientId} className="cursor-pointer" onClick={() => openPeek(row.clientId)}>
                  <TableCell className="tbl-fill">
                    <button
                      type="button"
                      className="block max-w-full truncate rounded-sm text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => {
                        e.stopPropagation()
                        openPeek(row.clientId)
                      }}
                    >
                      {row.clientName}
                    </button>
                    <TableDetails items={[row.contractNumber, row.contractDate, row.plan]} />
                  </TableCell>
                  <TableCell priority="md" className="whitespace-nowrap">{row.contractNumber ?? '—'}</TableCell>
                  <TableCell priority="lg" className="whitespace-nowrap">{row.contractDate ?? '—'}</TableCell>
                  <TableCell priority="lg" truncate>{row.plan ?? '—'}</TableCell>
                  <TableCell>
                    <StatePill tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]()}</StatePill>
                  </TableCell>
                  <TableCell priority="lg" className="text-xs text-muted-foreground">
                    {row.lastDocument ? `${DOC_KIND_LABEL[row.lastDocument.kind]?.() ?? row.lastDocument.kind} · ${formatDate(row.lastDocument.createdAt)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
        </>
      )}

      <SidePeek open={peekId !== null} onClose={closePeek} title={peeked?.clientName ?? t('accounting:contracts.list.peekTitle')}>
        {peekId ? <ContractDetail clientId={peekId} /> : null}
      </SidePeek>

      <ContractClientPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={openPeek} />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-3xl" data-density="comfortable">
          <DialogHeader>
            <DialogTitle>{t('accounting:contracts.list.settings')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto">
            <ReservedNumbersCard />
            <ContractTemplatesCard />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
