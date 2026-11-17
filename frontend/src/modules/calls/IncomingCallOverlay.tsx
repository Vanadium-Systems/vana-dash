import { Phone, PhoneOff, Video } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useE2E } from '@/modules/messages/crypto/E2EProvider'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { Button } from '@/shared/components/ui/button'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { ChatStreamEvent } from '@/shared/lib/types'
import { saveCallKey } from './call-keys'

type IncomingCall = Extract<ChatStreamEvent, { type: 'call.incoming' }>

const RING_TIMEOUT_MS = 45_000
const RING_INTERVAL_MS = 2_400

function playRingChime(): void {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  try {
    const audio = new AudioContextClass()
    const now = audio.currentTime
    const notes = [523.25, 659.25] // C5 -> E5 soft chime
    notes.forEach((freq, i) => {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + i * 0.14)
      gain.gain.setValueAtTime(0.0001, now + i * 0.14)
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.14 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.25)
      osc.connect(gain)
      gain.connect(audio.destination)
      osc.start(now + i * 0.14)
      osc.stop(now + i * 0.14 + 0.28)
    })
    window.setTimeout(() => void audio.close().catch(() => undefined), 900)
  } catch {
    // Autoplay blocked or unavailable.
  }
}

export function IncomingCallOverlay() {
  const { session } = useMe()
  const { subscribe } = useChatStream()
  const e2e = useE2E()
  const navigate = useNavigate()
  const location = useLocation()
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [decryptedKey, setDecryptedKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ringTimerRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const clearRing = useCallback(() => {
    if (ringTimerRef.current !== null) {
      window.clearInterval(ringTimerRef.current)
      ringTimerRef.current = null
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    const meId = session?.user.id
    return subscribe((event) => {
      if (event.type === 'call.incoming') {
        if (event.callerUserId === meId) return
        if (location.pathname === `/calls/${event.callId}`) return
        setDecryptedKey(null)
        setIncoming(event)
      } else if (event.type === 'call.ended') {
        setIncoming((prev) => (prev?.callId === event.callId ? null : prev))
      } else if (event.type === 'call.declined') {
        toast.info(t('messages:calls.declinedBy', { name: event.userName }))
      }
    })
  }, [subscribe, session?.user.id, location.pathname])

  // Ringing loop while overlay is open.
  useEffect(() => {
    clearRing()
    if (!incoming) return
    playRingChime()
    ringTimerRef.current = window.setInterval(playRingChime, RING_INTERVAL_MS)
    timeoutRef.current = window.setTimeout(() => setIncoming(null), RING_TIMEOUT_MS)
    return clearRing
  }, [incoming, clearRing])

  // Decrypt the Megolm payload right away so accepting joins with 1 click.
  useEffect(() => {
    if (!incoming?.encrypted || e2e.status !== 'ready' || !e2e.engine) return
    let cancelled = false
    void e2e.engine
      .decrypt({
        id: incoming.messageId,
        conversationId: incoming.conversationId,
        authorUserId: incoming.callerUserId,
        encrypted: incoming.encrypted,
      })
      .then((res) => {
        if (!cancelled && res.status === 'ok' && res.content.call?.key) {
          saveCallKey(incoming.callId, res.content.call.key)
          setDecryptedKey(res.content.call.key)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [incoming, e2e.status, e2e.engine])

  if (!incoming) return null

  async function decline() {
    if (!incoming) return
    const callId = incoming.callId
    clearRing()
    setIncoming(null)
    await api.post(`/api/chat/calls/${callId}/decline`, {}).catch(() => undefined)
  }

  function accept() {
    if (!incoming || busy) return
    setBusy(true)
    const callId = incoming.callId
    const key = decryptedKey
    clearRing()
    setIncoming(null)
    setBusy(false)
    navigate(key ? `/calls/${callId}#k=${encodeURIComponent(key)}` : `/calls/${callId}`)
  }

  const KindIcon = incoming.kind === 'audio' ? Phone : Video

  return (
    <div
      role="alertdialog"
      aria-label={t('messages:calls.incomingTitle', { name: incoming.callerName })}
      className="glass fixed bottom-20 right-4 z-overlay w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-4 shadow-lg md:bottom-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <KindIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{incoming.callerName}</p>
          <p className="text-xs text-muted-foreground">
            {incoming.kind === 'audio' ? t('messages:calls.incomingAudio') : t('messages:calls.incomingVideo')}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void decline()}>
          <PhoneOff className="h-4 w-4" />
          {t('messages:calls.decline')}
        </Button>
        <Button type="button" size="sm" onClick={accept} disabled={busy}>
          <KindIcon className="h-4 w-4" />
          {t('messages:calls.accept')}
        </Button>
      </div>
    </div>
  )
}
