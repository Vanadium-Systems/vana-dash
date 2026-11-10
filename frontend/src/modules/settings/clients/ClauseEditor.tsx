import { ListFilter, X } from 'lucide-react'
import { useState } from 'react'
import { AllFiltersDialog } from '@/shared/components/AllFiltersDialog'
import { Button } from '@/shared/components/ui/button'
import { clauseLabel, type FilterClause, type FilterField } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'

/** The filters of a criterion or a signal: the same chips and the same field dialog as the prospect list. */
export function ClauseEditor({ fields, value, onChange, disabled }: { fields: FilterField[]; value: FilterClause[]; onChange: (next: FilterClause[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const fieldOf = (clause: FilterClause): FilterField => fields.find((field) => field.key === clause.field) ?? { key: clause.field, label: clause.field, type: 'text' }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((clause, index) => (
        <span key={`${clause.field}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm">
          <span className="truncate">{clauseLabel(fieldOf(clause), clause)}</span>
          {disabled ? null : (
            <button
              type="button"
              className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('clients:settings.filters.remove', { filter: fieldOf(clause).label })}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {disabled ? null : (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <ListFilter aria-hidden="true" /> {value.length ? t('clients:settings.filters.edit') : t('clients:settings.filters.add')}
        </Button>
      )}
      <AllFiltersDialog open={open} onOpenChange={setOpen} fields={fields} clauses={value} onApply={onChange} />
    </div>
  )
}
