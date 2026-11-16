import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from './button'

export type ToastType = 'default' | 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: ReactNode
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export interface ToastOptions {
  id?: string | number
  duration?: number
  description?: ReactNode
  icon?: ReactNode
  closeButton?: boolean
  className?: string
  action?: ToastAction
  cancel?: {
    label: ReactNode
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  }
}

interface ToastItem extends ToastOptions {
  id: string | number
  type: ToastType
  title: ReactNode
}

const MAX_TOASTS = 5
const DEFAULT_DURATION = 4000

let counter = 0
let toasts: ToastItem[] = []
const listeners = new Set<() => void>()
const timers = new Map<string | number, ReturnType<typeof setTimeout>>()

function emit() {
  for (const listener of listeners) listener()
}

function clearTimer(id: string | number) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

function scheduleDismiss(id: string | number, duration = DEFAULT_DURATION) {
  clearTimer(id)
  if (!Number.isFinite(duration) || duration <= 0) return
  timers.set(
    id,
    setTimeout(() => {
      dismiss(id)
    }, duration),
  )
}

function addToast(type: ToastType, title: ReactNode, opts: ToastOptions = {}): string | number {
  const id = opts.id ?? ++counter
  const item: ToastItem = { ...opts, id, type, title }
  const idx = toasts.findIndex((tItem) => tItem.id === id)
  if (idx !== -1) {
    toasts = toasts.map((tItem, i) => (i === idx ? item : tItem))
  } else {
    toasts = [...toasts.slice(-(MAX_TOASTS - 1)), item]
  }
  scheduleDismiss(id, opts.duration)
  emit()
  return id
}

function dismiss(id?: string | number): void {
  if (id === undefined) {
    for (const item of toasts) clearTimer(item.id)
    toasts = []
    emit()
    return
  }
  clearTimer(id)
  const next = toasts.filter((item) => item.id !== id)
  if (next.length !== toasts.length) {
    toasts = next
    emit()
  }
}

export const toast = Object.assign(
  (message: ReactNode, opts?: ToastOptions) => addToast('default', message, opts),
  {
    success: (message: ReactNode, opts?: ToastOptions) => addToast('success', message, opts),
    error: (message: ReactNode, opts?: ToastOptions) => addToast('error', message, opts),
    info: (message: ReactNode, opts?: ToastOptions) => addToast('info', message, opts),
    warning: (message: ReactNode, opts?: ToastOptions) => addToast('warning', message, opts),
    dismiss,
  },
)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return toasts
}

const ICONS: Record<Exclude<ToastType, 'default'>, { Icon: typeof Info; cls: string }> = {
  success: { Icon: CheckCircle2, cls: 'text-success-text' },
  error: { Icon: AlertCircle, cls: 'text-destructive-text' },
  warning: { Icon: AlertTriangle, cls: 'text-warning-text' },
  info: { Icon: Info, cls: 'text-glow-ink' },
}

export interface ToasterProps {
  position?: 'top-right' | 'bottom-center'
  offset?: string
  closeButton?: boolean
}

export function Toaster({ position = 'top-right', offset, closeButton = true }: ToasterProps) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    return () => {
      for (const id of timers.keys()) clearTimer(id)
    }
  }, [])

  if (items.length === 0) return null

  const positionClass =
    position === 'bottom-center'
      ? 'fixed left-1/2 -translate-x-1/2 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2'
      : 'fixed right-4 top-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2'

  return (
    <div
      aria-live="polite"
      className={positionClass}
      style={position === 'bottom-center' ? { bottom: offset ?? '1rem' } : undefined}
    >
      {items.map((item) => {
        const iconEntry = item.type !== 'default' ? ICONS[item.type] : null
        return (
          <div
            key={item.id}
            data-sonner-toast=""
            role={item.type === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => clearTimer(item.id)}
            onMouseLeave={() => scheduleDismiss(item.id, item.duration)}
            className={cn(
              'glass flex w-full items-center gap-3 rounded-lg border py-2.5 pl-3.5 pr-2 font-sans text-sm text-foreground shadow-float',
              item.className,
            )}
          >
            {item.icon ? (
              <span data-icon="" className="shrink-0 [&>svg]:size-4">
                {item.icon}
              </span>
            ) : iconEntry ? (
              <span data-icon="" className={cn('shrink-0 [&>svg]:size-4', iconEntry.cls)}>
                <iconEntry.Icon aria-hidden="true" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{item.title}</div>
              {item.description ? <div className="mt-0.5 text-btn text-muted-foreground">{item.description}</div> : null}
            </div>
            {item.action ? (
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                onClick={(e) => {
                  item.action!.onClick(e)
                  dismiss(item.id)
                }}
              >
                {item.action.label}
              </button>
            ) : null}
            {item.cancel ? (
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                onClick={(e) => {
                  item.cancel!.onClick?.(e)
                  dismiss(item.id)
                }}
              >
                {item.cancel.label}
              </button>
            ) : null}
            {(item.closeButton ?? closeButton) ? (
              <button
                type="button"
                data-close-button=""
                aria-label={t('common:actions.close')}
                onClick={() => dismiss(item.id)}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                  'order-last border-0 bg-transparent text-muted-foreground hover:bg-accent',
                )}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
