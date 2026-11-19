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
import { hasNativeCall, nativeRing } from '@/shared/lib/native-call'
import { saveCallKey } from './call-keys'

type IncomingCall = Extract<ChatStreamEvent, { type: 'call.incoming' }>

// Same as CALL_RING_MS in the backend and RING_MS in the APK.
const RING_TIMEOUT_MS = 45_000
const RING_INTERVAL_MS = 3_000
const VIBRATION_PATTERN = [900, 300, 900]

// Two short rising phrases, like a phone, loud enough to hear from across the room.
function playRingTone(): void {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  try {
    const audio = new AudioContextClass()
    const now = audio.currentTime
    const notes = [659.25, 783.99, 987.77, 659.25, 783.99, 987.77]
    notes.forEach((freq, i) => {
      const start = now + i * 0.16 + (i >= 3 ? 0.35 : 0)
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)
      osc.connect(gain)
      gain.connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.16)
    })
    window.setTimeout(() => void audio.close().catch(() => undefined), 1_600)
  } catch {
    // Autoplay blocked or unavailable.
  }
}

function startRinging(): () => void {
  if (hasNativeCall) {
    // The phone's own ringtone; the WebView's audio would be quiet and play through the call stream.
    void nativeRing.start()
    navigator.vibrate?.(VIBRATION_PATTERN)
    const vibrate = window.setInterval(() => navigator.vibrate?.(VIBRATION_PATTERN), RING_INTERVAL_MS)
    return () => {
      window.clearInterval(vibrate)
      navigator.vibrate?.(0)
      void nativeRing.stop()
    }
  }
  const ring = () => {
    playRingTone()
    navigator.vibrate?.(VIBRATION_PATTERN)
  }
  ring()
  const timer = window.setInterval(ring, RING_INTERVAL_MS)
  return () => {
    window.clearInterval(timer)
    navigator.vibrate?.(0)
  }
}

const callTag = (callId: string) => `call-${callId}`

// Tab in the background: a system notification with Answer / Decline, handled in push-sw.js.
async function showSystemNotification(call: IncomingCall): Promise<void> {
  if (hasNativeCall || document.visibilityState !== 'hidden') return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    await registration.showNotification(call.callerName, {
      body: call.kind === 'audio' ? t('messages:calls.incomingAudio') : t('messages:calls.incomingVideo'),
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: callTag(call.callId),
      requireInteraction: true,
      data: { url: `/calls/${call.callId}`, callId: call.callId },
      actions: [
        { action: 'accept', title: t('messages:calls.accept') },
        { action: 'decline', title: t('messages:calls.decline') },
      ],
    } as NotificationOptions)
  } catch {
    // No service worker (dev) or notifications blocked: the popup and the ring remain.
  }
}

async function closeSystemNotification(callId: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const shown = (await registration?.getNotifications({ tag: callTag(callId) })) ?? []
    shown.forEach((notification) => notification.close())
  } catch {
    // Nothing shown.
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
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
  const stopRingRef = useRef<(() => void) | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const clearRing = useCallback(() => {
    stopRingRef.current?.()
    stopRingRef.current = null
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
    const callId = incoming.callId
    stopRingRef.current = startRinging()
    void showSystemNotification(incoming)
    timeoutRef.current = window.setTimeout(() => setIncoming(null), RING_TIMEOUT_MS)
    return () => {
      clearRing()
      void closeSystemNotification(callId)
    }
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
      className="glass fixed inset-x-3 top-3 z-overlay rounded-lg border p-4 shadow-lg md:inset-x-auto md:left-1/2 md:top-6 md:w-96 md:-translate-x-1/2"
    >
      <div className="flex items-center gap-4">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-primary/25 motion-safe:animate-ping" aria-hidden /> {/* slop-ok: the ring made visible, off with reduced motion */}
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
            {initials(incoming.callerName)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{incoming.callerName}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <KindIcon className="h-4 w-4 shrink-0" />
            {incoming.kind === 'audio' ? t('messages:calls.incomingAudio') : t('messages:calls.incomingVideo')}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button type="button" variant="destructive" size="lg" onClick={() => void decline()}>
          <PhoneOff className="h-4 w-4" />
          {t('messages:calls.decline')}
        </Button>
        <Button type="button" size="lg" onClick={accept} disabled={busy}>
          <KindIcon className="h-4 w-4" />
          {t('messages:calls.accept')}
        </Button>
      </div>
    </div>
  )
}
