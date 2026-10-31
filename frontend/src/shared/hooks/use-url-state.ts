import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export function useUrlState(key: string, defaultValue = ''): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(key) ?? defaultValue

  const setValue = useCallback(
    (next: string) => {
      // Functional form so two setters in the same tick do not overwrite each other's param.
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (next === defaultValue) params.delete(key)
          else params.set(key, next)
          return params
        },
        { replace: true },
      )
    },
    [key, defaultValue, setSearchParams],
  )

  return [value, setValue]
}
