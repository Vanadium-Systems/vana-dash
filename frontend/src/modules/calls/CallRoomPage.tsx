import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { copyCallLink, useCalls, useEndCall, useJoinCall } from './calls-api'

export function CallRoomPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const join = useJoinCall(id)
  const openCalls = useCalls('open')
  const call = openCalls.data?.find((c) => c.id === id)
  const endCall = useEndCall()

  const back = (
    <Button variant="ghost" size="sm" onClick={() => navigate('/calls')}>
      <ArrowLeft className="h-4 w-4" />
      {t('calls:actions.back')}
    </Button>
  )

  async function onEnd() {
    if (await endCall({ id, title: call?.title ?? '' })) navigate('/calls')
  }

  if (join.isPending) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('calls:room.loading')}</p>
        <Skeleton className="h-[calc(100dvh-8rem)] w-full" />
      </div>
    )
  }

  if (join.isError) {
    const closed = join.error instanceof ApiError && join.error.status === 410
    return (
      <div className="space-y-3">
        {back}
        <p className="text-sm text-muted-foreground">
          {closed ? t('calls:room.closed') : join.error.message}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        {back}
        <div className="flex gap-2">
          {call ? (
            <Button variant="outline" size="sm" onClick={() => void copyCallLink(call)}>
              {t('calls:actions.copyLink')}
            </Button>
          ) : null}
          <Button variant="destructive" size="sm" onClick={() => void onEnd()}>
            {t('calls:actions.endForAll')}
          </Button>
        </div>
      </div>
      <iframe
        title={call?.title ?? t('calls:title')}
        src={`${join.data.roomUrl}?t=${encodeURIComponent(join.data.token)}`}
        allow="camera; microphone; display-capture; autoplay; fullscreen"
        className="h-[calc(100dvh-8rem)] w-full rounded-md bg-muted"
      />
    </div>
  )
}
