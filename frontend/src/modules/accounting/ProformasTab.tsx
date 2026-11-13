import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, FileInput, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RowActions } from '@/shared/components/ui/row-actions'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { PAGE_SIZES, TablePagination } from '@/shared/components/ui/table-pagination'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'
import type { FinancialRecord } from '@/shared/lib/types'
import { useProformaActions } from './proforma-actions'
import { AmountCell } from './records-ui'

const FILTERS = ['all', 'draft', 'open', 'invoiced', 'cancelled'] as const
type ProformaFilter = (typeof FILTERS)[number]
type ProformaState = 'draft' | 'open' | 'invoiced' | 'cancelled'

interface ProformaPage {
  items: FinancialRecord[]
  total: number
}

// The list has no isDraft flag: a proforma without a number has not been issued.
export function proformaState(row: Pick<FinancialRecord, 'documentNumber' | 'proformaStatus'>): ProformaState {
  if (!row.documentNumber) return 'draft'
  return row.proformaStatus ?? 'open'
}

export function ProformasTab() {
  const navigate = useNavigate()
  const canIssue = useMe().can('facturi.emitere')
  const actions = useProformaActions()
  const [statusParam, setStatus] = useUrlState('status', 'all')
  const [pageParam, setPage] = useUrlState('page', '1')
  const [sizeParam, setPageSize] = useUrlState('size', String(PAGE_SIZES[0]))

  const filter: ProformaFilter = FILTERS.find((entry) => entry === statusParam) ?? 'all'
  const pageSize = PAGE_SIZES.find((size) => String(size) === sizeParam) ?? PAGE_SIZES[0]
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)

  const list = useQuery({
    queryKey: ['accounting', 'proformas', filter, page, pageSize],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (filter !== 'all') query.set('status', filter)
      return api.get<ProformaPage>(`/api/invoicing/proformas?${query}`)
    },
    placeholderData: keepPreviousData,
  })
  const rows = list.data?.items ?? []
  const total = list.data?.total ?? 0

  // Back to the first page when the filter or page size changes; a page past the end (a shorter list) too.
  const narrowing = `${filter}|${pageSize}`
  const [seen, setSeen] = useState(narrowing)
  useEffect(() => {
    if (seen === narrowing) return
    setSeen(narrowing)
    setPage('1')
  }, [narrowing, seen, setPage])
  useEffect(() => {
    if (list.data && page > 1 && rows.length === 0 && total > 0) setPage(String(Math.ceil(total / pageSize)))
  }, [list.data, page, rows.length, total, pageSize, setPage])

  const create = () => navigate('/accounting/invoices/new?kind=proforma')
  const open = (id: string) => navigate(`/accounting/records/${id}`)

  return (
    <div className="space-y-4">
      {canIssue ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={create} data-testid="proforma-new">
            <Plus className="h-4 w-4" /> {t('accounting:proformas.new')}
          </Button>
        </div>
      ) : null}

      <Tabs value={filter} onValueChange={setStatus}>
        <TabsList variant="segmented">
          {FILTERS.map((entry) => (
            <TabsTrigger key={entry} value={entry} data-testid={`proformas-tab-${entry}`}>
              {t(`accounting:proformas.filters.${entry}` as const)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-6">
          {list.isPending ? (
            <ListSkeleton rows={pageSize > 10 ? 8 : 5} />
          ) : list.isError && !list.data ? (
            <Alert
              tone="critical"
              title={t('accounting:proformas.loadFailed')}
              action={
                <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {t('accounting:records.loadFailedHint')}
            </Alert>
          ) : rows.length === 0 ? (
            filter !== 'all' ? (
              <EmptyState kind="filtered" title={t('accounting:records.noMatch')} description={t('accounting:records.noMatchHint')} onReset={() => setStatus('all')} />
            ) : (
              <EmptyState kind="new" title={t('accounting:proformas.empty')} description={t('accounting:proformas.emptyHint')} action={canIssue ? <Button onClick={create}>{t('accounting:proformas.new')}</Button> : null} />
            )
          ) : (
            <div className={list.isFetching ? 'opacity-70 transition-opacity duration-fast' : 'transition-opacity duration-fast'}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">{t('common:labels.amount')}</TableHead>
                    <TableHead>{t('accounting:proformas.number')}</TableHead>
                    <TableHead priority="md">{t('common:labels.client')}</TableHead>
                    <TableHead priority="lg">{t('accounting:labels.issued')}</TableHead>
                    <TableHead priority="md">{t('common:labels.status')}</TableHead>
                    <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const state = proformaState(row)
                    const rowTitle = row.documentNumber ?? t('accounting:issued.draftMarker')
                    const pill = <StatePill key="state" tone={state === 'invoiced' ? 'success' : 'neutral'}>{t(`accounting:proformas.status.${state}` as const)}</StatePill>
                    return (
                      <TableRow key={row.id} data-row-id={row.id} className="cursor-pointer" onClick={() => open(row.id)}>
                        <TableCell className="whitespace-nowrap text-right">
                          <AmountCell amount={row.amount} currency={row.currency} />
                        </TableCell>
                        <TableCell className="tbl-fill font-medium">
                          <button
                            type="button"
                            className="block max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={(e) => {
                              e.stopPropagation()
                              open(row.id)
                            }}
                          >
                            {rowTitle}
                          </button>
                          <TableDetails items={[row.counterpartyName, formatDate(row.issuedAt), pill]} />
                        </TableCell>
                        <TableCell priority="md" truncate>{row.counterpartyName ?? '—'}</TableCell>
                        <TableCell priority="lg" className="whitespace-nowrap">{formatDate(row.issuedAt)}</TableCell>
                        <TableCell priority="md">{pill}</TableCell>
                        <TableCell className="text-right">
                          <RowActions
                            title={rowTitle}
                            actions={[
                              ...(canIssue && state === 'open'
                                ? [{ key: 'convert', icon: FileInput, label: t('accounting:proformas.convert'), disabled: actions.busy, onClick: () => actions.convert.mutate(row.id) }]
                                : []),
                              // The list rows carry no hasPdf; an issued proforma always has its PDF stored.
                              ...(row.documentNumber ? [{ key: 'pdf', icon: Download, label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/accounting/records/${row.id}/pdf`, 'document.pdf') }] : []),
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <TablePagination page={page - 1} pageSize={pageSize} total={total} onPage={(next) => setPage(String(next + 1))} onPageSize={(size) => setPageSize(String(size))} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
