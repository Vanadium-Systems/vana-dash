import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface FabAction {
  key: string
  icon: ReactNode
  label: string
  onClick: () => void
}

// Mobile only, above the bottom nav. With `actions` a tap opens a speed dial (labels as glass
// pills); without, it is a plain button for one primary action.
export function Fab({ icon, label, onClick, actions }: { icon: ReactNode; label: string; onClick?: () => void; actions?: FabAction[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const dial = Boolean(actions?.length)

  return (
    <div ref={rootRef} className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] right-4 z-30 flex flex-col items-end gap-3 md:hidden">
      {open
        ? actions?.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => {
                setOpen(false)
                action.onClick()
              }}
              className="glass float-in flex items-center gap-2 rounded-full border py-2 pl-4 pr-3 text-sm shadow-lg"
            >
              {action.label}
              {action.icon}
            </button>
          ))
        : null}
      <button
        type="button"
        aria-label={label}
        aria-expanded={dial ? open : undefined}
        onClick={() => (dial ? setOpen((current) => !current) : onClick?.())}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn('transition-transform duration-fast ease-out-strong', open && 'rotate-45')}>{icon}</span>
      </button>
    </div>
  )
}
