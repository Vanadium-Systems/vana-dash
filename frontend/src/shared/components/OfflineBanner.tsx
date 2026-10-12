import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

interface OfflineBannerProps {
  visible: boolean
}

export function OfflineBanner({ visible }: OfflineBannerProps) {
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      return
    }
    const timeout = setTimeout(() => setMounted(false), 200)
    return () => clearTimeout(timeout)
  }, [visible])

  if (!mounted) return null

  return (
    <div
      data-state={visible ? 'open' : 'closed'}
      className="offline-banner flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning dark:bg-transparent"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      Offline — vezi ultimele date sincronizate
    </div>
  )
}
