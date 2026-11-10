import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { ChatMessageRef } from '@/shared/lib/types'

interface SheetFacts {
  assignedUserId: string | null
  canEdit: boolean
}

/** The id to ask access for: a live card has it as `refId`; a denied one only if the server put it on the card. */
export function requestableProspectId(refItem: ChatMessageRef): string | null {
  if (refItem.state === 'live') return refItem.refId
  const id = refItem.card.prospectId
  return refItem.state === 'denied' && typeof id === 'string' ? id : null
}

/** MS5: what you can do with a prospect straight from the message that shares it. */
export function ProspectCardActions({ refItem }: { refItem: ChatMessageRef }) {
  const { can, session } = useMe()
  const queryClient = useQueryClient()
  const allowed = can('clienti.prospectare')
  const prospectId = requestableProspectId(refItem)
  const live = refItem.state === 'live' && refItem.canOpen
  const facts = useQuery({
    queryKey: ['prospects', 'sheet', prospectId],
    queryFn: () => api.get<SheetFacts>(`/api/prospects/${prospectId}`),
    enabled: allowed && live && Boolean(prospectId),
    staleTime: 30_000,
  })

  if (!allowed || !prospectId) return null

  const run = (path: string, body: unknown, done: string) =>
    api.post(path, body).then(
      () => {
        toast.success(done)
        void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      },
      (err: Error) => toast.error(err.message),
    )
  const request = (kind: 'transfer' | 'access') => void run(`/api/prospects/${prospectId}/transfer-requests`, { kind }, t('clients:sheet.team.requestSent'))

  if (!live) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => request('access')}>
          {t('clients:sheet.cardActions.requestAccess')}
        </Button>
      </div>
    )
  }
  const sheet = facts.data
  if (!sheet || sheet.canEdit) return null
  const mine = sheet.assignedUserId === session?.user.id
  if (mine) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {sheet.assignedUserId ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => request('transfer')}>
            {t('clients:sheet.team.requestTransfer')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => request('access')}>
            {t('clients:sheet.cardActions.requestAccess')}
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => void run(`/api/prospects/${prospectId}/claim`, undefined, t('clients:sheet.team.claimed'))}>
          {t('clients:sheet.team.claim')}
        </Button>
      )}
    </div>
  )
}
