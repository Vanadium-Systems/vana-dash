import type { LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { Button } from './button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

export interface RowAction {
  key: string
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  spinning?: boolean
}

// The last cell of a table row. In a wide table `actions` are icon buttons and `menu` sits behind ⋯;
// in a narrow one (`.tbl-inline` hidden by the table's container query) everything goes behind one
// ⋯, because a row of four buttons is what pushed tables wider than a phone. A single action with
// no menu stays a button at every width.
export function RowActions({ actions, menu = [] }: { actions: RowAction[]; menu?: RowAction[] }) {
  const single = actions.length === 1 && menu.length === 0
  const firstInline = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // The menu renders in a portal, outside the table's container query, so it asks the row instead.
  const [compact, setCompact] = useState(false)
  if (actions.length === 0 && menu.length === 0) return null
  return (
    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
      {actions.map((action, index) => (
        <Button
          key={action.key}
          ref={index === 0 ? firstInline : undefined}
          variant="outline"
          size="icon"
          title={action.label}
          aria-label={action.label}
          disabled={action.disabled}
          onClick={action.onClick}
          className={single ? undefined : 'tbl-inline'}
        >
          <action.icon className={cn('h-4 w-4', action.spinning && 'animate-spin')} />
        </Button>
      ))}
      {single ? null : (
        <DropdownMenu
          open={open}
          onOpenChange={(next) => {
            if (next) setCompact(!firstInline.current || firstInline.current.offsetParent === null)
            setOpen(next)
          }}
        >
          <DropdownMenuTrigger
            className={cn(
              'inline-flex h-control-md w-control-md items-center justify-center rounded-md border border-border bg-background hover:bg-accent',
              menu.length === 0 && 'tbl-narrow-only',
            )}
          >
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">{t('common:labels.actions')}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {(compact ? actions : []).map((action) => (
              <DropdownMenuItem key={action.key} disabled={action.disabled} destructive={action.destructive} onClick={action.onClick}>
                <action.icon className="h-4 w-4" /> {action.label}
              </DropdownMenuItem>
            ))}
            {menu.map((action) => (
              <DropdownMenuItem key={action.key} disabled={action.disabled} destructive={action.destructive} onClick={action.onClick}>
                <action.icon className="h-4 w-4" /> {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
