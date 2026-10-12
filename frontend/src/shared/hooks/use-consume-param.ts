import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Citește o singură dată un parametru de acțiune din URL (ex: `?new=1` venit din Ctrl K), apoi îl
 * scoate, ca refresh/back să nu repete acțiunea. Același tipar ca `/email?to=` din EmailPage.
 */
export function useConsumeParam(name: string, onValue: (value: string) => void) {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(name)

  useEffect(() => {
    if (value === null) return
    onValue(value)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(name)
        return next
      },
      { replace: true },
    )
    // onValue e o funcție nouă la fiecare randare; efectul trebuie să ruleze doar când apare parametrul.
  }, [value])
}
