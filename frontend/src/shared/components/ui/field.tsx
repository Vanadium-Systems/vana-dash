import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { Label } from './label'

// Eticheta deasupra, „(opțional)" în loc de asterisc, eroarea sub câmp (DESIGN.md, Formulare).
// Id-ul, aria-invalid și aria-describedby se pun pe copil, ca un cititor de ecran să lege
// eticheta și mesajul de câmp fără ca pagina să le mai scrie de mână.

interface FieldProps {
  label: React.ReactNode
  optional?: boolean
  error?: string | null
  hint?: React.ReactNode
  className?: string
  children: React.ReactElement
}

export function Field({ label, optional, error, hint, className, children }: FieldProps) {
  const autoId = React.useId()
  const id = (children.props as { id?: string }).id ?? autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (opțional)</span> : null}
      </Label>
      {React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  )
}
