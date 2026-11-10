import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useStatuses } from '../prospects/use-prospect-data'
import type { ProspectSheet } from './types'
import { useReleaseSettings } from './use-sheet'
import { useTeamActions } from './use-team-actions'

const DAY_MS = 86_400_000

interface TeamBannerProps {
  sheet: ProspectSheet
  meId: string
  canClaim: boolean
  canReassign: boolean
  onRequest: () => void
}

/** Whose prospect it is and what is waiting on it: free, someone else's, requests, and the scheduled release. */
export function TeamBanner({ sheet, meId, canClaim, canReassign, onRequest }: TeamBannerProps) {
  const actions = useTeamActions(sheet.id)
  const statuses = useStatuses().data ?? []
  const release = useReleaseSettings().data
  const isOwner = sheet.assignedUserId === meId
  const decides = isOwner || canReassign
  const mine = sheet.pendingRequests.find((request) => request.requestedByUserId === meId)
  const incoming = decides ? sheet.pendingRequests.filter((request) => request.requestedByUserId !== meId) : []

  // The release job leaves finished business alone, so the band does too.
  const open = (statuses.find((entry) => entry.key === sheet.status)?.kind ?? 'open') === 'open'
  const lastTouch = sheet.lastActivityAt ?? sheet.claimedAt
  const daysLeft = release?.enabled && open && sheet.assignedUserId && lastTouch ? Math.ceil((new Date(lastTouch).getTime() + release.idleDays * DAY_MS - Date.now()) / DAY_MS) : null
  const releasing = release && daysLeft !== null && release.warnDays > 0 && daysLeft <= release.warnDays

  return (
    <div className="space-y-2">
      {!sheet.assignedUserId ? (
        <Alert
          title={t('clients:sheet.team.freeTitle')}
          action={
            canClaim ? (
              <Button type="button" size="sm" onClick={() => void actions.claim()}>
                {t('clients:sheet.team.claim')}
              </Button>
            ) : null
          }
        >
          {t('clients:sheet.team.freeBody')}
        </Alert>
      ) : !sheet.canEdit ? (
        <Alert
          title={t('clients:sheet.team.ownedBy', { owner: sheet.ownerName ?? '', date: sheet.claimedAt ? formatDate(sheet.claimedAt) : '—' })}
          action={
            mine ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void actions.decide(mine.id, 'cancel')}>
                {t('clients:sheet.team.cancelRequest')}
              </Button>
            ) : canClaim ? (
              <Button type="button" size="sm" variant="outline" onClick={onRequest}>
                {t('clients:sheet.team.requestTransfer')}
              </Button>
            ) : null
          }
        >
          {mine ? t(mine.kind === 'access' ? 'clients:sheet.team.accessPending' : 'clients:sheet.team.transferPending') : t('clients:sheet.team.readOnly')}
        </Alert>
      ) : null}

      {incoming.map((request) => (
        <Alert
          key={request.id}
          tone="warning"
          title={t(request.kind === 'access' ? 'clients:sheet.team.incomingAccess' : 'clients:sheet.team.incomingTransfer', { who: request.requesterName })}
          action={
            <>
              <Button type="button" size="sm" onClick={() => void actions.decide(request.id, 'accept')}>
                {t('clients:sheet.team.accept')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void actions.decide(request.id, 'refuse')}>
                {t('clients:sheet.team.refuse')}
              </Button>
            </>
          }
        >
          {request.note ?? null}
        </Alert>
      ))}

      {releasing ? <Alert tone="warning">{t(isOwner ? 'clients:sheet.team.releasingMine' : 'clients:sheet.team.releasingOther', { count: Math.max(daysLeft, 1) })}</Alert> : null}
    </div>
  )
}
