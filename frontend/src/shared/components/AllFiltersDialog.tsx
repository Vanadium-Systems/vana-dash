import { ChevronDown, Search, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FilterValueEditor } from '@/shared/components/FilterValueEditor'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { clauseValueLabel, replaceClause, resultsLabel, serializeClauses, type FilterClause, type FilterField } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import { cn, normalizeForSearch } from '@/shared/lib/utils'

interface AllFiltersProps {
  fields: FilterField[]
  clauses: FilterClause[]
  /** Without them the star next to each field is not shown (filters saved with a rule, not pinned to a bar). */
  pinned?: Set<string>
  onTogglePin?: (key: string) => void
  /** Live count for the draft; `null` = the server could not count in time. */
  countPreview?: (draft: FilterClause[]) => Promise<number | null>
  onApply: (draft: FilterClause[]) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AllFiltersDialog({ open, onOpenChange, ...rest }: AllFiltersProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl">
        <Body {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ fields, clauses, pinned, onTogglePin, countPreview, onApply, onClose }: Omit<AllFiltersProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  // The edits live in a copy, so a person can try filters and watch the count before applying any.
  const [draft, setDraft] = useState(clauses)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [count, setCount] = useState<number | null | undefined>(undefined)

  const draftKey = serializeClauses(draft)
  useEffect(() => {
    if (!countPreview) return
    let stale = false
    setCount(undefined)
    const timer = setTimeout(() => {
      countPreview(draft)
        .then((total) => !stale && setCount(total))
        .catch(() => !stale && setCount(undefined))
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
    // `draft` is covered by its serialized form.
  }, [draftKey, countPreview])

  const groups = useMemo(() => {
    const needle = normalizeForSearch(search.trim())
    const shown = needle ? fields.filter((field) => normalizeForSearch(field.label).includes(needle)) : fields
    const byGroup = new Map<string, FilterField[]>()
    for (const field of shown) byGroup.set(field.group ?? '', [...(byGroup.get(field.group ?? '') ?? []), field])
    return [...byGroup]
  }, [fields, search])

  const commit = (field: FilterField, next: FilterClause | null) =>
    setDraft((current) =>
      replaceClause(
        current,
        current.findIndex((clause) => clause.field === field.key),
        next,
      ),
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('common:filterBar.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('common:filterBar.dialogHint')}</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('common:filterBar.fieldSearch')} placeholder={t('common:filterBar.fieldSearch')} />
      </div>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto">
        {groups.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t('common:filterBar.noFields')}</p> : null}
        {groups.map(([group, groupFields]) => (
          <section key={group}>
            {group ? <h3 className="px-2 pb-1 text-xs text-muted-foreground">{group}</h3> : null}
            {groupFields.map((field) => {
              const clause = draft.find((entry) => entry.field === field.key)
              const isOpen = expanded === field.key
              const isPinned = pinned?.has(field.key) ?? false
              return (
                <div key={field.key}>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" aria-expanded={isOpen} className="min-w-0 flex-1 justify-between" onClick={() => setExpanded(isOpen ? null : field.key)}>
                      <span className="truncate">{field.label}</span>
                      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        {clause ? <span className="truncate font-normal">{clauseValueLabel(field, clause)}</span> : null}
                        <ChevronDown className={cn('transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                      </span>
                    </Button>
                    {onTogglePin ? (
                      <Button type="button" variant="ghost" size="icon" aria-pressed={isPinned} aria-label={t(isPinned ? 'common:filterBar.unpinFilter' : 'common:filterBar.pinFilter', { field: field.label })} title={t(isPinned ? 'common:filterBar.unpinFilter' : 'common:filterBar.pinFilter', { field: field.label })} onClick={() => onTogglePin(field.key)}>
                        <Star className={cn(isPinned && 'fill-current')} aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <div className="px-2 pb-3 pt-1">
                      <FilterValueEditor field={field} clause={clause} onChange={(next) => commit(field, next)} />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>
        ))}
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <span aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
          {countPreview ? (count === undefined ? t('common:filterBar.counting') : resultsLabel(count)) : null}
        </span>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" disabled={draft.length === 0} onClick={() => setDraft([])}>
            {t('common:actions.reset')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            {t('common:actions.apply')}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
