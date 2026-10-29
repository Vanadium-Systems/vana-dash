import * as React from 'react'
import { cn } from '@/shared/lib/utils'

// Singura variantă de textarea din sistem. `auto` o face să crească cu conținutul până la
// 6 rânduri (compunerea din Mesaje) — comportamentul stă aici, nu în pagină, ca mărimea să nu
// fie o valoare pusă de mână peste un control.
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  auto?: boolean
}

const AUTO_MAX_ROWS = 6

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, auto = false, rows, ...props }, ref) => {
    const inner = React.useRef<HTMLTextAreaElement | null>(null)

    React.useEffect(() => {
      const el = inner.current
      if (!auto || !el) return
      const maxHeight = 24 * AUTO_MAX_ROWS + 20
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
      // An empty one-row textarea otherwise shows a scrollbar with arrows.
      el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
    }, [auto, props.value])

    return (
      <textarea
        ref={(node) => {
          inner.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
        }}
        rows={rows}
        className={cn(
          'flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          auto && 'min-h-9 resize-none',
          className,
        )}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }