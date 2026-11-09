import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'
import { TAG_COLORS, tagColor } from '@/shared/lib/tag-colors'

// One row of swatches from the shared `--tag-*` palette, plus "no color". A radio group, so the
// arrow keys move between swatches; each swatch has its color's name, never color alone.

interface ColorPickerProps {
  value: number | null
  onChange: (color: number | null) => void
  className?: string
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const options: (number | null)[] = [null, ...TAG_COLORS]
  return (
    <div role="radiogroup" aria-label={t('common:tagColors.label')} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((color) => {
        const selected = value === color
        const name = color === null ? t('common:tagColors.none') : t(`common:tagColors.${color}` as 'common:tagColors.1')
        return (
          // Native button: a swatch is a fixed 24px circle, not a control from the height scale.
          <button
            key={color ?? 'none'}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={name}
            title={name}
            onClick={() => onChange(color)}
            className={cn(
              'grid size-6 place-items-center rounded-full border border-border transition-transform duration-fast ease-out active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              color === null && 'bg-background',
            )}
            style={color === null ? undefined : { backgroundColor: tagColor(color), borderColor: 'transparent' }}
          >
            {selected && <Check className={cn('size-3.5', color === null ? 'text-foreground' : 'text-white')} aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}
