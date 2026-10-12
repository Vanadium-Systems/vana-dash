import * as React from 'react'
import { cn } from '@/shared/lib/utils'

// Bifă dintr-un formular salvat (cutiile de email din Echipă) sau dintr-un rând de tabel.
// Starea nedeterminată (`aria-checked="mixed"`) e pentru rândul de pagină din Module, unde
// unele funcționalități ale paginii sunt pornite și altele nu — un switch nu poate spune asta.
//
// Nativ, ca restul primitivelor din ui/: <input type="checkbox"> prinde label, Space și
// formularul singur. Indicatorul e desenat peste el, inputul rămâne în DOM (ascuns
// vizual, nu `display:none`, ca label-ul și tastatura să-l ajungă).

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  indeterminate?: boolean
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement | null>(null)

    // `indeterminate` nu e o proprietate HTML, ci o stare pe care DOM-ul o ține: fără asta
    // aria-checked="mixed" ar fi o minciune pentru un cititor de ecran.
    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate
    }, [indeterminate])

    return (
      <span className={cn('inline-flex shrink-0 items-center', className)}>
        <input
          ref={(node) => {
            inner.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node
          }}
          type="checkbox"
          aria-checked={indeterminate ? 'mixed' : undefined}
          className={cn(
            'peer size-4 cursor-pointer appearance-none rounded-sm border border-input bg-transparent transition-colors duration-150 ease-out',
            'checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          {...props}
        />
        {/* Bifă sau liniuță, după starea cunoscută în React (marcajul e decor, deci nu
            trebuie să depindă de o pseudo-clasă). Apare peste input, pe centrul lui. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="pointer-events-none relative -ml-4 size-4 scale-0 stroke-primary-foreground transition-transform duration-150 ease-out peer-checked:scale-100"
        >
          {indeterminate ? (
            <path d="M4 8h8" fill="none" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M3 8.5 6.5 12 13 4.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </span>
    )
  },
)
Checkbox.displayName = 'Checkbox'
