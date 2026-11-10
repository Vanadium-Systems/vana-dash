import { ArrowLeft, ChevronDown, ChevronUp, Maximize2 } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { SheetBody } from './SheetBody'
import type { ListState } from './types'
import { isNotFound, useNeighbors, useSheet } from './use-sheet'

interface ProspectSheetViewProps {
  id: string
  variant: 'drawer' | 'page'
  list?: ListState
  onOpen: (id: string) => void
  onExpand?: () => void
  /** The prospect no longer exists (deleted meanwhile): the host closes the sheet. */
  onGone: () => void
  onBack?: () => void
}

/** The sheet itself, the same in the drawer and on its own page: position in the list, ↑ ↓ / j k, then the body. */
export function ProspectSheetView({ id, variant, list, onOpen, onExpand, onGone, onBack }: ProspectSheetViewProps) {
  const query = useSheet(id)
  const neighbors = useNeighbors(id, list).data
  const sheet = query.data
  const gone = isNotFound(query.error)

  // An old link to a merged prospect answers with the one it was merged into.
  useEffect(() => {
    if (sheet && sheet.id !== id) onOpen(sheet.id)
  }, [sheet, id, onOpen])

  useEffect(() => {
    if (!gone) return
    toast.error(t('clients:sheet.gone'))
    if (variant === 'drawer') onGone()
  }, [gone, variant, onGone])

  const prevId = neighbors?.prevId ?? null
  const nextId = neighbors?.nextId ?? null
  const goPrev = () => prevId && onOpen(prevId)
  const goNext = () => nextId && onOpen(nextId)
  // The arrows belong to the list's cell grid while a cell has focus; j / k always work.
  const inGrid = (e: KeyboardEvent) => e.target instanceof Element && e.target.closest('[data-cell-row]') !== null
  useHotkeys(
    [
      {
        keys: 'arrowup',
        label: t('clients:sheet.nav.prev'),
        onKey: (e) => {
          if (inGrid(e)) return
          e.preventDefault()
          goPrev()
        },
      },
      {
        keys: 'arrowdown',
        label: t('clients:sheet.nav.next'),
        onKey: (e) => {
          if (inGrid(e)) return
          e.preventDefault()
          goNext()
        },
      },
      { keys: 'k', label: t('clients:sheet.nav.prev'), onKey: goPrev },
      { keys: 'j', label: t('clients:sheet.nav.next'), onKey: goNext },
    ],
    { enabled: Boolean(list) },
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {variant === 'page' ? (
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden="true" /> {t('common:actions.back')}
          </Button>
        ) : null}
        {neighbors ? (
          <>
            <Button type="button" variant="outline" size="icon-sm" disabled={!prevId} aria-label={t('clients:sheet.nav.prev')} title={`${t('clients:sheet.nav.prev')} (K)`} onClick={goPrev}>
              <ChevronUp />
            </Button>
            <Button type="button" variant="outline" size="icon-sm" disabled={!nextId} aria-label={t('clients:sheet.nav.next')} title={`${t('clients:sheet.nav.next')} (J)`} onClick={goNext}>
              <ChevronDown />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">{t('clients:sheet.nav.position', { index: formatNumber(neighbors.index), total: formatNumber(neighbors.total) })}</span>
          </>
        ) : null}
        {variant === 'drawer' && onExpand ? (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onExpand}>
            <Maximize2 aria-hidden="true" /> {t('clients:sheet.expand')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : gone ? (
        <EmptyState
          kind="new"
          title={t('clients:sheet.gone')}
          action={
            <Button type="button" variant="outline" onClick={onBack ?? onGone}>
              {t('common:actions.back')}
            </Button>
          }
        />
      ) : query.isError || !sheet ? (
        <EmptyState
          kind="new"
          title={t('clients:sheet.loadFailed')}
          action={
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        />
      ) : (
        <SheetBody sheet={sheet} />
      )}
    </div>
  )
}
