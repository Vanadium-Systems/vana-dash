import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { AuthLayout } from '@/shared/components/AuthLayout'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { extractKeyFromHash } from './call-keys'
import { usePublicCall, usePublicCallToken } from './calls-api'
import { LiveKitRoomView } from './LiveKitRoomView'
import type { PublicCallTokenResponse } from './types'
import { errorText } from '@/shared/lib/errors'

export function PublicCallPage() {
  const { publicId = '' } = useParams()
  const call = usePublicCall(publicId)
  const mintToken = usePublicCallToken(publicId)
  const [guestName, setGuestName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [session, setSession] = useState<PublicCallTokenResponse | null>(null)

  const e2eeKey = extractKeyFromHash()

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

  // LiveKit E2EE guest room.
  if (session && e2eeKey) {
    return (
      // arbitrary: viewport-height calc, no token
      <div className="h-dvh bg-background p-4">
        <LiveKitRoomView
          livekitUrl={session.livekitUrl}
          token={session.token}
          e2eeKey={e2eeKey}
          kind={session.kind}
          title={t('calls:public.heading')}
          publicFallbackUrl={window.location.href}
          startedAt={session.startedAt}
          expiresAt={session.expiresAt}
          onLeave={() => setSession(null)}
        />
      </div>
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

  if (call.data?.status === 'open' && !waiting) {
    // A removed-provider (Daily) call arrives as ended, so an open one here is always LiveKit.
    if (!e2eeKey) {
      subline = t('calls:public.missingKey')
      body = null
    } else {
      subline = t('calls:public.ready')
      body = (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = guestName.trim()
            if (!trimmed) {
              setNameError(t('calls:public.nameRequired'))
              return
            }
            setNameError(null)
            void mintToken.mutateAsync(trimmed).then(setSession).catch(() => undefined)
          }}
        >
          <Field label={t('calls:public.nameLabel')} error={nameError}>
            <Input
              value={guestName}
              maxLength={80}
              placeholder={t('calls:public.namePlaceholder')}
              onChange={(event) => setGuestName(event.target.value)}
            />
          </Field>
          {mintToken.isError ? (
            <p className="text-sm text-destructive-text">{errorText(mintToken.error)}</p>
          ) : null}
          <Button type="submit" className="w-full" disabled={mintToken.isPending}>
            {t('calls:public.join')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('calls:public.privacyNotice')}</p>
          <p className="text-xs text-muted-foreground">{t('calls:public.help')}</p>
        </form>
      )
    }
  }

  return (
    <AuthLayout title={t('calls:public.heading')} subline={subline}>
      {body}
    </AuthLayout>
  )
}
