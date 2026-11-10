import { ChevronDown, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { clauseLabel, type FilterField } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import { cn, normalizeForSearch } from '@/shared/lib/utils'
import type { ProspectView, ViewsResponse } from './types'
import type { SearchEntry } from './view-state'

type ViewTab = 'mine' | 'starred' | 'shared'
const TABS: ViewTab[] = ['mine', 'starred', 'shared']

function historyLabel(entry: SearchEntry, fields: FilterField[]): string {
  const clauses = entry.f.map((clause) => {
    const field = fields.find((candidate) => candidate.key === clause.field)
    return field ? clauseLabel(field, clause) : clause.field
  })
  return [entry.q ? `“${entry.q}”` : null, ...clauses].filter(Boolean).join(' · ')
}

export function ViewMenu({
  views,
  active,
  dirty,
  history,
  fields,
  onApply,
  onApplyHistory,
  onSaveNew,
  onStar,
  onDelete,
}: {
  views: ViewsResponse | undefined
  active: ProspectView | undefined
  dirty: boolean
  history: SearchEntry[]
  fields: FilterField[]
  onApply: (view: ProspectView) => void
  onApplyHistory: (entry: SearchEntry) => void
  onSaveNew: () => void
  onStar: (view: ProspectView) => void
  onDelete: (view: ProspectView) => void
}) {
  const confirm = useConfirm()
  const [tab, setTab] = useState<ViewTab>('mine')
  const [query, setQuery] = useState('')
  const needle = normalizeForSearch(query.trim())
  const shown = (views?.[tab] ?? []).filter((view) => !needle || normalizeForSearch(view.name).includes(needle))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-control-md max-w-full items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {dirty ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
        <span className="truncate">{t('clients:prospects.views.trigger', { name: active?.name ?? t('clients:prospects.views.none') })}</span>
        {dirty ? <span className="sr-only">{t('clients:prospects.views.modified')}</span> : null}
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={t('clients:prospects.views.title')} align="start">
        <div className="w-[min(22rem,calc(100vw-2rem))] max-w-full space-y-2 p-1">
          <div className="flex flex-wrap gap-1" role="group">
            {TABS.map((key) => (
              <Button key={key} type="button" size="sm" variant={tab === key ? 'outline' : 'ghost'} aria-pressed={tab === key} className={tab === key ? 'bg-accent' : undefined} onClick={() => setTab(key)}>
                {t(`clients:prospects.views.tabs.${key}`)}
              </Button>
            ))}
          </div>
          <Input
            value={query}
            aria-label={t('clients:prospects.views.search')}
            placeholder={t('clients:prospects.views.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') e.stopPropagation()
            }}
          />
          <div className="max-h-64 overflow-y-auto">
            {shown.map((view) => (
              <div key={view.id} className="flex items-center gap-1">
                <DropdownMenuItem className={cn('min-w-0 flex-1', view.id === active?.id && 'bg-accent')} onClick={() => onApply(view)}>
                  <span className="truncate">{view.name}</span>
                  {view.isMine ? null : <span className="ml-auto shrink-0 text-xs text-muted-foreground">{view.ownerName}</span>}
                </DropdownMenuItem>
                <Button type="button" variant="ghost" size="icon-sm" aria-pressed={view.starred} title={t(view.starred ? 'clients:prospects.views.unstar' : 'clients:prospects.views.star', { name: view.name })} aria-label={t(view.starred ? 'clients:prospects.views.unstar' : 'clients:prospects.views.star', { name: view.name })} onClick={() => onStar(view)}>
                  <Star className={cn('h-4 w-4', view.starred && 'fill-current')} />
                </Button>
                {view.isMine ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={t('clients:prospects.views.delete', { name: view.name })}
                    aria-label={t('clients:prospects.views.delete', { name: view.name })}
                    onClick={() => void confirm({ title: t('clients:prospects.views.deleteTitle', { name: view.name }), consequence: t('clients:prospects.views.deleteBody'), confirmLabel: t('clients:prospects.views.deleteConfirm'), destructive: true }).then((ok) => ok && onDelete(view))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
            {shown.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t('clients:prospects.views.empty')}</p> : null}
          </div>
          {history.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <p className="px-2 text-xs font-medium text-muted-foreground">{t('clients:prospects.views.recent')}</p>
              <div className="max-h-40 overflow-y-auto">
                {history.map((entry, index) => (
                  <DropdownMenuItem key={index} onClick={() => onApplyHistory(entry)}>
                    <span className="truncate">{historyLabel(entry, fields)}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSaveNew}>{t('clients:prospects.views.saveCurrent')}</DropdownMenuItem>
        </div>
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}

/** Shown under the view menu while the screen differs from the saved view. */
export function ViewDirtyBar({ view, onSave, onSaveAsNew, onDiscard, saving }: { view: ProspectView; onSave: () => void; onSaveAsNew: () => void; onDiscard: () => void; saving: boolean }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
      <span className="text-muted-foreground">{t('clients:prospects.views.dirty', { name: view.name })}</span>
      {view.isMine ? (
        <Button type="button" size="sm" disabled={saving} onClick={onSave}>
          {t('common:actions.save')}
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={onSaveAsNew}>
        {t('clients:prospects.views.saveAsNew')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>
        {t('clients:prospects.views.discard')}
      </Button>
    </div>
  )
}
