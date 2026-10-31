import { useEffect, useRef, useState } from 'react'

const ROLL_MS = 600

const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// Counts up once, when the figure first appears; a later refetch must not replay it, so after
// the roll the value is rendered as it comes.
export function NumberRoll({ value, format }: { value: number; format: (n: number) => string }) {
  const [rolling, setRolling] = useState<number | null>(() => (prefersReducedMotion() ? null : 0))
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    if (prefersReducedMotion()) return
    const startedAt = performance.now()
    let frame = 0
    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / ROLL_MS, 1)
      if (progress === 1) {
        setRolling(null)
        return
      }
      setRolling(latest.current * (1 - (1 - progress) ** 3))
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <>{format(rolling ?? value)}</>
}
