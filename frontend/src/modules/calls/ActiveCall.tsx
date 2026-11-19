import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import { LiveKitRoomView, type LiveKitRoomViewProps } from './LiveKitRoomView'

// The call outlives its page: the room is mounted here, above the routes, so moving around the
// app keeps it connected. On the call's own page it covers the slot the page reserves; anywhere
// else it shrinks to a floating window in the corner.

export interface ActiveCallSession {
  id: string
  /** Where "Leave" goes when it is pressed on the call's page. */
  backTarget: string
  room: Omit<LiveKitRoomViewProps, 'compact' | 'onExpand'>
}

interface ActiveCallContextValue {
  session: ActiveCallSession | null
  start: (session: ActiveCallSession) => void
  end: () => void
  /** The call page's placeholder; null while the page is not shown. */
  setSlot: (slot: HTMLElement | null) => void
}

const ActiveCallContext = createContext<ActiveCallContextValue | null>(null)

export function useActiveCall(): ActiveCallContextValue {
  const value = useContext(ActiveCallContext)
  if (!value) throw new Error('useActiveCall outside ActiveCallProvider')
  return value
}

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ActiveCallSession | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const end = useCallback(() => setSession(null), [])
  const value = useMemo(() => ({ session, start: setSession, end, setSlot }), [session, end])
  return (
    <ActiveCallContext.Provider value={value}>
      {children}
      {session ? <ActiveCallHost key={session.id} session={session} slot={slot} onEnded={end} /> : null}
    </ActiveCallContext.Provider>
  )
}

/** The slot's box on screen, kept current while the page resizes or scrolls. */
function useBox(slot: HTMLElement | null): DOMRect | null {
  const [box, setBox] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (!slot) {
      setBox(null)
      return
    }
    const measure = () => setBox(slot.getBoundingClientRect())
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [slot])
  return box
}

function ActiveCallHost({ session, slot, onEnded }: { session: ActiveCallSession; slot: HTMLElement | null; onEnded: () => void }) {
  const navigate = useNavigate()
  const box = useBox(slot)
  const full = slot !== null && box !== null
  return (
    <div
      style={full ? { top: box.top, left: box.left, width: box.width, height: box.height } : undefined}
      className={cn(
        'fixed',
        full
          ? 'z-30'
          : // Above the phone's bottom bar, under dialogs and menus.
            'bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] right-3 z-40 h-44 w-64 md:bottom-4 md:right-4 md:h-56 md:w-96',
      )}
    >
      <LiveKitRoomView
        {...session.room}
        compact={!full}
        onExpand={() => navigate(`/calls/${session.id}`)}
        onLeave={(lastOut) => {
          session.room.onLeave(lastOut)
          onEnded()
          if (full) navigate(session.backTarget)
        }}
        onEndForAll={
          session.room.onEndForAll
            ? () => {
                session.room.onEndForAll?.()
              }
            : undefined
        }
      />
    </div>
  )
}
