import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { t } from '@/shared/lib/i18n'
import type { SeriesScope } from '@/shared/lib/types'

const SCOPES: SeriesScope[] = ['occurrence', 'following', 'all']

/**
 * "Only this event / This and following / All events" before a change to an occurrence of a
 * series (C4, C13). "Only this" is chosen and focused, so Enter keeps the change small.
 */
export function SeriesScopeDialog({
  request,
  onAnswer,
}: {
  request: { action: 'move' | 'edit' | 'delete' } | null
  onAnswer: (scope: SeriesScope | null) => void
}) {
  const [scope, setScope] = useState<SeriesScope>('occurrence')
  const firstRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (request) setScope('occurrence')
  }, [request])

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && onAnswer(null)}>
      <DialogContent
        role="alertdialog"
        aria-describedby={undefined}
        className="top-auto md:max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          firstRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">{request ? t(`calendar:scope.title.${request.action}`) : ''}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault()
            onAnswer(scope)
          }}
        >
          {SCOPES.map((option, i) => (
            <label key={option} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent">
              <input
                ref={i === 0 ? firstRef : undefined}
                type="radio"
                name="series-scope"
                value={option}
                checked={scope === option}
                onChange={() => setScope(option)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              {t(`calendar:scope.${option}`)}
            </label>
          ))}
          <DialogFooter className="pt-3">
            <Button type="button" variant="outline" onClick={() => onAnswer(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" variant={request?.action === 'delete' ? 'destructive' : 'default'}>
              {request?.action === 'delete' ? t('calendar:scope.confirmDelete') : t('calendar:scope.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
