import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { FILTER_FILE_TYPES, fileTypeLabel } from '@/shared/lib/file-type'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { MODIFIED_RANGES, type ModifiedRange, type TypeFilter } from './filters'

export type ChipKey = 'type' | 'modified' | 'tag'

export interface FilterValues {
  type: TypeFilter | null
  modified: ModifiedRange | null
  tag: string | null
}

const RANGE_LABEL = {
  today: 'common:labels.today',
  '7d': 'common:labels.days7',
  '30d': 'common:labels.days30',
  '90d': 'common:labels.days90',
} as const

const CHIP_LABEL = { type: 'common:labels.type', modified: 'archive:labels.modified', tag: 'common:labels.label' } as const

const chipClass = 'inline-flex h-control-md items-center gap-1 text-xs hover:bg-accent'

function Chip({
  chip,
  value,
  options,
  open,
  onOpenChange,
  onPick,
  onClear,
}: {
  chip: ChipKey
  value: string | null
  options: { value: string; label: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (value: string) => void
  onClear: () => void
}) {
  const shown = options.find((option) => option.value === value)?.label
  return (
    <span className="inline-flex items-center rounded-md border bg-background">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger className={cn(chipClass, 'rounded-l-md pl-2 pr-1')}>
          <span className="text-muted-foreground">{t(CHIP_LABEL[chip])}</span>
          {shown ? <span className="font-medium">{shown}</span> : null}
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('archive:filters.noTags')}</p> : null}
          {options.map((option) => (
            <DropdownMenuItem key={option.value} onClick={() => onPick(option.value)}>
              <Check className={cn('h-4 w-4', option.value !== value && 'invisible')} /> {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className={cn(chipClass, 'rounded-r-md px-1.5')}
        title={t('archive:filters.remove')}
        aria-label={t('archive:filters.removeNamed', { name: t(CHIP_LABEL[chip]) })}
        onClick={onClear}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

// "+ Filter" adds a chip and opens it at once; a chip with a value stays until its × is pressed.
// Tags are picked from the ones in use, not typed: a typo would just return nothing.
export function FilterChips({ values, tagOptions, onChange }: { values: FilterValues; tagOptions: string[]; onChange: (next: Partial<FilterValues>) => void }) {
  const [added, setAdded] = useState<ChipKey[]>([])
  const [openChip, setOpenChip] = useState<ChipKey | null>(null)
  const shown = (['type', 'modified', 'tag'] as const).filter((chip) => values[chip] !== null || added.includes(chip))
  const missing = (['type', 'modified', 'tag'] as const).filter((chip) => !shown.includes(chip))

  const optionsOf: Record<ChipKey, { value: string; label: string }[]> = {
    type: FILTER_FILE_TYPES.map((type) => ({ value: type, label: fileTypeLabel(type) })),
    modified: MODIFIED_RANGES.map((range) => ({ value: range, label: t(RANGE_LABEL[range]) })),
    tag: tagOptions.map((tag) => ({ value: tag, label: tag })),
  }

  const forget = (chip: ChipKey) => setAdded((current) => current.filter((key) => key !== chip))

  return (
    <>
      {shown.map((chip) => (
        <Chip
          key={chip}
          chip={chip}
          value={values[chip]}
          options={optionsOf[chip]}
          open={openChip === chip}
          onOpenChange={(open) => setOpenChip(open ? chip : null)}
          onPick={(value) => {
            onChange({ [chip]: value })
            forget(chip)
          }}
          onClear={() => {
            onChange({ [chip]: null })
            forget(chip)
          }}
        />
      ))}
      {missing.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-control-md items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="h-3 w-3" aria-hidden="true" /> {t('archive:filters.add')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {missing.map((chip) => (
              <DropdownMenuItem
                key={chip}
                onClick={() => {
                  setAdded((current) => [...current, chip])
                  setOpenChip(chip)
                }}
              >
                {t(CHIP_LABEL[chip])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )
}
