import { useEffect, useRef } from 'react'
import { motionLevel } from '@/shared/lib/motion'

// Scrolls to the row marked `data-row-id={id}` and tints it for a moment, once per id. `ready` must
// be true only when that row is in the DOM (data loaded, right page), otherwise the effect would
// find nothing and the single attempt would be spent.
export function useFlashRow(id: string, ready: boolean) {
  const flashed = useRef('')
  useEffect(() => {
    if (!id || !ready || flashed.current === id) return
    const row = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
    if (!row) return
    flashed.current = id
    row.scrollIntoView({ block: 'center', behavior: motionLevel() === 'full' ? 'smooth' : 'auto' })
    row.classList.add('bg-accent')
    const timer = window.setTimeout(() => row.classList.remove('bg-accent'), 1500)
    return () => {
      window.clearTimeout(timer)
      row.classList.remove('bg-accent')
    }
  }, [id, ready])
}
