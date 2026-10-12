import * as React from 'react'
import { cn } from '@/shared/lib/utils'

// Motivul unui control: „de ce e dezactivat", „ce face comanda aceasta". Apare la hover
// ȘI la focus (tot ce apare la hover apare la :focus-within). Un buton dezactivat nu poate
// primi focusul, deci anvelopa îl ia în locul lui — de aceea citește `disabled` de pe copil,
// ca pagina să nu trebuiască să declare încă o dată același lucru.
//
// Nativ, ca restul primitivelor din ui/ (fără biblioteci de overlay). Pe touch nu există
// hover, deci același text se afișează static sub control — `.tooltip-bubble` din index.css
// face comutarea, fără o a doua copie a textului în DOM.

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactElement<{ disabled?: boolean }>
  className?: string
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const id = React.useId()
  const isDisabled = children.props.disabled === true

  return (
    <span className={cn('tooltip-anchor', className)} tabIndex={isDisabled ? 0 : -1} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="tooltip-bubble">
        {content}
      </span>
    </span>
  )
}
