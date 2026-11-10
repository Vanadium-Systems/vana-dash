import { useCallback } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ProspectSheetView } from './ProspectSheetView'
import type { ListState } from './types'

/** `/clients/:id`: the same sheet over the whole width. The list it came from rides along in the location state. */
export function ProspectPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const list = (location.state as { list?: ListState } | null)?.list
  const toList = useCallback(() => navigate('/clients'), [navigate])
  const open = useCallback((next: string) => navigate(`/clients/${next}`, { replace: true, state: location.state }), [navigate, location.state])
  return (
    <div className="mx-auto max-w-6xl">
      <ProspectSheetView id={id} variant="page" list={list} onOpen={open} onGone={toList} onBack={() => (location.key === 'default' ? toList() : navigate(-1))} />
    </div>
  )
}
