import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { decryptNow, useE2E } from '@/modules/messages/crypto/E2EProvider'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useMe } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { ChatMessage } from '@/shared/lib/types'
import { extractKeyFromHash, getCallKey, parseCallKeyFromInput, saveCallKey } from './call-keys'
import { copyCallLink, useCalls, useEndCall, useJoinCall } from './calls-api'
import { LiveKitRoomView } from './LiveKitRoomView'
import { errorText } from '@/shared/lib/errors'

export function CallRoomPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useMe()
  const e2e = useE2E()
  const join = useJoinCall(id)
  const canListCalls = can('apeluri.view')
  const openCalls = useCalls('open', canListCalls)
  const call = canListCalls ? openCalls.data?.find((c) => c.id === id) : undefined
  const endCall = useEndCall()

  const [manualKey, setManualKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [chatKey, setChatKey] = useState<string | null>(null)
  const [resolvingChatKey, setResolvingChatKey] = useState(false)

  const hashKey = extractKeyFromHash()
  const storedKey = getCallKey(id)
  const serverBookingKey = join.data?.provider === 'livekit' ? join.data.guestKey : null
  const e2eeKey = hashKey ?? manualKey ?? storedKey ?? serverBookingKey ?? chatKey

  // Persist locally if it arrived via URL hash or server booking key.
  useEffect(() => {
    if (id && (hashKey || serverBookingKey)) {
      saveCallKey(id, (hashKey ?? serverBookingKey)!)
    }
  }, [id, hashKey, serverBookingKey])

  // For Mesaje calls opened on a new tab/device without local key cache, fetch the call
  // message from the conversation and decrypt its Megolm payload to recover the room key.
  useEffect(() => {
    if (e2eeKey || join.data?.provider !== 'livekit' || !join.data.conversationId) return
    if (e2e.status !== 'ready' || !e2e.engine) return
    const conversationId = join.data.conversationId
    let cancelled = false
    setResolvingChatKey(true)
    void (async () => {
      try {
        const res = await api.get<{ messages: ChatMessage[] }>(`/api/chat/conversations/${conversationId}/messages?limit=50`)
        const msg = res.messages.find((m) => m.refs.some((r) => r.type === 'call' && r.refId === id))
        if (!msg || cancelled) return
        const content = await decryptNow(e2e.engine, msg)
        if (!cancelled && content?.call?.key) {
          saveCallKey(id, content.call.key)
          setChatKey(content.call.key)
        }
      } catch {
        // Handled by manual key fallback or E2E status notice below.
      } finally {
        if (!cancelled) setResolvingChatKey(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [e2eeKey, join.data, e2e.status, e2e.engine, id])

  const backTarget =
    join.data?.provider === 'livekit' && join.data.conversationId
      ? `/messages/${join.data.conversationId}`
      : '/calls'

  const back = (
    <Button variant="ghost" onClick={() => navigate(backTarget)}>
      <ArrowLeft className="h-4 w-4" />
      {t('calls:actions.back')}
    </Button>
  )

  async function onEnd() {
    const conversationId = join.data?.provider === 'livekit' ? join.data.conversationId : null
    if (await endCall({ id, title: call?.title ?? '', conversationId })) {
      navigate(backTarget)
    }
  }

  if (join.isPending) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('calls:room.loading')}</p>
        {/* arbitrary: viewport-height calc, no token */}
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
          {closed ? t('calls:room.closed') : errorText(join.error)}
        </p>
      </div>
    )
  }

  if (join.data.provider === 'daily') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 border-b pb-2">
          {back}
          <div className="flex gap-2">
            {call ? (
              <Button variant="outline" onClick={() => void copyCallLink(call)}>
                {t('calls:actions.copyLink')}
              </Button>
            ) : null}
            <Button variant="destructive" onClick={() => void onEnd()}>
              {t('calls:actions.endForAll')}
            </Button>
          </div>
        </div>
        {/* arbitrary: viewport-height calc, no token */}
        <iframe
          title={call?.title ?? t('calls:title')}
          src={`${join.data.roomUrl}?t=${encodeURIComponent(join.data.token)}`}
          allow="camera; microphone; display-capture; autoplay; fullscreen"
          className="h-[calc(100dvh-8rem)] w-full rounded-md bg-muted"
        />
      </div>
    )
  }

  if (!e2eeKey) {
    if (resolvingChatKey || (join.data.conversationId && e2e.status === 'loading')) {
      return (
        <div className="space-y-3">
          {back}
          <p className="text-sm text-muted-foreground">{t('calls:room.decryptingKey')}</p>
          {/* arbitrary: viewport-height calc, no token */}
          <Skeleton className="h-[calc(100dvh-8rem)] w-full" />
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-md space-y-4 py-6">
        {back}
        <Alert tone="warning" title={t('calls:room.missingKeyTitle')}>
          {join.data.conversationId ? t('calls:room.missingChatKeyBody') : t('calls:room.missingKeyBody')}
        </Alert>
        {!join.data.conversationId ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              const parsed = parseCallKeyFromInput(keyInput)
              if (!parsed) {
                setKeyError(t('calls:room.invalidKey'))
                return
              }
              saveCallKey(id, parsed)
              setManualKey(parsed)
              setKeyError(null)
            }}
          >
            <Field label={t('calls:room.pasteKeyLabel')} error={keyError}>
              <Input
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder={t('calls:room.pasteKeyPlaceholder')}
              />
            </Field>
            <Button type="submit">{t('calls:actions.join')}</Button>
          </form>
        ) : null}
      </div>
    )
  }

  const headerActions = (
    <>
      {back}
      {call && !call.conversationId ? (
        <Button variant="outline" onClick={() => void copyCallLink(call, e2eeKey)}>
          {t('calls:actions.copyLink')}
        </Button>
      ) : null}
    </>
  )

  return (
    <LiveKitRoomView
      livekitUrl={join.data.livekitUrl}
      token={join.data.token}
      e2eeKey={e2eeKey}
      kind={join.data.kind}
      title={call?.title ?? t('calls:title')}
      headerActions={headerActions}
      publicFallbackUrl={call && !call.conversationId ? `${call.publicUrl}#k=${encodeURIComponent(e2eeKey)}` : null}
      onLeave={() => navigate(backTarget)}
      onEndForAll={() => void onEnd()}
    />
  )
}
