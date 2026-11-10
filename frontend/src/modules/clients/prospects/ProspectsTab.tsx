import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Calculator, ChevronDown, Columns3, Download, ListPlus, Rows3, TrendingUp, Mail, MessageSquareShare, Phone, Plus, Trash2, Upload, UserPlus, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AddToSequenceDialog, type SequenceTarget } from '@/modules/pricing/AddToSequenceDialog'
import { BoardSkeleton, ProspectBoard } from '../board/ProspectBoard'
import { ForecastView } from '../board/ForecastView'
import { useBoard, useForecast, useMoveProspect } from '../board/use-board-data'
import { ListDialog } from '../lists/ListDialogs'
import { useListActions, useListFolders } from '../lists/use-lists-data'
import { PrimaryContactDialog } from '../sheet/PrimaryContactDialog'
import { ProspectDrawer } from '../sheet/ProspectDrawer'
import { PromoteProspectDialog } from '@/modules/pricing/PromoteProspectDialog'
import { FilterBar } from '@/shared/components/FilterBar'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { EmptyState } from '@/shared/components/ui/empty-state'
import type { RowAction } from '@/shared/components/ui/row-actions'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { SelectionBar } from '@/shared/components/ui/selection-bar'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { useMe } from '@/shared/hooks/use-me'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import { useSelection } from '@/shared/hooks/use-selection'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import { usePageActions } from '@/shared/lib/page-actions'
import { dateBoundsToClause, dayOf, type FilterClause } from '@/shared/lib/filters'
import { bulkTarget, type BulkTarget } from './bulk'
import type { CellContext } from './cells'
import { ColumnsMenu } from './ColumnsMenu'
import type { ColumnKey } from './columns'
import { NewAccountEmpty } from './EmptyStates'
import { LostReasonDialog } from './LostReasonDialog'
import { NewProspectDialog, type NewProspectSeed } from './NewProspectDialog'
import { PeopleTable } from './PeopleTable'
import { ProspectTable } from './ProspectTable'
import { useRowActionRunner } from './RowSplit'
import { SaveViewDialog } from './SaveViewDialog'
import { SelectionActions } from './SelectionActions'
import type { CalcFn, PersonRow, ProspectKind, ProspectRow, ProspectView, SortKey } from './types'
import { useProspectActions } from './use-prospect-actions'
import { filterParams, useAssignees, useKindCount, useProspectLists, useProspectList, useStatuses, useViews } from './use-prospect-data'
import { useFilterFields } from './use-filter-fields'
import { useProspectSettings, useSearchHistory } from './use-prospect-settings'
import { useViewActions } from './use-view-actions'
import { ViewDirtyBar, ViewMenu } from './ViewMenu'
import { isViewDirty, nextSort, settingsFromView, type SearchEntry } from './view-state'

const DEFAULT_PAGE_SIZE = 25

type Layout = ProspectView['layout']

const countLabel = (total: number | null | undefined) => (total === undefined ? '' : total === null ? `${formatNumber(1000)}+` : formatNumber(total))

export function ProspectsTab() {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can, session } = useMe()
  const { canShare, share, dialog: shareDialog } = useShareToMessages()
  const [, setSearchParams] = useSearchParams()
  const settings = useProspectSettings()
  const { f, setF, q, setQ, kind, setKind, sort, setSort, columns, setColumns, calcs, setCalcs, viewId, setViewId, current } = settings
  const actions = useProspectActions()
  const viewActions = useViewActions()
  const desktop = useMediaQuery('(min-width: 768px)')

  const statuses = useStatuses().data ?? []
  const assignees = useAssignees().data ?? []
  const views = useViews()
  const lists = useProspectLists(true)
  const fields = useFilterFields(kind, statuses, assignees, lists.data)
  const [layoutParam, setLayoutParam] = useUrlState('layout')
  // Board and forecast hold companies; the people list has no stages.
  const layout: Layout = kind === 'companies' && (layoutParam === 'board' || layoutParam === 'forecast') ? layoutParam : 'list'
  const board = useBoard(f, q, layout === 'board')
  const forecast = useForecast(f, q, layout === 'forecast')
  const move = useMoveProspect(f, q)
  const folders = useListFolders()
  const listActions = useListActions()
  const [newListFor, setNewListFor] = useState<BulkTarget | null>(null)
  const [history] = useSearchHistory(q, f)

  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  // The page belongs to the filters it was picked under; other filters start from the first page.
  const signature = JSON.stringify([f, q, kind, sort, pageSize])
  const [pageAt, setPageAt] = useState({ signature, page: 0 })
  const page = pageAt.signature === signature ? pageAt.page : 0

  const list = useProspectList<ProspectRow | PersonRow>({ f, q, kind, sort, page, pageSize })
  const companiesCount = useKindCount('companies', f, q)
  const peopleCount = useKindCount('people', f, q)
  const total = list.data?.total ?? 0
  const companyRows = useMemo(() => (kind === 'companies' ? ((list.data?.rows ?? []) as ProspectRow[]) : []), [kind, list.data])
  const personRows = kind === 'people' ? ((list.data?.rows ?? []) as PersonRow[]) : []
  const rowIds = useMemo(() => companyRows.map((row) => row.id), [companyRows])

  // The last row of the last page was removed: step back to the page that still has rows.
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && list.data.rows.length === 0 && total > 0 && page > lastPage) setPageAt({ signature, page: lastPage })
  }, [list.data, list.isPlaceholderData, total, page, lastPage, signature])

  const selection = useSelection(rowIds)
  const [allMatching, setAllMatching] = useState(false)
  useEffect(() => {
    if (!selection.allSelected && allMatching) setAllMatching(false)
  }, [selection.allSelected, allMatching])
  const matching = allMatching && selection.allSelected
  const target = bulkTarget({ ids: [...selection.selected], allMatching: matching, f, q })

  const [newSeed, setNewSeed] = useState<NewProspectSeed | null>(null)
  const [sequenceTargets, setSequenceTargets] = useState<SequenceTarget[]>([])
  const [promoteTarget, setPromoteTarget] = useState<ProspectRow | null>(null)
  const [lostPending, setLostPending] = useState<{ run: (reason: string) => void } | null>(null)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [contactTarget, setContactTarget] = useState<ProspectRow | null>(null)

  // Ctrl K opens the creation dialog with what was typed (name) or recognised (CUI).
  useConsumeParam('new', (name) => setNewSeed((seed) => ({ ...seed, name })))
  useConsumeParam('newCui', (cui) => setNewSeed((seed) => ({ ...seed, cui })))

  const openProspect = (id: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('prospect', id)
        return next
      },
      { replace: true },
    )

  const exportFile = (format: 'xlsx' | 'csv') =>
    void api.download(`/api/prospects/export?${filterParams(f, q, { format })}`, `prospects.${format}`).catch((err: Error) => toast.error(err.message))

  // The model writes a date range as plain days; the list's own date filters close the last day at 23:59:59.
  const phraseToClauses = async (text: string) => {
    const answer = await api.post<{ filters: FilterClause[]; understood: string; dropped: number }>('/api/prospects/nl-filters', { text })
    const clauses = answer.filters.flatMap((clause): FilterClause[] => {
      if (clause.op !== 'between' || fields.find((field) => field.key === clause.field)?.type !== 'date') return [clause]
      const bounded = dateBoundsToClause(clause.field, [dayOf(clause.value[0]), dayOf(clause.value[1])])
      return bounded ? [bounded] : []
    })
    return { clauses, understood: answer.understood, dropped: answer.dropped }
  }

  const fromSearch = () => navigate(`/clients/lists/from-search?${filterParams(f, q)}`)

  usePageActions([
    { id: 'prospect-new', label: t('clients:prospects.palette.new'), icon: UserPlus, run: () => setNewSeed({}) },
    { id: 'prospect-import', label: t('clients:prospects.palette.import'), icon: Upload, run: () => navigate('/clients/import') },
    { id: 'layout-list', label: t('clients:layout.goTo', { layout: t('clients:layout.list') }), icon: Rows3, run: () => changeLayout('list') },
    ...(kind === 'companies'
      ? [
          { id: 'layout-board', label: t('clients:layout.goTo', { layout: t('clients:layout.board') }), icon: Columns3, run: () => changeLayout('board') },
          { id: 'layout-forecast', label: t('clients:layout.goTo', { layout: t('clients:layout.forecast') }), icon: TrendingUp, run: () => changeLayout('forecast') },
        ]
      : []),
    ...(can('clienti.prospectare') ? [{ id: 'lists-from-search', label: t('clients:lists.palette.fromSearch'), icon: ListPlus, run: fromSearch }] : []),
    ...(can('clienti.export') ? [{ id: 'prospect-export', label: t('clients:prospects.palette.export'), icon: Download, run: () => exportFile('xlsx') }] : []),
  ])

  // ── Views ──
  const allViews = useMemo(() => [...(views.data?.mine ?? []), ...(views.data?.shared ?? [])], [views.data])
  const activeView: ProspectView | undefined = allViews.find((view) => view.id === viewId)
  const dirty = activeView ? isViewDirty(activeView, current) : false
  const applyView = (view: ProspectView) => {
    settings.apply(settingsFromView(view), view.id)
    setLayoutParam(view.layout === 'list' ? '' : view.layout)
  }
  const changeLayout = (next: Layout) => {
    selection.clear()
    setAllMatching(false)
    setLayoutParam(next === 'list' ? '' : next)
  }
  const applyHistory = (entry: SearchEntry) => {
    setF(entry.f)
    setQ(entry.q)
    setViewId('')
  }

  // ── Status changes: a "lost" status asks for its reason first ──
  const requestStatus = (status: string, run: (reason?: string) => void) => {
    if (statuses.find((entry) => entry.key === status)?.kind === 'lost') setLostPending({ run })
    else run()
  }

  const cellContext: CellContext = {
    statuses,
    assignees,
    currency: session?.tenant?.currency ?? BASE_CURRENCY,
    openProspect,
    editContact: setContactTarget,
    editStatus: (row, status) => requestStatus(status, (reason) => actions.patch.mutate({ id: row.id, body: { status, ...(reason ? { lostReason: reason } : {}) } })),
    editOwner: (row, userId) => actions.transfer.mutate({ ids: [row.id], toUserId: userId }),
    editValue: (row, amount) => actions.patch.mutate({ id: row.id, body: { valueAmount: amount, valueCurrency: amount === null ? null : (row.valueCurrency ?? cellContext.currency) } }),
  }

  const sequenceTarget = (row: ProspectRow): SequenceTarget => ({ id: row.id, name: row.name, email: row.primaryEmail, contactName: row.primaryPerson })
  const runRowAction = useRowActionRunner((row) => setSequenceTargets([sequenceTarget(row)]))

  const archivedView = f.some((clause) => clause.field === 'archived' && clause.op === 'in' && clause.value.includes('yes'))
  const archiveRows = (ids: string[], archive: boolean) => actions.bulk.mutate({ target: { mode: 'ids', ids }, action: archive ? 'archive' : 'unarchive' })
  const deleteRows = (rows: Array<{ id: string; name: string }>) =>
    void confirm({
      title: rows.length === 1 ? t('pricing:prospects.deleteTitle', { name: rows[0]!.name }) : t('clients:prospects.bulk.deleteTitle', { count: rows.length }),
      consequence: t('pricing:prospects.deleteBody'),
      confirmLabel: t('pricing:prospects.deleteConfirm'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      selection.clear()
      actions.remove.mutate(rows.map((row) => row.id))
    })

  const rowMenu = (row: ProspectRow): RowAction[] => [
    { key: 'call', icon: Phone, label: t('clients:prospects.rowAction.call'), disabled: !row.primaryPhone, onClick: () => runRowAction('call', row) },
    { key: 'write', icon: Mail, label: t('clients:prospects.rowAction.write'), disabled: !row.primaryEmail, onClick: () => runRowAction('write', row) },
    { key: 'sequence', icon: Workflow, label: t('clients:prospects.rowAction.sequence'), disabled: !row.primaryEmail, onClick: () => runRowAction('sequence', row) },
    { key: 'price', icon: Calculator, label: t('pricing:prospects.calculatePrice'), onClick: () => navigate(`/clients?tab=calculator&prospectId=${row.id}`) },
    ...(!row.billingClientId && row.canEdit ? [{ key: 'promote', icon: UserPlus, label: t('pricing:prospects.promote'), onClick: () => setPromoteTarget(row) }] : []),
    ...(canShare ? [{ key: 'share', icon: MessageSquareShare, label: t('messages:share.action'), onClick: () => share({ type: 'prospect', id: row.id, title: row.name }) }] : []),
    archivedView
      ? { key: 'unarchive', icon: ArchiveRestore, label: t('pricing:prospects.unarchive'), onClick: () => archiveRows([row.id], false) }
      : { key: 'archive', icon: Archive, label: t('common:actions.archive'), onClick: () => archiveRows([row.id], true) },
    ...(row.canEdit ? [{ key: 'delete', icon: Trash2, label: t('common:actions.delete'), destructive: true, onClick: () => deleteRows([row]) }] : []),
  ]

  const countPreview = (draft: FilterClause[]) => api.get<{ total: number | null }>(`/api/prospects/count?${filterParams(draft, q, { kind })}`).then((r) => r.total)
  const resetAll = () => {
    setF([])
    setQ('')
    setViewId('')
  }
  const setCalc = (key: ColumnKey, fn: CalcFn | null) => {
    const next = { ...calcs }
    if (fn) next[key] = fn
    else delete next[key]
    setCalcs(next)
  }

  const noFilters = f.length === 0 && !q
  const brandNew = list.data !== undefined && total === 0 && noFilters && kind === 'companies'
  const selectedRows = companyRows.filter((row) => selection.isSelected(row.id))

  const bar = (
    <SelectionBar
      count={matching ? total : selection.count}
      allSelected={selection.allSelected}
      onSelectAll={selection.selectAll}
      onClear={() => {
        selection.clear()
        setAllMatching(false)
      }}
      placement={desktop ? 'toolbar' : 'floating'}
    >
      {selection.allSelected && !matching && total > companyRows.length ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setAllMatching(true)}>
          {t('clients:prospects.bulk.selectAllMatching', { total: formatNumber(total) })}
        </Button>
      ) : null}
      <SelectionActions
        statuses={statuses}
        assignees={assignees}
        lists={lists.data ?? []}
        allMatching={matching}
        archivedView={archivedView}
        onStatus={(status) =>
          requestStatus(status, (reason) => actions.bulk.mutate({ target, action: 'status', value: status, lostReason: reason }, { onSuccess: () => selection.clear() }))
        }
        onOwner={(userId) => actions.transfer.mutate({ ids: [...selection.selected], toUserId: userId }, { onSuccess: () => selection.clear() })}
        onList={(listId) => actions.addToList.mutate({ listId, target }, { onSuccess: () => selection.clear() })}
        onNewList={can('clienti.prospectare') ? () => setNewListFor(target) : undefined}
        onSequence={() => setSequenceTargets(selectedRows.map(sequenceTarget))}
        onArchive={() => actions.bulk.mutate({ target, action: archivedView ? 'unarchive' : 'archive' }, { onSuccess: () => selection.clear() })}
        onDelete={() => deleteRows(selectedRows)}
      />
    </SelectionBar>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={kind} onValueChange={(next) => setKind(next as ProspectKind)}>
          <TabsList variant="segmented">
            <TabsTrigger value="companies">
              {t('clients:prospects.kinds.companies')} <span className="tabular-nums text-muted-foreground">{countLabel(companiesCount.data)}</span>
            </TabsTrigger>
            <TabsTrigger value="people">
              {t('clients:prospects.kinds.people')} <span className="tabular-nums text-muted-foreground">{countLabel(peopleCount.data)}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {kind === 'companies' ? (
          <Tabs value={layout} onValueChange={(next) => changeLayout(next as Layout)}>
            <TabsList variant="segmented" aria-label={t('clients:layout.label')}>
              <TabsTrigger value="list">{t('clients:layout.list')}</TabsTrigger>
              <TabsTrigger value="board">{t('clients:layout.board')}</TabsTrigger>
              <TabsTrigger value="forecast">{t('clients:layout.forecast')}</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <ViewMenu
            views={views.data}
            active={activeView}
            dirty={dirty}
            history={history}
            fields={fields}
            onApply={applyView}
            onApplyHistory={applyHistory}
            onSaveNew={() => setSaveViewOpen(true)}
            onStar={(view) => viewActions.star.mutate({ id: view.id, starred: !view.starred })}
            onDelete={(view) => {
              viewActions.remove.mutate(view.id)
              if (view.id === viewId) setViewId('')
            }}
          />
          {kind === 'companies' && layout === 'list' ? <ColumnsMenu columns={columns} onChange={setColumns} /> : null}
          {can('clienti.prospectare') && !noFilters ? (
            <Button type="button" variant="outline" onClick={fromSearch}>
              <ListPlus aria-hidden="true" /> {t('clients:lists.fromSearch')}
            </Button>
          ) : null}
          {can('clienti.export') ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-control-md items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Download className="h-4 w-4" aria-hidden="true" /> {t('clients:prospects.export')} <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <ResponsiveMenuContent title={t('clients:prospects.export')}>
                <DropdownMenuItem onClick={() => exportFile('xlsx')}>{t('clients:prospects.exportXlsx')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportFile('csv')}>{t('clients:prospects.exportCsv')}</DropdownMenuItem>
              </ResponsiveMenuContent>
            </DropdownMenu>
          ) : null}
          <Button type="button" variant="outline" onClick={() => navigate('/clients/import')}>
            <Upload aria-hidden="true" /> {t('clients:prospects.import')}
          </Button>
          <Button type="button" onClick={() => setNewSeed({})}>
            <Plus aria-hidden="true" /> {t('clients:prospects.new.trigger')}
          </Button>
        </div>
      </div>

      {activeView && dirty ? (
        <ViewDirtyBar
          view={activeView}
          saving={viewActions.update.isPending}
          onSave={() => viewActions.update.mutate({ id: activeView.id, settings: current, layout })}
          onSaveAsNew={() => setSaveViewOpen(true)}
          onDiscard={() => applyView(activeView)}
        />
      ) : null}

      {selection.count > 0 && desktop ? (
        bar
      ) : (
        <FilterBar fields={fields} clauses={f} onChange={setF} search={q} onSearch={setQ} count={list.data?.total} countPreview={countPreview} pinnedStorageKey={`vd.filters.prospects.${kind}`} onNaturalLanguage={can('asistent.view') ? phraseToClauses : undefined} />
      )}
      {desktop ? null : bar}

      <Card>
        <CardContent className="pt-6">
          {list.isPending ? (
            <ListSkeleton rows={8} />
          ) : list.isError ? (
            <EmptyState kind="filtered" title={t('clients:prospects.loadFailed')} onReset={() => void list.refetch()} />
          ) : brandNew ? (
            <NewAccountEmpty onImport={() => navigate('/clients/import')} onNew={() => setNewSeed({})} />
          ) : total === 0 ? (
            noFilters ? (
              <EmptyState kind="new" title={t('clients:prospects.empty.noPeople')} />
            ) : (
              <EmptyState kind="filtered" title={t('clients:prospects.empty.filteredTitle')} description={t('clients:prospects.empty.filteredBody')} onReset={resetAll} />
            )
          ) : layout === 'board' ? (
            board.isPending ? (
              <BoardSkeleton />
            ) : board.isError ? (
              <EmptyState kind="filtered" title={t('clients:board.loadFailed')} onReset={() => void board.refetch()} />
            ) : (
              <ProspectBoard
                board={board.data}
                statuses={statuses}
                currency={cellContext.currency}
                f={f}
                q={q}
                onOpen={openProspect}
                onMove={(row, status) => requestStatus(status, (reason) => move.mutate({ id: row.id, status, lostReason: reason }))}
              />
            )
          ) : layout === 'forecast' ? (
            forecast.isPending ? (
              <BoardSkeleton />
            ) : forecast.isError ? (
              <EmptyState kind="filtered" title={t('clients:board.loadFailed')} onReset={() => void forecast.refetch()} />
            ) : (
              <ForecastView data={forecast.data} currency={cellContext.currency} />
            )
          ) : kind === 'people' ? (
            <PeopleTable rows={personRows} statuses={statuses} openProspect={openProspect} fetching={list.isPlaceholderData} />
          ) : (
            <ProspectTable
              rows={companyRows}
              columns={columns}
              sort={sort}
              onSort={(key: SortKey) => setSort(nextSort(sort, key))}
              selection={selection}
              ctx={cellContext}
              calcs={calcs}
              onCalc={setCalc}
              f={f}
              q={q}
              run={runRowAction}
              rowMenu={rowMenu}
              fetching={list.isPlaceholderData}
            />
          )}
          {total > 0 && layout === 'list' ? <TablePagination page={page} pageSize={pageSize} total={total} onPage={(next) => setPageAt({ signature, page: next })} onPageSize={setPageSize} /> : null}
        </CardContent>
      </Card>

      {shareDialog}
      <ProspectDrawer list={{ f, q, sort }} />
      <PrimaryContactDialog prospect={contactTarget} onOpenChange={(open) => !open && setContactTarget(null)} />
      <NewProspectDialog seed={newSeed} onOpenChange={(open) => !open && setNewSeed(null)} onOpenProspect={openProspect} />
      <PromoteProspectDialog prospect={promoteTarget} onOpenChange={(open) => !open && setPromoteTarget(null)} />
      <AddToSequenceDialog
        prospects={sequenceTargets}
        onOpenChange={(open) => {
          if (!open) {
            setSequenceTargets([])
            selection.clear()
          }
        }}
      />
      <ListDialog
        open={newListFor !== null}
        list={null}
        folders={folders.data ?? []}
        pending={listActions.createList.isPending}
        onOpenChange={(open) => !open && setNewListFor(null)}
        onSave={(values) =>
          listActions.createList.mutate(values, {
            onSuccess: (created) => {
              if (newListFor) actions.addToList.mutate({ listId: created.id, target: newListFor }, { onSuccess: () => selection.clear() })
              setNewListFor(null)
            },
          })
        }
      />
      <LostReasonDialog
        open={lostPending !== null}
        onOpenChange={(open) => !open && setLostPending(null)}
        onConfirm={(reason) => {
          lostPending?.run(reason)
          setLostPending(null)
        }}
      />
      <SaveViewDialog
        open={saveViewOpen}
        onOpenChange={setSaveViewOpen}
        pending={viewActions.create.isPending}
        onSave={(input) =>
          viewActions.create.mutate(
            { input, settings: current, layout },
            {
              onSuccess: (view) => {
                setViewId(view.id)
                setSaveViewOpen(false)
                void queryClient.invalidateQueries({ queryKey: ['prospects', 'views'] })
              },
            },
          )
        }
      />
    </div>
  )
}
