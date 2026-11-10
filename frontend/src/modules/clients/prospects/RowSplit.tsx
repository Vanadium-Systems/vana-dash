import { ChevronDown, ListPlus, Mail, Phone, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import type { ProspectRow } from './types'

export type RowActionKind = 'call' | 'write' | 'sequence'

export const ROW_ACTIONS: Array<{ kind: RowActionKind; icon: LucideIcon }> = [
  { kind: 'call', icon: Phone },
  { kind: 'write', icon: Mail },
  { kind: 'sequence', icon: ListPlus },
]

const isRowAction = (value: unknown): value is RowActionKind => ROW_ACTIONS.some((action) => action.kind === value)

/** Whether the row has what the action needs: a phone to call, an email to write to or to enrol. */
export function rowActionAvailable(kind: RowActionKind, row: Pick<ProspectRow, 'primaryPhone' | 'primaryEmail'>): boolean {
  return kind === 'call' ? Boolean(row.primaryPhone) : Boolean(row.primaryEmail)
}

/** The remembered choice; when this row cannot do it, the first one it can, so the button is never dead for no reason. */
export function effectiveRowAction(preferred: RowActionKind, row: Pick<ProspectRow, 'primaryPhone' | 'primaryEmail'>): RowActionKind {
  if (rowActionAvailable(preferred, row)) return preferred
  return ROW_ACTIONS.find((action) => rowActionAvailable(action.kind, row))?.kind ?? preferred
}

function useRowActionChoice(): [RowActionKind, (kind: RowActionKind) => void] {
  const userId = useMe().session?.user.id ?? 'anon'
  const storageKey = `vd.prospects.rowAction.${userId}`
  const [choice, setChoice] = useState<RowActionKind>(() => {
    const saved = localStorage.getItem(storageKey)
    return isRowAction(saved) ? saved : 'call'
  })
  return [
    choice,
    (kind) => {
      setChoice(kind)
      try {
        localStorage.setItem(storageKey, kind)
      } catch {
        // Kept for this visit only.
      }
    },
  ]
}

export function useRowActionRunner(onSequence: (row: ProspectRow) => void) {
  const navigate = useNavigate()
  return (kind: RowActionKind, row: ProspectRow) => {
    if (kind === 'call' && row.primaryPhone) window.location.href = `tel:${row.primaryPhone}`
    else if (kind === 'write' && row.primaryEmail) navigate(`/email?to=${encodeURIComponent(row.primaryEmail)}`)
    else if (kind === 'sequence') onSequence(row)
  }
}

/** Main action of the row with a ▾ to pick another; the pick is remembered per person. Hidden until hover on a mouse screen. */
export function RowSplit({ row, run }: { row: ProspectRow; run: (kind: RowActionKind, row: ProspectRow) => void }) {
  const [preferred, setPreferred] = useRowActionChoice()
  const kind = effectiveRowAction(preferred, row)
  const main = ROW_ACTIONS.find((action) => action.kind === kind)!
  const label = t(`clients:prospects.rowAction.${kind}`)
  return (
    <div className="inline-flex opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={(e) => e.stopPropagation()}>
      <Button type="button" variant="outline" size="sm" className="rounded-r-none" disabled={!rowActionAvailable(kind, row)} onClick={() => run(kind, row)}>
        <main.icon aria-hidden="true" /> {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-control-sm w-control-sm items-center justify-center rounded-md rounded-l-none border border-l-0 border-border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('clients:prospects.rowAction.pick')}</span>
        </DropdownMenuTrigger>
        <ResponsiveMenuContent title={row.name}>
          {ROW_ACTIONS.map((action) => (
            <DropdownMenuItem
              key={action.kind}
              disabled={!rowActionAvailable(action.kind, row)}
              onClick={() => {
                setPreferred(action.kind)
                run(action.kind, row)
              }}
            >
              <action.icon className="h-4 w-4" /> {t(`clients:prospects.rowAction.${action.kind}`)}
            </DropdownMenuItem>
          ))}
        </ResponsiveMenuContent>
      </DropdownMenu>
    </div>
  )
}
