import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { FilterChip } from '@/shared/components/ui/filter-chip'
import { Input } from '@/shared/components/ui/input'
import { PeriodOptions, type DayRange } from '@/shared/components/PeriodSelect'
import { dateBoundsToClause, dayOf, type FilterClause, type FilterField } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import { normalizeForSearch, parseRoDecimal } from '@/shared/lib/utils'

// The value part of one filter: checkboxes, typed values, a range or a period, by the field's type.
// Every change goes up at once (null removes the clause), so a menu needs no "Apply" of its own.

type Mode = 'in' | 'not_in' | 'between' | 'is_empty' | 'not_empty'

const MANY_OPTIONS = 8

function ModeButtons({ modes, mode, onMode }: { modes: Array<{ mode: Mode; label: string }>; mode: Mode; onMode: (mode: Mode) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group">
      {modes.map((entry) => (
        <Button key={entry.mode} type="button" size="sm" variant={mode === entry.mode ? 'outline' : 'ghost'} aria-pressed={mode === entry.mode} className={mode === entry.mode ? 'bg-accent' : undefined} onClick={() => onMode(entry.mode)}>
          {entry.label}
        </Button>
      ))}
    </div>
  )
}

const MODE_LABEL = {
  in: () => t('common:filterBar.is'),
  not_in: () => t('common:filterBar.isNot'),
  between: () => t('common:filterBar.interval'),
  is_empty: () => t('common:filterBar.empty'),
  not_empty: () => t('common:filterBar.filled'),
} satisfies Record<Mode, () => string>

function modesFor(field: FilterField): Mode[] {
  if (field.ops) return field.ops.length > 1 ? field.ops : []
  if (field.type === 'enum') return field.noNegate ? [] : ['in', 'not_in']
  if (field.type === 'text') return ['in', 'not_in', 'is_empty', 'not_empty']
  return ['between', 'is_empty', 'not_empty']
}

export function FilterValueEditor({ field, clause, onChange }: { field: FilterField; clause: FilterClause | undefined; onChange: (next: FilterClause | null) => void }) {
  const defaultMode: Mode = field.ops?.[0] ?? (field.type === 'enum' || field.type === 'text' ? 'in' : 'between')
  const [mode, setMode] = useState<Mode>(clause?.op ?? defaultMode)
  useEffect(() => {
    if (clause) setMode(clause.op)
  }, [clause])

  const modes = modesFor(field)
  const listValues = clause && (clause.op === 'in' || clause.op === 'not_in') ? clause.value : []

  const changeMode = (next: Mode) => {
    setMode(next)
    if (next === 'is_empty' || next === 'not_empty') onChange({ field: field.key, op: next })
    else if ((next === 'in' || next === 'not_in') && listValues.length > 0) onChange({ field: field.key, op: next, value: listValues })
    else if (clause && (clause.op === 'is_empty' || clause.op === 'not_empty')) onChange(null)
  }

  const setList = (values: string[]) => onChange(values.length ? { field: field.key, op: mode === 'not_in' ? 'not_in' : 'in', value: values } : null)

  return (
    <div className="space-y-2">
      {modes.length > 0 ? <ModeButtons modes={modes.map((m) => ({ mode: m, label: MODE_LABEL[m]() }))} mode={mode} onMode={changeMode} /> : null}
      {field.type === 'enum' ? <EnumValues field={field} selected={listValues} onChange={setList} /> : null}
      {field.type === 'text' && (mode === 'in' || mode === 'not_in') ? <TextValues values={listValues} onChange={setList} /> : null}
      {field.type === 'number' && mode === 'between' ? <NumberRange field={field} clause={clause} onChange={onChange} /> : null}
      {field.type === 'date' && mode === 'between' ? (
        <PeriodOptions
          value={clause?.op === 'between' ? [dayOf(clause.value[0]), dayOf(clause.value[1])] : [null, null]}
          onChange={(range: DayRange) => onChange(dateBoundsToClause(field.key, range))}
        />
      ) : null}
    </div>
  )
}

function EnumValues({ field, selected, onChange }: { field: FilterField; selected: string[]; onChange: (values: string[]) => void }) {
  const [search, setSearch] = useState('')
  const options = field.options ?? []
  const needle = normalizeForSearch(search.trim())
  const shown = needle ? options.filter((option) => normalizeForSearch(option.label).includes(needle)) : options
  return (
    <div className="space-y-1">
      {options.length > MANY_OPTIONS ? <Input value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('common:filterBar.valueSearch')} placeholder={t('common:filterBar.valueSearch')} /> : null}
      <div className="max-h-60 overflow-y-auto">
        {shown.map((option) => (
          <label key={option.value} className="flex min-h-control-md cursor-pointer items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent">
            <Checkbox checked={selected.includes(option.value)} onChange={() => onChange(selected.includes(option.value) ? selected.filter((v) => v !== option.value) : [...selected, option.value])} />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function TextValues({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const value = draft.trim()
    if (value && !values.includes(value)) onChange([...values, value])
    setDraft('')
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          aria-label={t('common:filterBar.valueInput')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="outline" disabled={!draft.trim()} onClick={add}>
          {t('common:filterBar.addValue')}
        </Button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <FilterChip key={value} label={value} onRemove={() => onChange(values.filter((v) => v !== value))} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const toBound = (raw: string) => {
  const parsed = parseRoDecimal(raw)
  return Number.isNaN(parsed) ? null : parsed
}

function NumberRange({ field, clause, onChange }: { field: FilterField; clause: FilterClause | undefined; onChange: (next: FilterClause | null) => void }) {
  const current = clause?.op === 'between' ? clause.value : [null, null]
  const [from, setFrom] = useState(current[0] === null ? '' : String(current[0]))
  const [to, setTo] = useState(current[1] === null ? '' : String(current[1]))
  // Typing sends nothing until the person pauses: each send refetches the list behind the menu.
  useEffect(() => {
    const timer = setTimeout(() => {
      const bounds: [number | null, number | null] = [toBound(from), toBound(to)]
      if (bounds[0] === current[0] && bounds[1] === current[1]) return
      onChange(bounds[0] === null && bounds[1] === null ? null : { field: field.key, op: 'between', value: bounds })
    }, 400)
    return () => clearTimeout(timer)
    // `current` and `onChange` change with every parent render; only the typed text starts a send.
  }, [from, to])
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-xs text-muted-foreground">
        {t('common:filterBar.from')}
        <Input inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        {t('common:filterBar.to')}
        <Input inputMode="decimal" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
    </div>
  )
}
