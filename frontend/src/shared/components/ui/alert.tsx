import type { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/utils'

// Mesaj în pagină, lângă ce l-a provocat (nu toast, care sare): o eroare de server,
// o contradicție în form, o condiție în care acțiunea e riscantă dar posibilă. Tonul e
// semantic și textul poartă informația — culoarea vine al doilea.

const alertVariants = cva('rounded-md border px-3 py-2 text-sm', {
  variants: {
    tone: {
      neutral: 'border-border text-muted-foreground',
      success: 'border-success-text/40 text-success-text',
      warning: 'border-warning-text/40 text-warning-text',
      critical: 'border-destructive-text/40 text-destructive-text',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: ReactNode
  /** Rândul care spune ce urmează („Trimite oricum", „Vezi răspunsul"). */
  action?: ReactNode
}

export function Alert({ className, tone, title, action, children, ...props }: AlertProps) {
  return (
    <div role="status" className={cn(alertVariants({ tone }), className)} {...props}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
      {action ? <div className="mt-1.5 flex flex-wrap items-center gap-3">{action}</div> : null}
    </div>
  )
}
