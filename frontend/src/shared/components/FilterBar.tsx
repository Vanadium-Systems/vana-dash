import { ChevronLeft, ListFilter, Search, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AllFiltersDialog } from '@/shared/components/AllFiltersDialog'
import { FilterValueEditor } from '@/shared/components/FilterValueEditor'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { FilterChip, FilterMenuTrigger } from '@/shared/components/ui/filter-chip'
import { Input } from '@/shared/components/ui/input'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { clauseLabel, parseClauses, replaceClause, resultsLabel, serializeClauses, type FilterClause, type FilterField } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import { normalizeForSearch } from '@/shared/lib/utils'

export type { FilterClause, FilterField } from '@/shared/lib/filters'

/** The list's filters in `?f=` (compact JSON, the backend's own shape). Other params stay as they are. */
export function useFilterState(param = 'f'): [FilterClause[], (next: FilterClause[]) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(param)
  const clauses = useMemo(() => parseClauses(raw), [raw])
  const setClauses = useCallback(
    (next: FilterClause[]) =>
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          const serialized = serializeClauses(next)
          if (serialized) params.set(param, serialized)
          else params.delete(param)
          return params
        },
        { replace: true },
      ),
    [param, setSearchParams],
  )
  return [clauses, setClauses]
}

export function useSearchState(param = 'q'): [string, (next: string) => void] {
  return useUrlState(param)
}

function readPinned(storageKey: string, fields: FilterField[]): string[] {
  try {
    const saved = localStorage.getItem(storageKey)
    const parsed: unknown = saved ? JSON.parse(saved) : null
    if (Array.isArray(parsed) && parsed.every((key) => typeof key === 'string')) return parsed
  } catch {
    // Unreadable storage: the defaults below.
  }
  return fields.filter((field) => field.defaultPinned).map((field) => field.key)
}

function usePinnedFields(storageKey: string, fields: FilterField[]): [Set<string>, (key: string) => void] {
  const [keys, setKeys] = useState(() => readPinned(storageKey, fields))
  const toggle = useCallback(
    (key: string) =>
      setKeys((current) => {
        const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
        try {
          localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          // Kept for this visit only.
        }
        return next
      }),
    [storageKey],
  )
  return [useMemo(() => new Set(keys), [keys]), toggle]
}

const PINNED_TRIGGER = 'inline-flex h-control-sm items-center rounded-full border border-dashed px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const LABEL_TRIGGER = 'rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface FilterBarProps {
  fields: FilterField[]
  clauses: FilterClause[]
  onChange: (next: FilterClause[]) => void
  search: string
  onSearch: (next: string) => void
  /** Result count; `null` = the server could not count in time. */
  count?: number | null
  /** Count for filters not applied yet, shown live in "Toate filtrele". */
  countPreview?: (draft: FilterClause[]) => Promise<number | null>
  pinnedStorageKey: string
  /** Buttons at the end of the bar (import, export). */
  actions?: ReactNode
  /** Turns a phrase into clauses; without it the bar has no phrase field. Rejecting shows the error under the field. */
  onNaturalLanguage?: (text: string) => Promise<NaturalLanguageResult>
}

export interface NaturalLanguageResult {
  clauses: FilterClause[]
  /** The server's one-sentence reading of the phrase. */
  understood?: string
  /** How many parts of the phrase could not become a filter. */
  dropped?: number
}

const sameClause = (a: FilterClause, b: FilterClause) => JSON.stringify(a) === JSON.stringify(b)

export function FilterBar({ fields, clauses, onChange, search, onSearch, count, countPreview, pinnedStorageKey, actions, onNaturalLanguage }: FilterBarProps) {
  const [pinned, togglePin] = usePinnedFields(pinnedStorageKey, fields)
  const [allOpen, setAllOpen] = useState(false)
  const phrase = usePhrase(onNaturalLanguage, clauses, onChange)
  const fieldOf = (key: string) => fields.find((field) => field.key === key)

  const commit = useCallback(
    (field: FilterField, next: FilterClause | null) =>
      onChange(
        replaceClause(
          clauses,
          clauses.findIndex((clause) => clause.field === field.key),
          next,
        ),
      ),
    [clauses, onChange],
  )

  // Typing is kept here and sent after a pause; the URL (and the list query) only sees the pause.
  const [typed, setTyped] = useState(search)
  const sent = useRef(search)
  useEffect(() => {
    if (search !== sent.current) {
      sent.current = search
      setTyped(search)
    }
  }, [search])
  useEffect(() => {
    if (typed === sent.current) return
    const timer = setTimeout(() => {
      sent.current = typed
      onSearch(typed)
    }, 300)
    return () => clearTimeout(timer)
  }, [typed, onSearch])

  const pinnedIdle = fields.filter((field) => pinned.has(field.key) && !clauses.some((clause) => clause.field === field.key))
  const active = Boolean(clauses.length || search || typed)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 basis-full sm:basis-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-8" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t('common:filterBar.search')} placeholder={t('common:filterBar.searchPlaceholder')} />
      </div>

      {/* A second line on a phone; on a wide screen the chips sit in the same row as the buttons. */}
      {clauses.length > 0 || pinnedIdle.length > 0 ? (
        <div className="order-last flex basis-full flex-wrap items-center gap-2 sm:order-none sm:contents">
          {clauses.map((clause, index) => {
            const field = fieldOf(clause.field)
            const label = field ? clauseLabel(field, clause) : clause.field
            return (
              <FilterChip
                key={`${clause.field}-${index}`}
                label={label}
                note={phrase.fromPhrase.some((entry) => sameClause(entry, clause)) ? t('common:filterBar.nl.fromPhrase') : undefined}
                onRemove={() => onChange(replaceClause(clauses, index, null))}
                renderLabel={
                  field
                    ? (text) => (
                        <FieldMenu field={field} clause={clause} onCommit={(next) => commit(field, next)} trigger={<DropdownMenuTrigger className={LABEL_TRIGGER}><span className="sr-only">{t('common:filterBar.edit', { filter: text })}</span><span aria-hidden="true">{text}</span></DropdownMenuTrigger>} />
                      )
                    : undefined
                }
              />
            )
          })}
          {pinnedIdle.map((field) => (
            <FieldMenu key={field.key} field={field} clause={undefined} onCommit={(next) => commit(field, next)} trigger={<DropdownMenuTrigger className={PINNED_TRIGGER}>{field.label}</DropdownMenuTrigger>} />
          ))}
        </div>
      ) : null}

      <AddFilterMenu fields={fields} clauses={clauses} onCommit={commit} />
      {onNaturalLanguage ? (
        <Button type="button" variant="outline" aria-expanded={phrase.open} onClick={phrase.toggle}>
          <Sparkles aria-hidden="true" /> {t('common:filterBar.nl.button')}
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={() => setAllOpen(true)}>
        <ListFilter aria-hidden="true" /> {t('common:filterBar.allFilters')}
      </Button>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onChange([])
            setTyped('')
            sent.current = ''
            onSearch('')
          }}
        >
          {t('common:actions.reset')}
        </Button>
      ) : null}
      {count !== undefined ? (
        <span aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
          {resultsLabel(count)}
        </span>
      ) : null}
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      {phrase.open ? (
        <form
          className="order-last basis-full space-y-1"
          onSubmit={(e) => {
            e.preventDefault()
            void phrase.submit()
          }}
        >
          <div className="flex gap-2">
            <Input
              autoFocus
              maxLength={300}
              value={phrase.text}
              onChange={(e) => phrase.setText(e.target.value)}
              disabled={phrase.busy}
              aria-label={t('common:filterBar.nl.label')}
              placeholder={t('common:filterBar.nl.placeholder')}
              onKeyDown={(e) => e.key === 'Escape' && phrase.toggle()}
            />
            <Button type="submit" disabled={phrase.busy || !phrase.text.trim()}>
              {phrase.busy ? t('common:filterBar.nl.working') : t('common:filterBar.nl.apply')}
            </Button>
          </div>
          <p aria-live="polite" className={phrase.error ? 'text-sm text-destructive-text' : 'text-sm text-muted-foreground'}>
            {phrase.error ?? phrase.note}
          </p>
        </form>
      ) : null}

      <AllFiltersDialog open={allOpen} onOpenChange={setAllOpen} fields={fields} clauses={clauses} pinned={pinned} onTogglePin={togglePin} countPreview={countPreview} onApply={onChange} />
    </div>
  )
}

/** The phrase field: what was typed, what came back, and which of the chips on the bar are the phrase's. */
function usePhrase(onNaturalLanguage: FilterBarProps['onNaturalLanguage'], clauses: FilterClause[], onChange: (next: FilterClause[]) => void) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [fromPhrase, setFromPhrase] = useState<FilterClause[]>([])

  const submit = async () => {
    if (!onNaturalLanguage || !text.trim()) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const result = await onNaturalLanguage(text.trim())
      // A clause on a field already filtered replaces it: the phrase is the newer intent.
      const next = result.clauses.reduce((all, clause) => replaceClause(all, all.findIndex((entry) => entry.field === clause.field), clause), clauses)
      onChange(next)
      setFromPhrase(result.clauses)
      if (result.clauses.length === 0) setNote(t('common:filterBar.nl.nothing'))
      else {
        const dropped = result.dropped ? t('common:filterBar.nl.dropped', { count: result.dropped }) : ''
        setNote([result.understood, dropped].filter(Boolean).join(' '))
        setText('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:filterBar.nl.failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    open,
    toggle: () => setOpen((value) => !value),
    text,
    setText,
    busy,
    error,
    note,
    fromPhrase: clauses.length ? fromPhrase : [],
    submit,
  }
}

/** Editor of one filter's value in a menu (a sheet on a phone), opened by `trigger`. */
function FieldMenu({ field, clause, onCommit, trigger }: { field: FilterField; clause: FilterClause | undefined; onCommit: (next: FilterClause | null) => void; trigger: ReactNode }) {
  return (
    <DropdownMenu>
      {trigger}
      <ResponsiveMenuContent title={field.label} align="start">
        <div className="min-w-64 max-w-[min(20rem,calc(100vw-2rem))] p-1">
          <FilterValueEditor field={field} clause={clause} onChange={onCommit} />
        </div>
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}

function AddFilterMenu({ fields, clauses, onCommit }: { fields: FilterField[]; clauses: FilterClause[]; onCommit: (field: FilterField, next: FilterClause | null) => void }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const field = fields.find((entry) => entry.key === picked)
  const needle = normalizeForSearch(query.trim())
  const shown = needle ? fields.filter((entry) => normalizeForSearch(entry.label).includes(needle)) : fields

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setPicked(null)
          setQuery('')
        }
      }}
    >
      <FilterMenuTrigger />
      <ResponsiveMenuContent title={field ? field.label : t('common:filter.add')} align="start">
        <div className="min-w-64 max-w-[min(20rem,calc(100vw-2rem))] p-1">
          {field ? (
            <div className="space-y-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
                <ChevronLeft aria-hidden="true" /> {t('common:filterBar.back')}
              </Button>
              <FilterValueEditor field={field} clause={clauses.find((clause) => clause.field === field.key)} onChange={(next) => onCommit(field, next)} />
            </div>
          ) : (
            <div className="space-y-1">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('common:filterBar.fieldSearch')} placeholder={t('common:filterBar.fieldSearch')} />
              <div className="max-h-72 overflow-y-auto">
                {shown.map((entry) => (
                  <Button key={entry.key} type="button" variant="ghost" role="menuitem" className="w-full justify-start" onClick={() => setPicked(entry.key)}>
                    {entry.label}
                  </Button>
                ))}
                {shown.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t('common:filterBar.noFields')}</p> : null}
              </div>
            </div>
          )}
        </div>
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}
