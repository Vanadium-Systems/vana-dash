import { useEffect, useSyncExternalStore } from 'react'
import { Toaster } from 'sonner'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from './button'

// One toast for the whole app (DESIGN.md): text and a second line, then [action] [×] on one row.
// The × is an ordinary icon button at the end of the row, never in the corner. Sonner keeps a
// toast while the pointer is on it.
const phoneQuery = window.matchMedia('(max-width: 767px)')

export function AppToaster() {
  const phone = useSyncExternalStore(
    (onChange) => {
      phoneQuery.addEventListener('change', onChange)
      return () => phoneQuery.removeEventListener('change', onChange)
    },
    () => phoneQuery.matches,
  )

  // Sonner 1.5 labels its close button "Close toast" and has no prop for it.
  useEffect(() => {
    const label = t('common:actions.close')
    const observer = new MutationObserver(() => {
      document.querySelectorAll('[data-sonner-toast] [data-close-button]').forEach((button) => {
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return (
    <Toaster
      // On a phone toasts sit at the bottom, by the thumb and above the bottom nav (MA12).
      position={phone ? 'bottom-center' : 'top-right'}
      offset={phone ? 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' : undefined}
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'glass flex w-full items-center gap-3 rounded-lg border py-2.5 pl-3.5 pr-2 font-sans text-sm text-foreground shadow-float',
          content: 'min-w-0 flex-1',
          title: 'font-medium',
          description: 'mt-0.5 text-btn text-muted-foreground',
          icon: 'shrink-0 [&>svg]:size-4',
          success: '[&_[data-icon]]:text-success-text',
          error: '[&_[data-icon]]:text-destructive-text',
          warning: '[&_[data-icon]]:text-warning-text',
          info: '[&_[data-icon]]:text-glow-ink',
          actionButton: cn(buttonVariants({ variant: 'outline', size: 'sm' })),
          cancelButton: cn(buttonVariants({ variant: 'ghost', size: 'sm' })),
          closeButton: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'order-last !static !transform-none !border-0 !bg-transparent text-muted-foreground hover:!bg-accent'),
        },
      }}
    />
  )
}
