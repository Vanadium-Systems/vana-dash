import { useEffect, useRef, useState, type RefObject } from 'react'

// True once the page title has scrolled out of view above the top. The title element may only
// exist after data loads, so the effect re-checks the ref on every render and re-observes only
// when the element changed.
export function useCollapsingTitle(titleRef: RefObject<HTMLElement>): boolean {
  const [collapsed, setCollapsed] = useState(false)
  const observer = useRef<IntersectionObserver | null>(null)
  const observed = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const element = titleRef.current
    if (element === observed.current) return
    observer.current?.disconnect()
    observed.current = element
    if (!element) {
      setCollapsed(false)
      return
    }
    observer.current = new IntersectionObserver(([entry]) => {
      if (entry) setCollapsed(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    })
    observer.current.observe(element)
  })

  useEffect(() => () => observer.current?.disconnect(), [])

  return collapsed
}
