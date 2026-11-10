import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

// Routes that moved into Clienți (push notifications, saved links and the Android app still carry them).

const MOVED_ACCOUNTING_TABS: Record<string, string> = { clienti: 'activi', contracte: 'contracte' }

/** Where an old `/accounting?tab=clienti|contracte` link goes now, other params kept; `null` for any other link. */
export function legacyAccountingTarget(search: string): string | null {
  const params = new URLSearchParams(search)
  const moved = MOVED_ACCOUNTING_TABS[params.get('tab') ?? '']
  if (!moved) return null
  params.set('tab', moved)
  return `/clients?${params.toString()}`
}

export function RedirectPricing() {
  const { search } = useLocation()
  return <Navigate to={`/clients${search}`} replace />
}

export function LegacyAccountingTabs({ children }: { children: ReactNode }) {
  const { search } = useLocation()
  const target = legacyAccountingTarget(search)
  return target ? <Navigate to={target} replace /> : <>{children}</>
}
