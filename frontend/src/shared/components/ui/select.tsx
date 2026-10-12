import { ChevronDown } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/shared/lib/utils'

// <select> nativ stilizat, nu listă desenată de mână: tastatura, lista de pe Android și
// accesibilitatea vin gata de la browser. Aceeași geometrie ca Input (DESIGN.md).

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options?: SelectOption[]
  onValueChange?: (value: string) => void
  size?: 'sm' | 'md'
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, onValueChange, onChange, size = 'md', children, ...props }, ref) => (
    <div className={cn('relative w-full', className)}>
      <select
        ref={ref}
        className={cn(
          'w-full appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm transition-[border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive-text',
          size === 'sm' ? 'h-control-sm text-xs' : 'h-control-md',
        )}
        onChange={(e) => {
          onChange?.(e)
          onValueChange?.(e.target.value)
        }}
        {...props}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
)
Select.displayName = 'Select'

export { Select }
