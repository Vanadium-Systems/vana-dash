import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/lib/utils'

// Fără Radix (CLAUDE.md: zero popover/dropdown/tooltip/select instalate, reimplementate
// nativ — la fel ca select/tabs/checkbox din sprinturi anterioare). Conținutul se randează
// într-un portal pe `document.body`, poziționat `fixed` după `getBoundingClientRect()` al
// trigger-ului — altfel, într-un <td> dintr-un <Table> (care e `overflow-auto` pt. scroll
// orizontal pe mobil), un `position: absolute` local rămâne tăiat/greșit poziționat de
// containerul cu scroll (bug raportat: "trebuie să dau scroll ca să văd meniul").

interface DropdownMenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement>
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenuContext(component: string) {
  const ctx = useContext(DropdownMenuContext)
  if (!ctx) throw new Error(`${component} must be used inside <DropdownMenu>`)
  return ctx
}

// `open` / `onOpenChange` opționale: în Mesaje, apăsarea lungă pe mesaj deschide același meniu
// ca butonul, deci starea trebuie să stea la rând, nu doar aici.
export function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const triggerRef = useRef<HTMLButtonElement>(null)
  // `max-w-full` e Load-bearing, nu cosmetic: `inline-block` își calculează lățimea după
  // conținut, deci un rând cu text lung (meniul contului: nume + email) ar lăși câtul
  // sidebar-ului la hover — exact ce s-a văzut în captură. Fără el, `truncate` de pe trigger
  // n-ar avea lățime pe care să taie.
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className="inline-block max-w-full">{children}</div>
    </DropdownMenuContext.Provider>
  )
}

export function DropdownMenuTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext('DropdownMenuTrigger')
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(!open)
      }}
    >
      {children}
    </button>
  )
}

export function DropdownMenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext('DropdownMenuContent')
  const contentRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number | undefined; bottom: number | undefined; left: number | undefined; right: number | undefined } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos(
      align === 'end'
        ? { top: rect.bottom + 4, bottom: undefined, right: window.innerWidth - rect.right, left: undefined }
        : { top: rect.bottom + 4, bottom: undefined, left: rect.left, right: undefined },
    )
  }, [open, align, triggerRef])

  // După ce meniul e măsurabil în DOM: flip în sus dacă nu încape sub trigger (și are loc
  // deasupra), altfel fixăm marginea de jos la limita ecranului. Pe mobil bara de gesturi
  // acoperă fundalul — fără asta, ultimele itemii devin inaccesibili.
  useLayoutEffect(() => {
    if (!open || !pos?.top || !contentRef.current || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const height = contentRef.current.offsetHeight
    const MARGIN = 16
    if (pos.top + height <= window.innerHeight - MARGIN) return
    if (height <= rect.top - MARGIN) {
      setPos((p) => (p ? { ...p, top: undefined, bottom: window.innerHeight - rect.top + 4 } : p))
    } else {
      setPos((p) => (p ? { ...p, top: Math.max(MARGIN, window.innerHeight - MARGIN - height) } : p))
    }
  }, [open, pos])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Poziția e calculată o dată, la deschidere — nu urmărim scroll-ul live (ar cere
    // recalcul continuu pt. un caz de folosire simplu); închidem în schimb, ca dropdown-ul
    // să nu rămână "plutind" ancorat de un rând care s-a mutat sub el.
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, setOpen])

  if (!open || !pos) return null
  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      // max-h + overflow: meniurile deschise pe rânduri de jos nu mai pot depăși ecranul
      // (găsit live 2026-08-24 în Arhivă — itemii se ascundeau sub butoanele de navigare).
      className="fixed z-50 max-h-[calc(100vh-32px)] min-w-40 overflow-y-auto rounded-md border border-input bg-card p-1 text-card-foreground shadow-md"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}

export function DropdownMenuItem({
  children,
  onClick,
  destructive,
}: {
  children: ReactNode
  onClick: () => void
  destructive?: boolean
}) {
  const { setOpen } = useDropdownMenuContext('DropdownMenuItem')
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
        destructive && 'text-destructive hover:bg-destructive/10 focus:text-destructive',
      )}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(false)
        onClick()
      }}
    >
      {children}
    </button>
  )
}
