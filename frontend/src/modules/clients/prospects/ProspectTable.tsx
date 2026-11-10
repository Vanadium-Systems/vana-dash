import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/shared/components/ui/badge'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { RowActions, type RowAction } from '@/shared/components/ui/row-actions'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import type { useSelection } from '@/shared/hooks/use-selection'
import type { FilterClause } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { CalcCell } from './CalcCell'
import { moveCellFocus } from './cell-grid'
import { ColumnCell, columnText, type CellContext } from './cells'
import { columnDef, type ColumnKey } from './columns'
import { RowSplit, type RowActionKind } from './RowSplit'
import { NoteCell } from './NoteCell'
import type { CalcFn, ProspectPriority, ProspectRow, SortKey, SortState } from './types'

const PRIORITY_VARIANT: Record<ProspectPriority, 'destructive' | 'warning' | 'secondary' | 'outline'> = { HOT: 'destructive', WARM: 'warning', NURTURE: 'secondary', SKIP: 'outline' }

const RIGHT_ALIGNED = new Set<ColumnKey>(['score', 'daysInStage', 'value', 'employees', 'revenue'])
const alignOf = (key: ColumnKey) => (RIGHT_ALIGNED.has(key) ? 'text-right' : undefined)

function SortHead({ columnKey, label, sort, onSort }: { columnKey: SortKey; label: string; sort: SortState | null; onSort: (key: SortKey) => void }) {
  const active = sort?.key === columnKey
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <button type="button" className={cn('inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'text-foreground')} onClick={() => onSort(columnKey)}>
      {label}
      <Icon className={cn('h-3 w-3', !active && 'opacity-40')} aria-hidden="true" />
    </button>
  )
}

export function ProspectTable({
  rows,
  columns,
  sort,
  onSort,
  selection,
  ctx,
  calcs,
  onCalc,
  f,
  q,
  run,
  rowMenu,
  fetching,
}: {
  rows: ProspectRow[]
  columns: ColumnKey[]
  sort: SortState | null
  onSort: (key: SortKey) => void
  selection: ReturnType<typeof useSelection<string>>
  ctx: CellContext
  calcs: Record<string, CalcFn>
  onCalc: (key: ColumnKey, fn: CalcFn | null) => void
  f: FilterClause[]
  q: string
  run: (kind: RowActionKind, row: ProspectRow) => void
  rowMenu: (row: ProspectRow) => RowAction[]
  /** The next page is loading: the old rows stay, dimmed. */
  fetching: boolean
}) {
  const hasCalcColumn = columns.some((key) => columnDef(key).calc)
  const sortLabel = (key: SortKey) => (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none')

  const headCell = (key: ColumnKey): ReactNode => {
    const def = columnDef(key)
    const label = t(`clients:prospects.columns.${key}`)
    return (
      <TableHead key={key} priority={def.priority} className={alignOf(key)} aria-sort={def.sort ? sortLabel(def.sort) : undefined}>
        {def.sort ? <SortHead columnKey={def.sort} label={label} sort={sort} onSort={onSort} /> : label}
      </TableHead>
    )
  }

  return (
    <div className={cn('transition-opacity', fetching && 'opacity-60')} aria-busy={fetching}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox checked={selection.allSelected} indeterminate={selection.someSelected} aria-label={t('common:selection.all')} onChange={() => (selection.allSelected ? selection.clear() : selection.selectAll())} />
            </TableHead>
            <TableHead aria-sort={sortLabel('name')}>
              <SortHead columnKey="name" label={t('common:labels.company')} sort={sort} onSort={onSort} />
            </TableHead>
            {columns.map(headCell)}
            <TableHead className="text-right">
              <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody
          onKeyDown={(e) => {
            if (e.target instanceof HTMLElement && moveCellFocus(e.currentTarget, e.target, e.key)) e.preventDefault()
          }}
        >
          {rows.map((row, rowIndex) => {
            const selected = selection.isSelected(row.id)
            const textOf = (priority: 'md' | 'lg') => columns.filter((key) => columnDef(key).priority === priority).map((key) => columnText(key, row, ctx))
            return (
              <TableRow
                key={row.id}
                data-row-id={row.id}
                aria-selected={selected}
                className={cn('group', selected && 'bg-accent/50')}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label,[role="button"]')) return
                  if (!selection.onRowClick(e, row.id)) ctx.openProspect(row.id)
                }}
              >
                <TableCell>
                  <Checkbox
                    checked={selected}
                    aria-label={t('clients:prospects.selectRow', { name: row.name })}
                    onChange={() => undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (e.shiftKey) selection.onRowClick(e, row.id)
                      else selection.toggle(row.id)
                    }}
                  />
                </TableCell>
                <TableCell className="tbl-fill tbl-fill-lg md:max-w-[16rem]">
                  <button
                    type="button"
                    className="block max-w-full truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(e) => {
                      if (!selection.onRowClick(e, row.id)) ctx.openProspect(row.id)
                    }}
                  >
                    {row.name}
                  </button>
                  <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className="truncate">{row.cif ?? t('clients:prospects.noCif')}</span>
                    {row.archivedAt ? <Badge variant="outline">{t('clients:prospects.archived')}</Badge> : null}
                  </div>
                  <div className="tbl-lg-fallback truncate text-xs text-muted-foreground">{textOf('lg').filter(Boolean).join(' · ')}</div>
                  <TableDetails items={textOf('md')} />
                  {columns.includes('note') ? (
                    <div className="tbl-narrow-only mt-1">
                      <NoteCell row={row} />
                    </div>
                  ) : null}
                </TableCell>
                {columns.map((key, colIndex) => (
                  <TableCell key={key} priority={columnDef(key).priority} className={alignOf(key)}>
                    {key === 'score' && row.score !== null ? (
                      <span className="inline-flex items-center justify-end gap-2">
                        <Badge variant={PRIORITY_VARIANT[row.priority]}>{row.priority}</Badge>
                        <ColumnCell columnKey={key} colIndex={colIndex} rowIndex={rowIndex} row={row} ctx={ctx} />
                      </span>
                    ) : (
                      <ColumnCell columnKey={key} colIndex={colIndex} rowIndex={rowIndex} row={row} ctx={ctx} />
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <span className="tbl-inline">
                      <RowSplit row={row} run={run} />
                    </span>
                    <RowActions actions={[]} menu={rowMenu(row)} title={row.name} />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        {hasCalcColumn ? (
          <tfoot>
            <TableRow className="hover:bg-transparent">
              <TableCell />
              <TableCell className="text-xs text-muted-foreground">{t('clients:prospects.calc.label')}</TableCell>
              {columns.map((key) => {
                const def = columnDef(key)
                return (
                  <TableCell key={key} priority={def.priority} className={alignOf(key)}>
                    {def.calc ? (
                      <CalcCell field={def.calc} fn={calcs[key]} f={f} q={q} currency={ctx.currency} label={t('clients:prospects.calc.for', { column: t(`clients:prospects.columns.${key}`) })} onChange={(fn) => onCalc(key, fn)} />
                    ) : null}
                  </TableCell>
                )
              })}
              <TableCell />
            </TableRow>
          </tfoot>
        ) : null}
      </Table>
    </div>
  )
}
