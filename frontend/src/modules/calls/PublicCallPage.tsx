import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { AuthLayout } from '@/shared/components/AuthLayout'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { usePublicCall } from './calls-api'

export function PublicCallPage() {
  const { publicId = '' } = useParams()
  const call = usePublicCall(publicId)
  const [joined, setJoined] = useState(false)

  // A link can be sent hours before the call starts, so the page has to wake up on its
  // own when the scheduled minute arrives instead of asking the guest to reload.
  const opensAt = call.data?.opensAt ? new Date(call.data.opensAt).getTime() : null
  const waiting = opensAt !== null && opensAt > Date.now()
  const { refetch } = call
  useEffect(() => {
    if (!waiting || opensAt === null) return
    const timer = setTimeout(() => void refetch(), opensAt - Date.now() + 1000)
    return () => clearTimeout(timer)
  }, [waiting, opensAt, refetch])

  // Once the guest is in, Daily's own UI fills the screen: no shell, no chrome.
  if (joined && call.data?.roomUrl) {
    return (
      <iframe
        title={t('calls:public.heading')}
        src={call.data.roomUrl}
        allow="camera; microphone; display-capture; autoplay; fullscreen"
        className="h-dvh w-full"
      />
    )
  }

  let subline = t('calls:room.loading')
  let body: ReactNode = <Skeleton className="h-9 w-full" />

  // Both 404 and 400 are a link we do not recognise, so the guest gets one plain hint.
  if (call.isError) {
    subline = t('calls:public.notFound')
    body = null
  }

  if (call.data?.status === 'ended') {
    subline = t('calls:public.ended')
    body = null
  }

  if (waiting) {
    subline = t('calls:public.notYet', { time: formatDateTime(opensAt) })
    body = null
  }

  if (call.data?.status === 'open') {
    subline = t('calls:public.ready')
    body = (
      <div className="space-y-3">
        <Button className="w-full" onClick={() => setJoined(true)}>{t('calls:public.join')}</Button>
        <p className="text-xs text-muted-foreground">{t('calls:public.help')}</p>
        <p className="text-xs text-muted-foreground">{t('calls:public.uiLanguage')}</p>
      </div>
    )
  }

  return (
    <AuthLayout title={t('calls:public.heading')} subline={subline}>
      {body}
    </AuthLayout>
  )
}
