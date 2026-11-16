import { useIsFetching } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

// The loading signal (DESIGN.md): a 2px turquoise line along the top, only once a request has taken
// 300ms, so quick loads show nothing. The data already on screen stays where it is.
export function LoadingTrail() {
  const fetching = useIsFetching() > 0
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!fetching) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), 300)
    return () => window.clearTimeout(timer)
  }, [fetching])

  return <div aria-hidden="true" className="loading-trail" data-shown={shown || undefined} />
}
