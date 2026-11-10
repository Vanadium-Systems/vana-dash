import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { StatusDot } from '@/modules/pricing/status-colors'
import { formatDate, formatMoney, formatNumber, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import type { ProspectAssignee } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import type { ColumnKey } from './columns'
import { NoteCell } from './NoteCell'
import type { ProspectRow } from './types'
import type { ProspectStatusEntry } from '@/shared/lib/types'

export interface CellContext {
  statuses: ProspectStatusEntry[]
  assignees: ProspectAssignee[]
  /** The company's own currency, for a value typed without one. */
  currency: string
  openProspect: (id: string) => void
  /** The pencil of the contact cell: edit the main phone and email in a small dialog. */
  editContact: (row: ProspectRow) => void
  editStatus: (row: ProspectRow, status: string) => void
  editOwner: (row: ProspectRow, userId: string) => void
  editValue: (row: ProspectRow, amount: number | null) => void
}

const statusOf = (ctx: CellContext, key: string) => ctx.statuses.find((status) => status.key === key)

/** A date-only value ("2026-11-30") is shown at noon so no time zone can move it to another day. */
const dayText = (value: string) => formatDate(`${value.slice(0, 10)}T12:00:00`)

export const isOverdue = (task: NonNullable<ProspectRow['nextTask']>) => new Date(task.dueAt).getTime() < Date.now()

/** The plain-text value of a column: what moves under the company name when the column does not fit. */
export function columnText(key: ColumnKey, row: ProspectRow, ctx: CellContext): string | null {
  switch (key) {
    case 'owner':
      return row.ownerName
    case 'status':
      return statusOf(ctx, row.status)?.label ?? row.status
    case 'score':
      return row.score === null ? null : `${row.priority} ${formatNumber(Number(row.score))}`
    case 'contact':
      return row.primaryPhone ?? row.primaryEmail ?? row.primaryPerson
    case 'nextTask':
      return row.nextTask ? `${row.nextTask.title} · ${formatRelativeTime(row.nextTask.dueAt)}` : null
    case 'daysInStage':
      return t('clients:prospects.days', { count: row.daysInStage })
    case 'lastActivityAt':
      return row.lastActivityAt ? formatRelativeTime(row.lastActivityAt) : null
    case 'value':
      return row.valueAmount === null ? null : formatMoney(Number(row.valueAmount), row.valueCurrency ?? ctx.currency, { decimals: 0 })
    case 'expectedCloseAt':
      return row.expectedCloseAt ? dayText(row.expectedCloseAt) : null
    case 'employees':
      return row.employeeCount === null ? null : t('clients:prospects.employeesCount', { count: row.employeeCount })
    case 'revenue':
      return row.revenue === null ? null : formatNumber(Number(row.revenue), BASE_CURRENCY)
    case 'caen':
      return row.caenCode
    case 'source':
      return row.source
    case 'cif':
      return row.cif
    case 'createdAt':
      return formatDate(row.createdAt)
    case 'note':
      return null
  }
}

const Empty = () => <span className="text-muted-foreground">—</span>

/**
 * A cell you can edit in place: Enter or a click opens the editor, Esc leaves it. When it is not
 * being edited it is a focus stop of the arrow-key grid (`data-cell-*`, see cell-grid.ts).
 */
/** Opens the list on the click that started the edit. Without it a second click was needed, and
 *  Chrome on Linux opens the list with the current option under the pointer, so releasing that
 *  second click already picked a colleague. */
function openPicker(el: HTMLSelectElement | null) {
  if (!el) return
  el.focus()
  try {
    el.showPicker()
  } catch {
    // No user activation left (opened from the keyboard after a delay): the focused select still works.
  }
}

function EditableCell({ rowIndex, colIndex, label, display, editor }: { rowIndex: number; colIndex: number; label: string; display: ReactNode; editor: (stop: () => void) => ReactNode }) {
  const [editing, setEditing] = useState(false)
  const cell = useRef<HTMLDivElement>(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    // Back to the cell after an edit, so the arrows keep working from where the person was.
    if (!editing && wasEditing.current) cell.current?.focus()
    wasEditing.current = editing
  }, [editing])

  if (editing) {
    return (
      <div
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(false)
          }
        }}
      >
        {editor(() => setEditing(false))}
      </div>
    )
  }
  return (
    <div
      ref={cell}
      role="button"
      tabIndex={0}
      data-cell-row={rowIndex}
      data-cell-col={colIndex}
      aria-label={label}
      className="-mx-1 min-h-6 cursor-text rounded-sm px-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault()
          setEditing(true)
        }
      }}
    >
      {display}
    </div>
  )
}

function ContactCell({ row, ctx }: { row: ProspectRow; ctx: CellContext }) {
  const navigate = useNavigate()
  if (!row.primaryPhone && !row.primaryEmail && !row.primaryPerson) {
    return row.canEdit ? (
      <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => ctx.openProspect(row.id)}>
        {t('clients:prospects.contact.add')}
      </button>
    ) : (
      <Empty />
    )
  }
  return (
    // The pencil sits in the middle of the cell, only on hover or focus; touch screens use the row menu.
    <div className="relative min-w-0 max-w-[13rem] pr-8 text-xs leading-tight">
      {row.primaryPerson ? <div className="truncate text-muted-foreground">{row.primaryPerson}</div> : null}
      {row.primaryPhone ? (
        <a href={`tel:${row.primaryPhone}`} className="block truncate text-primary underline">
          {row.primaryPhone}
        </a>
      ) : null}
      {row.primaryEmail ? (
        <a
          href={`/email?to=${encodeURIComponent(row.primaryEmail)}`}
          title={row.primaryEmail}
          className="block truncate text-primary underline"
          onClick={(e) => {
            e.preventDefault()
            navigate(`/email?to=${encodeURIComponent(row.primaryEmail!)}`)
          }}
        >
          {row.primaryEmail}
        </a>
      ) : null}
      {row.canEdit ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden"
          title={t('clients:prospects.contact.edit')}
          aria-label={t('clients:prospects.contact.edit')}
          onClick={() => ctx.editContact(row)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export function ColumnCell({ columnKey, colIndex, rowIndex, row, ctx }: { columnKey: ColumnKey; colIndex: number; rowIndex: number; row: ProspectRow; ctx: CellContext }) {
  const text = columnText(columnKey, row, ctx)
  switch (columnKey) {
    case 'status': {
      const entry = statusOf(ctx, row.status)
      const display = (
        <span className="inline-flex items-center gap-2">
          {entry ? <StatusDot token={entry.colorToken} /> : null}
          <span className="truncate">{text}</span>
        </span>
      )
      if (!row.canEdit) return display
      return (
        <EditableCell
          rowIndex={rowIndex}
          colIndex={colIndex}
          label={t('clients:prospects.edit.status', { name: row.name })}
          display={display}
          editor={(stop) => (
            <Select
              size="sm"
              ref={openPicker}
              className="w-36"
              aria-label={t('clients:prospects.edit.status', { name: row.name })}
              value={row.status}
              onBlur={stop}
              onValueChange={(status) => {
                stop()
                if (status !== row.status) ctx.editStatus(row, status)
              }}
            >
              {entry ? null : <option value={row.status}>{row.status}</option>}
              {ctx.statuses.map((status) => (
                <option key={status.id} value={status.key}>
                  {status.label}
                </option>
              ))}
            </Select>
          )}
        />
      )
    }
    case 'owner': {
      const display = text ? <span className="block max-w-[12rem] truncate" title={text}>{text}</span> : <span className="text-muted-foreground">{t('clients:prospects.noOwner')}</span>
      if (!row.canEdit) return display
      return (
        <EditableCell
          rowIndex={rowIndex}
          colIndex={colIndex}
          label={t('clients:prospects.edit.owner', { name: row.name })}
          display={display}
          editor={(stop) => (
            <Select
              size="sm"
              ref={openPicker}
              className="w-36"
              aria-label={t('clients:prospects.edit.owner', { name: row.name })}
              value={row.assignedUserId ?? ''}
              onBlur={stop}
              onValueChange={(userId) => {
                stop()
                if (userId && userId !== row.assignedUserId) ctx.editOwner(row, userId)
              }}
            >
              <option value="" disabled>
                {t('clients:prospects.noOwner')}
              </option>
              {ctx.assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName ?? person.email}
                </option>
              ))}
            </Select>
          )}
        />
      )
    }
    case 'value': {
      const display = <span className="tabular-nums">{text ?? <Empty />}</span>
      if (!row.canEdit) return display
      return (
        <EditableCell
          rowIndex={rowIndex}
          colIndex={colIndex}
          label={t('clients:prospects.edit.value', { name: row.name })}
          display={display}
          editor={(stop) => (
            <Input
              autoFocus
              className="h-control-sm w-28 text-right tabular-nums"
              inputMode="decimal"
              aria-label={t('clients:prospects.edit.value', { name: row.name })}
              defaultValue={row.valueAmount === null ? '' : String(Number(row.valueAmount))}
              onBlur={(e) => {
                const typed = e.target.value.trim()
                const amount = typed ? parseRoDecimal(typed) : null
                stop()
                if (amount !== null && (Number.isNaN(amount) || amount < 0)) return
                if (amount !== (row.valueAmount === null ? null : Number(row.valueAmount))) ctx.editValue(row, amount)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          )}
        />
      )
    }
    case 'score':
      // The table puts the priority badge beside it; `text` carries the priority for the details and the export.
      return row.score === null ? <Empty /> : <span className="tabular-nums">{formatNumber(Number(row.score))}</span>
    case 'contact':
      return <ContactCell row={row} ctx={ctx} />
    case 'note':
      return <NoteCell row={row} />
    case 'nextTask':
      return row.nextTask ? (
        <span className={`block max-w-[14rem] truncate ${isOverdue(row.nextTask) ? 'text-destructive-text' : ''}`} title={text ?? undefined}>
          {text}
        </span>
      ) : (
        <Empty />
      )
    case 'daysInStage':
    case 'employees':
    case 'revenue':
    case 'createdAt':
      return <span className="whitespace-nowrap tabular-nums">{text ?? <Empty />}</span>
    default:
      return text ? <span className="block max-w-[12rem] truncate">{text}</span> : <Empty />
  }
}
