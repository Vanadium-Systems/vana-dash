import { useQuery } from '@tanstack/react-query'
import { useId, useState, type KeyboardEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { BillingClient } from '@/shared/lib/types'
import { cn, normalizeForSearch } from '@/shared/lib/utils'

const MAX_SHOWN = 8

/** "Contract nou": a client is picked from a searchable list, then its contract opens in the peek. */
export function ContractClientPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (clientId: string) => void }) {
  const listId = useId()
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const clients = useQuery({ queryKey: ['billing-clients'], queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients'), enabled: open })

  const needle = normalizeForSearch(search.trim())
  const matches = (clients.data ?? []).filter((c) => !needle || normalizeForSearch(c.name).includes(needle) || normalizeForSearch(c.cif).includes(needle)).slice(0, MAX_SHOWN)

  const pick = (client: BillingClient) => {
    onPick(client.id)
    onOpenChange(false)
    setSearch('')
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && matches[active]) {
      e.preventDefault()
      pick(matches[active]!)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-density="comfortable">
        <DialogHeader>
          <DialogTitle>{t('accounting:contracts.list.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="contract-client">{t('accounting:contracts.selectClient')}</Label>
          <Input
            id="contract-client"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={matches[active] ? `${listId}-${matches[active]!.id}` : undefined}
            autoComplete="off"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto">
            {matches.map((client, index) => (
              <li
                key={client.id}
                id={`${listId}-${client.id}`}
                role="option"
                aria-selected={index === active}
                className={cn('flex min-h-control-md cursor-pointer items-center gap-2 rounded-sm px-2 text-sm', index === active ? 'bg-accent' : 'hover:bg-accent')}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(client)}
              >
                <span className="min-w-0 flex-1 truncate">{client.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{client.cif}</span>
              </li>
            ))}
          </ul>
          {!clients.isPending && matches.length === 0 ? <p className="text-sm text-muted-foreground">{t('accounting:contracts.noClientFound')}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
