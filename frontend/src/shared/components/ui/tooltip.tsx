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

// After one tooltip has shown, the next ones skip the intent delay until the pointer has been
// away from all of them for a moment (index.css, MA4).
let coolDown: ReturnType<typeof setTimeout> | undefined
let warmUp: ReturnType<typeof setTimeout> | undefined
const INTENT_MS = 400
const COOL_DOWN_MS = 500

function onEnter() {
  clearTimeout(coolDown)
  warmUp = setTimeout(() => document.documentElement.setAttribute('data-tooltip-warm', ''), INTENT_MS)
}

function onLeave() {
  clearTimeout(warmUp)
  coolDown = setTimeout(() => document.documentElement.removeAttribute('data-tooltip-warm'), COOL_DOWN_MS)
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const id = React.useId()
  const isDisabled = children.props.disabled === true

  return (
    <span
      className={cn('tooltip-anchor', className)}
      tabIndex={isDisabled ? 0 : -1}
      aria-describedby={id}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {children}
      <span id={id} role="tooltip" className="tooltip-bubble">
        {content}
      </span>
    </span>
  )
}
