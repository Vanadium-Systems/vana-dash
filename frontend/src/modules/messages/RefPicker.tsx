import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { api } from '@/shared/lib/api'
import { parseDashLink } from '@/shared/lib/entity-links'
import { t } from '@/shared/lib/i18n'
import type { RefInput } from './useThreadMessages'

// `#` in the composer: the Ctrl K search over invoices, clients, emails, files and events. A
// result becomes a chip; results the app cannot share (links that do not point at one object)
// are left out.

interface SearchGroup {
  group: string
  feature: string
  items: { id: string; label: string; sublabel: string | null; to: string }[]
}

export function RefPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (ref: RefInput) => void }) {
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term.trim(), 250)
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchGroup[]>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  })

  const groups = (results.data ?? [])
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        const link = parseDashLink(item.to)
        return link ? [{ ...item, link }] : []
      }),
    }))
    .filter((group) => group.items.length > 0)

  const close = () => {
    setTerm('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('messages:picker.title')}</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('messages:picker.placeholder')} aria-label={t('messages:picker.placeholder')} />
        <div className="max-h-80 min-h-24 overflow-y-auto">
          {debounced.length < 2 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('messages:picker.hint')}</p>
          ) : results.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('common:states.loading')}</p>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('messages:picker.none')}</p>
          ) : (
            groups.map((group) => (
              <section key={group.group} aria-label={group.group} className="py-1">
                <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.group}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full min-w-0 flex-col items-start rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        onClick={() => {
                          setTerm('')
                          onPick({ type: item.link.type, id: item.link.id, title: item.label })
                        }}
                      >
                        <span className="w-full truncate text-sm">{item.label}</span>
                        {item.sublabel ? <span className="w-full truncate text-xs text-muted-foreground">{item.sublabel}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
