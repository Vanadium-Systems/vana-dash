import * as React from 'react'
import { cn } from '@/shared/lib/utils'

// Starea unui obiect (restantă, livrat, respins). Textul e obligatoriu și poartă informația;
// culoarea e al doilea semnal. Contur, fără fundal plin: pe dark nu apare nicio pată nouă.

export type StateTone = 'neutral' | 'success' | 'warning' | 'critical'

const TONE_CLASSES: Record<StateTone, string> = {
  neutral: 'border-border text-muted-foreground',
  success: 'border-success-text/40 text-success-text',
  warning: 'border-warning-text/40 text-warning-text',
  critical: 'border-destructive-text/40 text-destructive-text',
}

interface StatePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StateTone
  children: React.ReactNode
}

export function StatePill({ tone = 'neutral', className, children, ...props }: StatePillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border px-1.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
