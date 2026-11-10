import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Money } from '@/shared/components/Money'
import { Input } from '@/shared/components/ui/input'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import { cn, parseRoDecimal } from '@/shared/lib/utils'
import type { ProspectSheet } from './types'
import { useWrite } from './use-sheet'

type FieldKind = 'text' | 'integer' | 'decimal' | 'date'

interface FieldDef {
  key: 'source' | 'caenCode' | 'employeeCount' | 'website' | 'cif' | 'expectedCloseAt' | 'revenue' | 'profit' | 'debt' | 'equity' | 'cash' | 'receivables' | 'inventory'
  label: TKey
  kind: FieldKind
}

const MAIN_FIELDS: FieldDef[] = [
  { key: 'expectedCloseAt', label: 'clients:sheet.fields.expectedCloseAt', kind: 'date' },
  { key: 'source', label: 'clients:sheet.fields.source', kind: 'text' },
  { key: 'caenCode', label: 'clients:sheet.fields.caenCode', kind: 'text' },
  { key: 'employeeCount', label: 'clients:sheet.fields.employeeCount', kind: 'integer' },
  { key: 'website', label: 'clients:sheet.fields.website', kind: 'text' },
  { key: 'cif', label: 'clients:sheet.fields.cif', kind: 'text' },
]

const FINANCIAL_FIELDS: FieldDef[] = [
  { key: 'revenue', label: 'clients:sheet.fields.revenue', kind: 'decimal' },
  { key: 'profit', label: 'clients:sheet.fields.profit', kind: 'decimal' },
  { key: 'debt', label: 'clients:sheet.fields.debt', kind: 'decimal' },
  { key: 'equity', label: 'clients:sheet.fields.equity', kind: 'decimal' },
  { key: 'cash', label: 'clients:sheet.fields.cash', kind: 'decimal' },
  { key: 'receivables', label: 'clients:sheet.fields.receivables', kind: 'decimal' },
  { key: 'inventory', label: 'clients:sheet.fields.inventory', kind: 'decimal' },
]

/** The server stores the date alone; at noon no time zone can move it to the next day. */
const dayText = (value: string) => formatDate(`${value.slice(0, 10)}T12:00:00`)

function display(def: FieldDef, sheet: ProspectSheet): string | null {
  const raw = sheet[def.key]
  if (raw === null || raw === undefined || raw === '') return null
  if (def.kind === 'date') return dayText(String(raw))
  if (def.kind === 'integer') return formatNumber(Number(raw))
  if (def.kind === 'decimal') return formatNumber(Number(raw), BASE_CURRENCY)
  return String(raw)
}

/** What goes into the PATCH, or `undefined` when the text cannot be read. Empty clears the field. */
function parse(def: FieldDef, text: string): string | number | null | undefined {
  const typed = text.trim()
  if (!typed) return null
  if (def.kind === 'integer' || def.kind === 'decimal') {
    const value = parseRoDecimal(typed)
    return Number.isNaN(value) || (def.kind === 'integer' && !Number.isInteger(value)) || (def.key === 'employeeCount' && value < 0) ? undefined : value
  }
  return typed
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 py-0.5 text-sm">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/** A value you press to edit where it stands (Linear style): Enter or blur saves, Esc leaves it as it was. */
function InlineValue({ label, shown, initial, inputMode, type, readOnly, onSave }: { label: string; shown: ReactNode; initial: string; inputMode?: 'decimal' | 'numeric'; type?: 'date'; readOnly: boolean; onSave: (text: string) => boolean | Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (!editing && wasEditing.current) button.current?.focus()
    wasEditing.current = editing
  }, [editing])

  if (readOnly) return <span className="block truncate">{shown ?? <span className="text-muted-foreground">—</span>}</span>
  if (editing) {
    return (
      <Input
        autoFocus
        type={type}
        inputMode={inputMode}
        aria-label={label}
        defaultValue={initial}
        className="h-control-sm"
        onBlur={(e) => {
          const text = e.target.value
          setEditing(false)
          if (text.trim() !== initial.trim()) void onSave(text)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.stopPropagation()
            e.currentTarget.value = initial
            e.currentTarget.blur()
          }
        }}
      />
    )
  }
  return (
    <button
      ref={button}
      type="button"
      aria-label={label}
      className="-mx-1 block min-h-6 w-[calc(100%+0.5rem)] truncate rounded-sm px-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setEditing(true)}
    >
      {shown ?? <span className="text-muted-foreground">{t('clients:sheet.props.empty')}</span>}
    </button>
  )
}

export function Properties({ sheet }: { sheet: ProspectSheet }) {
  const { session } = useMe()
  const write = useWrite()
  const [financialOpen, setFinancialOpen] = useState(false)
  const readOnly = !sheet.canEdit
  const patch = (body: Record<string, unknown>) => write(() => api.patch(`/api/prospects/${sheet.id}`, body))

  const saveField = (def: FieldDef) => async (text: string) => {
    const value = parse(def, text)
    if (value === undefined) return false
    return (await patch({ [def.key]: value })) !== undefined
  }

  const row = (def: FieldDef) => {
    const raw = sheet[def.key]
    const label = t(def.label)
    return (
      <PropertyRow key={def.key} label={label}>
        <InlineValue
          label={label}
          readOnly={readOnly}
          shown={display(def, sheet)}
          initial={def.kind === 'date' ? String(raw ?? '').slice(0, 10) : raw === null || raw === undefined ? '' : String(Number.isNaN(Number(raw)) || def.kind === 'text' ? raw : Number(raw))}
          type={def.kind === 'date' ? 'date' : undefined}
          inputMode={def.kind === 'decimal' ? 'decimal' : def.kind === 'integer' ? 'numeric' : undefined}
          onSave={saveField(def)}
        />
      </PropertyRow>
    )
  }

  const currency = sheet.valueCurrency ?? session?.tenant?.currency ?? BASE_CURRENCY
  const valueLabel = t('clients:sheet.fields.value')
  return (
    <section aria-label={t('clients:sheet.props.title')}>
      <h3 className="mb-2 text-sm font-medium">{t('clients:sheet.props.title')}</h3>
      <dl className="space-y-0.5">
        <PropertyRow label={valueLabel}>
          <InlineValue
            label={valueLabel}
            readOnly={readOnly}
            shown={sheet.valueAmount === null ? null : <Money amount={Number(sheet.valueAmount)} currency={currency} />}
            initial={sheet.valueAmount === null ? '' : String(Number(sheet.valueAmount))}
            inputMode="decimal"
            onSave={async (text) => {
              const typed = text.trim()
              const amount = typed ? parseRoDecimal(typed) : null
              if (amount !== null && (Number.isNaN(amount) || amount < 0)) return false
              return (await patch({ valueAmount: amount, valueCurrency: amount === null ? null : currency })) !== undefined
            }}
          />
        </PropertyRow>
        {MAIN_FIELDS.map(row)}
      </dl>
      <button
        type="button"
        aria-expanded={financialOpen}
        className="mt-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setFinancialOpen((open) => !open)}
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', financialOpen && 'rotate-180')} aria-hidden="true" />
        {t('clients:sheet.props.financials')}
      </button>
      {financialOpen ? <dl className="mt-2 space-y-0.5">{FINANCIAL_FIELDS.map(row)}</dl> : null}
    </section>
  )
}
