import { Palette, Tag } from 'lucide-react'
import { useState } from 'react'
import { ColorPicker } from '@/shared/components/ui/color-picker'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import type { LabelCount } from './notes-api'

const TRIGGER = 'inline-flex h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** The palette button: a popover with the shared swatches. */
export function ColorMenu({ value, onChange, align = 'start', className, label }: { value: number | null; onChange: (color: number | null) => void; align?: 'start' | 'end'; className?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className={cn(TRIGGER, className)}>
        <Palette className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{label ?? t('notes:color')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <div className="p-2">
          <ColorPicker
            value={value}
            onChange={(color) => {
              onChange(color)
              setOpen(false)
            }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Picks one of the person's labels or types a new one; used by the selection bar. */
export function LabelMenu({ labels, onPick, align = 'start' }: { labels: LabelCount[]; onPick: (label: string) => void; align?: 'start' | 'end' }) {
  const [draft, setDraft] = useState('')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-control-sm items-center gap-2 rounded-md px-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Tag className="h-4 w-4" aria-hidden="true" />
        {t('notes:label.add')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <form
          className="p-1"
          onSubmit={(e) => {
            e.preventDefault()
            const name = draft.trim()
            if (!name) return
            setDraft('')
            onPick(name)
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={50} placeholder={t('notes:label.newPlaceholder')} aria-label={t('notes:label.newPlaceholder')} />
        </form>
        {labels.map((label) => (
          <DropdownMenuItem key={label.name} onClick={() => onPick(label.name)}>
            {label.name}
            <span className="tnum ml-auto text-xs text-muted-foreground">{label.count}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

