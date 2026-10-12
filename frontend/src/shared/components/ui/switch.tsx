import * as React from 'react'
import { cn } from '@/shared/lib/utils'

// On/off cu efect imediat (DESIGN.md, Componente): salvează la fiecare apăsare, deci nu
// intră într-un formular. Doar două stări — `role="switch"` nu are „parțial" în ARIA, deci
// starea nedeterminată (rândul de pagină din Module) e un `Checkbox`, nu un `Switch`.
//
// Nativ, ca restul primitivelor din ui/ (zero biblioteci de overlay instalate — vezi
// dropdown-menu.tsx): un <button role="switch"> prinde Space și Enter de la browser.

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  size?: 'sm' | 'md'
  /** Textul citit de un screen reader; vizual, eticheta e în rândul de lângă. */
  label?: string
}

const TRACK: Record<'sm' | 'md', string> = {
  sm: 'h-4 w-7',
  md: 'h-5 w-9',
}
const KNOB: Record<'sm' | 'md', string> = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
}
const KNOB_ON: Record<'sm' | 'md', string> = {
  sm: 'translate-x-3',
  md: 'translate-x-4',
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, size = 'md', label, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        TRACK[size],
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block translate-x-0.5 rounded-full bg-background shadow-sm transition-transform duration-150 ease-out',
          KNOB[size],
          checked && KNOB_ON[size],
        )}
      />
    </button>
  ),
)
Switch.displayName = 'Switch'
