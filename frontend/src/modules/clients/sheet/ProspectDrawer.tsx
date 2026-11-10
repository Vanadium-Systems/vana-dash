import { useCallback } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { SidePeek } from '@/shared/components/ui/side-peek'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import { t } from '@/shared/lib/i18n'
import { ProspectSheetView } from './ProspectSheetView'
import type { ListState } from './types'

export const PROSPECT_PARAM = 'prospect'

/** The sheet as a drawer from the right, driven by `?prospect=<id>` so a refresh or a shared link reopens it. On a phone it is always the page. */
export function ProspectDrawer({ list }: { list: ListState }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const desktop = useMediaQuery('(min-width: 768px)')
  const id = searchParams.get(PROSPECT_PARAM)

  const setProspect = useCallback(
    (next: string | null) =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (next) params.set(PROSPECT_PARAM, next)
          else params.delete(PROSPECT_PARAM)
          return params
        },
        { replace: true },
      ),
    [setSearchParams],
  )
  const close = useCallback(() => setProspect(null), [setProspect])

  if (!id) return null
  if (!desktop) return <Navigate to={`/clients/${id}`} replace state={{ list }} />
  return (
    <SidePeek open onClose={close} title={t('clients:sheet.drawerTitle')} className="prospect-drawer md:w-[min(1000px,calc(100vw-64px))]">
      <ProspectSheetView id={id} variant="drawer" list={list} onOpen={setProspect} onGone={close} onExpand={() => navigate(`/clients/${id}`, { state: { list } })} />
    </SidePeek>
  )
}
