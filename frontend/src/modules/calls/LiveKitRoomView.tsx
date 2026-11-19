import {
  ConnectionState,
  DisconnectReason,
  ExternalE2EEKeyProvider,
  LocalParticipant,
  Participant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  isE2EESupported,
  type RemoteTrack,
  type TrackPublication,
} from 'livekit-client'
import E2EEWorker from 'livekit-client/e2ee-worker?worker'
import {
  Ban,
  Bluetooth,
  Clock,
  Lock,
  LayoutGrid,
  Maximize2,
  Mic,
  Monitor,
  PhoneOff,
  RefreshCw,
  Users,
  Video,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { toastError } from '@/shared/lib/errors'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { StatePill } from '@/shared/components/ui/state-pill'
import { formatDuration } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { isNative } from '@/shared/lib/native'
import {
  endNativeCall,
  hasNativeCall,
  onNativeAudioState,
  onNativeCallHangup,
  setNativeAudioRoute,
  startNativeCall,
  type AudioRoute,
  type AudioState,
} from '@/shared/lib/native-call'
import { cn } from '@/shared/lib/utils'
import type { CallKind } from './types'

export interface LiveKitRoomViewProps {
  livekitUrl: string
  token: string
  e2eeKey: string
  kind: CallKind
  title: string
  headerActions?: ReactNode
  publicFallbackUrl?: string | null
  /** Since when the room runs, and when it closes; the room's metadata overrides the latter after an extension. */
  startedAt?: string
  expiresAt?: string
  /** The host gives the call another hour. */
  onExtend?: () => Promise<unknown>
  /** The floating window shown while the person is elsewhere in the app. */
  compact?: boolean
  onExpand?: () => void
  /** The host lets everyone, or one person, share the screen. Absent for guests. */
  onScreenShare?: (input: ScreenShareChange) => Promise<unknown>
  /** `lastOut`: nobody else was left in the room. */
  onLeave: (lastOut: boolean) => void
  onEndForAll?: () => void
}

type ScreenShareChange = { everyone: boolean } | { identity: string; allowed: boolean }

// The server writes both (shared/lib/livekit.ts): the host flag in each token, who may share in
// the room. The SFU enforces it; these only decide which buttons show.
function isHostParticipant(participant: Participant): boolean {
  try {
    return (JSON.parse(participant.metadata || '{}') as { host?: unknown }).host === true
  } catch {
    return false
  }
}

function sharePolicyOf(room: Room | null): { everyone: boolean; allowed: string[] } {
  try {
    const parsed = JSON.parse(room?.metadata || '{}') as { screenShare?: { everyone?: unknown; allowed?: unknown } }
    const allowed = parsed.screenShare?.allowed
    return { everyone: parsed.screenShare?.everyone === true, allowed: Array.isArray(allowed) ? allowed.map(String) : [] }
  } catch {
    return { everyone: false, allowed: [] }
  }
}

function roomExpiryOf(room: Room | null): string | null {
  try {
    const value = (JSON.parse(room?.metadata || '{}') as { expiresAt?: unknown }).expiresAt
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

// The close job runs every 30 minutes, so the real end can come a bit after this; the warning
// still names the time the call is due to close.
const WARN_BEFORE_MS = 10 * 60_000

/** Re-renders itself once a second; the room around it does not. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function CallClock({ startedAt }: { startedAt: string }) {
  const now = useNow()
  return (
    <span className="tnum inline-flex items-center gap-1 text-xs text-muted-foreground" title={t('calls:room.elapsed')}>
      <Clock className="h-3.5 w-3.5" />
      {formatDuration((now - Date.parse(startedAt)) / 1000)}
    </span>
  )
}

function ExpiryNotice({ expiresAt, onExtend }: { expiresAt: string; onExtend?: () => void }) {
  const now = useNow()
  const left = Date.parse(expiresAt) - now
  if (left > WARN_BEFORE_MS) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-text/40 bg-card px-3 py-2 text-sm text-warning-text" role="status">
      <span>
        {left > 0 ? t('calls:room.closesIn', { minutes: Math.max(1, Math.ceil(left / 60_000)) }) : t('calls:room.closingNow')}
      </span>
      {onExtend ? (
        <Button type="button" size="sm" variant="outline" onClick={onExtend}>
          {t('calls:room.extend')}
        </Button>
      ) : null}
    </div>
  )
}

function CompactExpiry({ expiresAt }: { expiresAt: string }) {
  const now = useNow()
  const left = Date.parse(expiresAt) - now
  if (left > WARN_BEFORE_MS) return null
  return <span className="text-warning-text">{t('calls:room.closesInShort', { minutes: Math.max(1, Math.ceil(left / 60_000)) })}</span>
}

interface TileInfo {
  key: string
  participant: Participant
  isLocal: boolean
  isScreenShare: boolean
  videoPublication?: TrackPublication
  audioPublication?: TrackPublication
  isSpeaking: boolean
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

function VideoElement({
  publication,
  mirror,
  contain,
}: {
  publication: TrackPublication | undefined
  mirror?: boolean
  contain?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const track = publication?.track

  useEffect(() => {
    const el = ref.current
    if (!el || !track) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  if (!track || publication?.isMuted) return null
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        'h-full w-full',
        contain ? 'object-contain' : 'object-cover',
        mirror && '-scale-x-100',
      )}
    />
  )
}

function AudioElement({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return <audio ref={ref} autoPlay />
}

function ParticipantTile({
  tile,
  focused,
  compact,
  bare,
  onToggleFocus,
  shareControl,
}: {
  tile: TileInfo
  focused: boolean
  compact?: boolean
  /** Fills its box with no buttons or name: the floating window draws its own. */
  bare?: boolean
  onToggleFocus: () => void
  /** Only on the host's screen, on someone else's camera tile. */
  shareControl?: { allowed: boolean; onToggle: () => void }
}) {
  const displayName = tile.participant.name || tile.participant.identity
  const hasVideo = Boolean(tile.videoPublication?.track && !tile.videoPublication.isMuted)
  const audioMuted = tile.audioPublication?.isMuted ?? !tile.participant.isMicrophoneEnabled
  const focusLabel = focused ? t('calls:room.unfocus') : t('calls:room.focus')

  return (
    // A click anywhere on the picture focuses it; the corner button is the same for the keyboard.
    <div
      onClick={onToggleFocus}
      className={cn(
        'group relative flex cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-card',
        bare ? 'h-full w-full rounded-none border-0' : compact ? 'h-28 md:h-32' : 'min-h-48',
        tile.isSpeaking && !bare && 'ring-2 ring-glow',
      )}
    >
      {bare ? null : (
      <button
        type="button"
        aria-label={focusLabel}
        title={focusLabel}
        onClick={(event) => {
          event.stopPropagation()
          onToggleFocus()
        }}
        className="absolute right-2 top-2 z-10 inline-flex size-8 items-center justify-center rounded-md bg-background/80 text-foreground opacity-0 backdrop-blur-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        {focused ? <LayoutGrid className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
      )}
      {shareControl && !bare ? (
        <button
          type="button"
          aria-pressed={shareControl.allowed}
          title={shareControl.allowed ? t('calls:room.revokeShare') : t('calls:room.allowShare')}
          onClick={(event) => {
            event.stopPropagation()
            shareControl.onToggle()
          }}
          className={cn(
            'absolute left-2 top-2 z-10 inline-flex h-8 items-center gap-1.5 rounded-md bg-background/80 px-2 text-xs font-medium backdrop-blur-sm transition-opacity',
            shareControl.allowed ? 'text-primary' : 'text-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <Monitor className="size-4" />
          <span>{shareControl.allowed ? t('calls:room.revokeShare') : t('calls:room.allowShare')}</span>
        </button>
      ) : null}
      {hasVideo ? (
        <VideoElement
          publication={tile.videoPublication}
          mirror={tile.isLocal && !tile.isScreenShare}
          contain={tile.isScreenShare}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 p-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
            {initials(displayName)}
          </div>
          <span className="max-w-44 truncate text-sm font-medium text-foreground">{displayName}</span>
        </div>
      )}

      <div className={cn('absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2', bare && 'hidden')}>
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-xs font-medium text-foreground backdrop-blur-sm">
          <span className="truncate">
            {displayName}
            {tile.isLocal ? ` (${t('calls:room.you')})` : ''}
            {tile.isScreenShare ? ` · ${t('calls:room.screenShare')}` : ''}
          </span>
        </span>
        {!tile.isScreenShare && audioMuted ? (
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background/80 text-destructive-text backdrop-blur-sm"
            aria-label={t('calls:room.micMuted')}
          >
            <Ban className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function LiveKitRoomView({
  livekitUrl,
  token,
  e2eeKey,
  kind,
  title,
  headerActions,
  publicFallbackUrl,
  onLeave,
  onEndForAll,
  onScreenShare,
  compact,
  onExpand,
  startedAt,
  expiresAt,
  onExtend,
}: LiveKitRoomViewProps) {
  const supported = useMemo(() => isE2EESupported(), [])
  const canScreenShare = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Connecting)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [e2eeActive, setE2eeActive] = useState(false)
  const [micEnabled, setMicEnabled] = useState(true)
  const [camEnabled, setCamEnabled] = useState(kind === 'video')
  const [screenEnabled, setScreenEnabled] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [version, setVersion] = useState(0)
  const [audioState, setAudioState] = useState<AudioState | null>(null)
  // A tile picked by hand; 'none' = the person went back to the grid while a screen was shared.
  const [pinned, setPinned] = useState<string | null>(null)

  const roomRef = useRef<Room | null>(null)
  const onLeaveRef = useRef(onLeave)
  onLeaveRef.current = onLeave
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    if (!supported || !e2eeKey) return
    let cancelled = false

    const keyProvider = new ExternalE2EEKeyProvider()
    const worker = new E2EEWorker()
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      encryption: { keyProvider, worker },
    })
    roomRef.current = room

    const events: RoomEvent[] = [
      RoomEvent.ConnectionStateChanged,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.RoomMetadataChanged,
      RoomEvent.ParticipantMetadataChanged,
      RoomEvent.ParticipantPermissionsChanged,
    ]
    const onRoomChange = () => {
      if (!cancelled) {
        setConnState(room.state)
        setMicEnabled(room.localParticipant.isMicrophoneEnabled)
        setCamEnabled(room.localParticipant.isCameraEnabled)
        setScreenEnabled(room.localParticipant.isScreenShareEnabled)
        bump()
      }
    }
    for (const ev of events) room.on(ev, onRoomChange)

    const onDisconnected = (reason?: DisconnectReason) => {
      if (cancelled) return
      setConnState(ConnectionState.Disconnected)
      bump()
      // Ended for everyone (or removed): the room is gone, so the page or the floating window goes too.
      if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.PARTICIPANT_REMOVED) onLeaveRef.current(false)
    }
    room.on(RoomEvent.Disconnected, onDisconnected)

    // One screen at a time: whoever starts sharing takes over, and the one sharing before stops.
    const onRemoteShare = (publication: TrackPublication, participant: Participant) => {
      if (cancelled || publication.source !== Track.Source.ScreenShare || !room.localParticipant.isScreenShareEnabled) return
      void room.localParticipant.setScreenShareEnabled(false).then(() => {
        setScreenEnabled(false)
        toast(t('calls:room.shareTakenOver', { name: participant.name || participant.identity }))
      })
    }
    room.on(RoomEvent.TrackPublished, onRemoteShare)

    void (async () => {
      try {
        await keyProvider.setKey(e2eeKey)
        await room.setE2EEEnabled(true)
        if (!cancelled) setE2eeActive(true)
        await room.connect(livekitUrl, token)
        if (cancelled) return

        // Enable mic (and camera when kind === 'video'); continue even if hardware is denied so
        // the user stays in the call to listen and see others.
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => setMicEnabled(false))
        if (kind === 'video') {
          await room.localParticipant.setCameraEnabled(true).catch(() => setCamEnabled(false))
        }
        // APK: keeps the call alive with the screen off and picks earpiece / speaker / Bluetooth.
        // Set again after the microphone opened, since Chromium chooses its own device then.
        const native = await startNativeCall({ title, body: t('calls:room.ongoingNotice'), kind })
        if (native?.route && !cancelled) setAudioState(await setNativeAudioRoute(native.route))
        const devices = await Room.getLocalDevices('videoinput').catch(() => [])
        if (!cancelled) setHasMultipleCameras(devices.length > 1)
        bump()
      } catch (err) {
        if (!cancelled) {
          setConnectError(err instanceof Error ? err.message : t('calls:room.connectFailed'))
          setConnState(ConnectionState.Disconnected)
        }
      }
    })()

    return () => {
      cancelled = true
      room.off(RoomEvent.Disconnected, onDisconnected)
      room.off(RoomEvent.TrackPublished, onRemoteShare)
      for (const ev of events) room.off(ev, onRoomChange)
      void room.disconnect()
      worker.terminate()
      roomRef.current = null
      endNativeCall()
    }
    // `title` only labels the ongoing call notification: a rename must not reconnect.
  }, [supported, e2eeKey, livekitUrl, token, kind, bump])

  useEffect(() => onNativeAudioState(setAudioState), [])
  useEffect(
    () =>
      onNativeCallHangup(() => {
        const room = roomRef.current
        const lastOut = room ? room.remoteParticipants.size === 0 : false
        void room?.disconnect()
        onLeaveRef.current(lastOut)
      }),
    [],
  )

  async function changeRoute(route: AudioRoute) {
    const next = await setNativeAudioRoute(route)
    if (next) setAudioState(next)
  }

  async function toggleMic() {
    const room = roomRef.current
    if (!room) return
    const next = !micEnabled
    try {
      await room.localParticipant.setMicrophoneEnabled(next)
      setMicEnabled(next)
    } catch {
      setMicEnabled(false)
    }
  }

  async function toggleCam() {
    const room = roomRef.current
    if (!room) return
    const next = !camEnabled
    try {
      await room.localParticipant.setCameraEnabled(next, next ? { facingMode } : undefined)
      setCamEnabled(next)
    } catch {
      setCamEnabled(false)
    }
  }

  async function switchCamera() {
    const room = roomRef.current
    if (!room || !camEnabled) return
    const nextMode = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(nextMode)
    await room.localParticipant.setCameraEnabled(true, { facingMode: nextMode }).catch(() => undefined)
  }

  async function changeSharing(input: ScreenShareChange) {
    try {
      await onScreenShare?.(input)
    } catch (err) {
      toastError(err)
    }
  }

  async function toggleScreen() {
    const room = roomRef.current
    if (!room || !canScreenShare) return
    const next = !screenEnabled
    try {
      await room.localParticipant.setScreenShareEnabled(next)
      setScreenEnabled(next)
    } catch {
      setScreenEnabled(false)
    }
  }

  function leave() {
    const room = roomRef.current
    const lastOut = room ? room.remoteParticipants.size === 0 : false
    void room?.disconnect()
    onLeave(lastOut)
  }

  if (!supported) {
    return (
      <div className="space-y-4 p-4">
        <Alert tone="critical" title={t('calls:room.e2eeUnsupportedTitle')}>
          {t('calls:room.e2eeUnsupportedBody')}
        </Alert>
        <div className="flex flex-wrap gap-2">
          {isNative && publicFallbackUrl ? (
            <Button onClick={() => window.open(publicFallbackUrl, '_blank', 'noopener,noreferrer')}>
              {t('calls:room.openInChrome')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onLeave(false)}>
            {t('calls:actions.back')}
          </Button>
        </div>
      </div>
    )
  }

  if (connectError) {
    return (
      <div className="space-y-4 p-4">
        <Alert tone="critical" title={t('calls:room.connectFailed')}>
          {connectError}
        </Alert>
        <Button variant="outline" onClick={() => onLeave(false)}>
          {t('calls:actions.back')}
        </Button>
      </div>
    )
  }

  const room = roomRef.current
  // Recompute tiles whenever `version` increments on room/track events.
  void version
  const participants: Participant[] = room
    ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
    : []

  const amHost = room ? isHostParticipant(room.localParticipant) : false
  const sharePolicy = sharePolicyOf(room)
  const mayShare = amHost || sharePolicy.everyone || (room ? sharePolicy.allowed.includes(room.localParticipant.identity) : false)
  const hostControls = amHost && Boolean(onScreenShare)
  const shareControlFor = (tile: TileInfo) =>
    hostControls && !tile.isLocal && !tile.isScreenShare && !sharePolicy.everyone && !isHostParticipant(tile.participant)
      ? {
          allowed: sharePolicy.allowed.includes(tile.participant.identity),
          onToggle: () =>
            void changeSharing({ identity: tile.participant.identity, allowed: !sharePolicy.allowed.includes(tile.participant.identity) }),
        }
      : undefined

  const closesAt = roomExpiryOf(room) ?? expiresAt ?? null
  const extend = amHost && onExtend ? () => void onExtend().catch((err: unknown) => toastError(err)) : undefined

  const tiles: TileInfo[] = []
  const remoteAudioTracks: RemoteTrack[] = []

  for (const p of participants) {
    const isLocal = p instanceof LocalParticipant
    const camPub = p.getTrackPublication(Track.Source.Camera)
    const micPub = p.getTrackPublication(Track.Source.Microphone)
    const screenPub = p.getTrackPublication(Track.Source.ScreenShare)

    if (!isLocal && micPub?.track && !micPub.isMuted) {
      remoteAudioTracks.push(micPub.track as RemoteTrack)
    }

    tiles.push({
      key: `${p.identity}-cam`,
      participant: p,
      isLocal,
      isScreenShare: false,
      videoPublication: camPub,
      audioPublication: micPub,
      isSpeaking: p.isSpeaking,
    })

    if (screenPub?.track && !screenPub.isMuted) {
      tiles.push({
        key: `${p.identity}-screen`,
        participant: p,
        isLocal,
        isScreenShare: true,
        videoPublication: screenPub,
        isSpeaking: false,
      })
    }
  }

  // A shared screen takes the stage by itself (someone else's; your own you already see), until
  // the person picks another tile or goes back to the grid.
  const autoFocus = tiles.find((tile) => tile.isScreenShare && !tile.isLocal)?.key ?? null
  const focusKey = pinned === 'none' ? null : tiles.some((tile) => tile.key === pinned) ? pinned : autoFocus
  const focusedTile = tiles.length > 1 ? tiles.find((tile) => tile.key === focusKey) : undefined
  const toggleFocus = (key: string) => setPinned(key === focusedTile?.key ? 'none' : key)

  const gridCols =
    tiles.length <= 1
      ? 'grid-cols-1'
      : tiles.length === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : tiles.length <= 4
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  if (compact) {
    // The one picture worth seeing small: a shared screen, whoever speaks, then anyone else.
    const stage =
      focusedTile ??
      tiles.find((tile) => tile.isScreenShare && !tile.isLocal) ??
      tiles.find((tile) => !tile.isLocal && tile.isSpeaking) ??
      tiles.find((tile) => !tile.isLocal) ??
      tiles[0]
    const stageName = stage ? stage.participant.name || stage.participant.identity : ''
    return (
      <div className="relative h-full overflow-hidden rounded-lg border bg-card shadow-float">
        {stage ? (
          <ParticipantTile tile={stage} focused={false} bare onToggleFocus={() => onExpand?.()} />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-xs text-muted-foreground">{t('calls:room.connecting')}</div>
        )}
        {remoteAudioTracks.map((track) => (
          <AudioElement key={track.sid ?? track.mediaStreamID} track={track} />
        ))}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-2">
          <span className="min-w-0 truncate rounded-md bg-background/80 px-2 py-1 text-xs font-medium backdrop-blur-sm">
            {title}
            {stageName ? ` · ${stageName}` : ''}
          </span>
          {startedAt || closesAt ? (
            <span className="ml-auto flex shrink-0 items-center gap-2 rounded-md bg-background/80 px-2 py-1 text-xs backdrop-blur-sm">
              {startedAt ? <CallClock startedAt={startedAt} /> : null}
              {closesAt ? <CompactExpiry expiresAt={closesAt} /> : null}
            </span>
          ) : null}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 p-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className={cn('bg-background/80 backdrop-blur-sm', !micEnabled && 'text-destructive-text')}
            aria-label={micEnabled ? t('calls:room.muteMic') : t('calls:room.unmuteMic')}
            onClick={() => void toggleMic()}
          >
            <Mic className={cn('h-4 w-4', !micEnabled && 'opacity-50')} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className={cn('bg-background/80 backdrop-blur-sm', !camEnabled && 'text-muted-foreground')}
            aria-label={camEnabled ? t('calls:room.disableCam') : t('calls:room.enableCam')}
            onClick={() => void toggleCam()}
          >
            <Video className={cn('h-4 w-4', !camEnabled && 'opacity-50')} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="bg-background/80 backdrop-blur-sm"
            aria-label={t('calls:room.expand')}
            title={t('calls:room.expand')}
            onClick={() => onExpand?.()}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="destructive" aria-label={t('calls:room.leave')} onClick={leave}>
            <PhoneOff className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-96 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          <StatePill tone={e2eeActive ? 'success' : 'neutral'}>
            <Lock className="mr-1 inline h-3 w-3" />
            {t('calls:room.e2eeBadge')}
          </StatePill>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {participants.length}
          </span>
          {startedAt ? <CallClock startedAt={startedAt} /> : null}
          {connState === ConnectionState.Reconnecting ? (
            <StatePill tone="warning">{t('calls:room.reconnecting')}</StatePill>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {onEndForAll ? (
            <Button variant="destructive" onClick={onEndForAll}>
              {t('calls:actions.endForAll')}
            </Button>
          ) : null}
        </div>
      </div>

      {closesAt ? <ExpiryNotice expiresAt={closesAt} onExtend={extend} /> : null}

      {focusedTile ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
          <div className="grid min-h-0 flex-1">
            <ParticipantTile tile={focusedTile} focused onToggleFocus={() => toggleFocus(focusedTile.key)} shareControl={shareControlFor(focusedTile)} />
          </div>
          {/* The others: a column beside the stage, a row of small tiles under it on a phone. */}
          <div className="scroll-subtle grid max-h-32 shrink-0 grid-cols-3 gap-2 overflow-y-auto md:max-h-none md:w-56 md:grid-cols-1 md:content-start">
            {tiles
              .filter((tile) => tile.key !== focusedTile.key)
              .map((tile) => (
                <ParticipantTile key={tile.key} tile={tile} focused={false} compact onToggleFocus={() => toggleFocus(tile.key)} shareControl={shareControlFor(tile)} />
              ))}
          </div>
        </div>
      ) : (
        <div className={cn('grid min-h-0 flex-1 gap-3 auto-rows-fr', gridCols)}>
          {connState === ConnectionState.Connecting && tiles.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              {t('calls:room.connecting')}
            </div>
          ) : (
            tiles.map((tile) => (
              <ParticipantTile
                key={tile.key}
                tile={tile}
                focused={false}
                onToggleFocus={() => (tiles.length > 1 ? toggleFocus(tile.key) : undefined)}
                shareControl={shareControlFor(tile)}
              />
            ))
          )}
        </div>
      )}

      {remoteAudioTracks.map((track) => (
        <AudioElement key={track.sid ?? track.mediaStreamID} track={track} />
      ))}

      <div className="flex flex-wrap items-center justify-center gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          className={!micEnabled ? 'text-destructive-text' : undefined}
          onClick={() => void toggleMic()}
          aria-label={micEnabled ? t('calls:room.muteMic') : t('calls:room.unmuteMic')}
        >
          <Mic className={cn('h-4 w-4', !micEnabled && 'opacity-50')} />
          <span>{micEnabled ? t('calls:room.micOn') : t('calls:room.micOff')}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className={!camEnabled ? 'text-muted-foreground' : undefined}
          onClick={() => void toggleCam()}
          aria-label={camEnabled ? t('calls:room.disableCam') : t('calls:room.enableCam')}
        >
          <Video className={cn('h-4 w-4', !camEnabled && 'opacity-50')} />
          <span>{camEnabled ? t('calls:room.camOn') : t('calls:room.camOff')}</span>
        </Button>

        {camEnabled && hasMultipleCameras ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void switchCamera()}
            aria-label={t('calls:room.switchCamera')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        ) : null}

        {canScreenShare ? (
          <Button
            type="button"
            variant={screenEnabled ? 'default' : 'outline'}
            disabled={!mayShare && !screenEnabled}
            title={!mayShare && !screenEnabled ? t('calls:room.shareNeedsHost') : undefined}
            onClick={() => void toggleScreen()}
            aria-label={screenEnabled ? t('calls:room.stopShare') : t('calls:room.startShare')}
          >
            <Monitor className="h-4 w-4" />
            <span>{screenEnabled ? t('calls:room.stopShare') : t('calls:room.startShare')}</span>
          </Button>
        ) : null}

        {hostControls ? (
          <Button
            type="button"
            variant={sharePolicy.everyone ? 'default' : 'outline'}
            aria-pressed={sharePolicy.everyone}
            onClick={() => void changeSharing({ everyone: !sharePolicy.everyone })}
          >
            <Users className="h-4 w-4" />
            <span>{t('calls:room.everyoneShares')}</span>
          </Button>
        ) : null}

        {hasNativeCall && audioState ? (
          <Button
            type="button"
            variant={audioState.route === 'speaker' ? 'default' : 'outline'}
            aria-pressed={audioState.route === 'speaker'}
            onClick={() => void changeRoute(audioState.route === 'speaker' ? (audioState.bluetooth ? 'headset' : 'earpiece') : 'speaker')}
          >
            <Volume2 className="h-4 w-4" />
            <span>{t('calls:room.speaker')}</span>
          </Button>
        ) : null}

        {hasNativeCall && audioState?.bluetooth && audioState.route !== 'speaker' ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void changeRoute(audioState.route === 'phone-mic' ? 'headset' : 'phone-mic')}
          >
            <Bluetooth className="h-4 w-4" />
            <span>{audioState.route === 'phone-mic' ? t('calls:room.micPhone') : t('calls:room.micHeadset')}</span>
          </Button>
        ) : null}

        <Button type="button" variant="destructive" onClick={leave}>
          <PhoneOff className="h-4 w-4" />
          <span>{t('calls:room.leave')}</span>
        </Button>
      </div>
    </div>
  )
}
