import { useEffect, useState } from 'react'

/** Re-renders the caller every minute, so labels like "10 minutes ago" keep moving. */
export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}
