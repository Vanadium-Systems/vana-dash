import {
  ConnectionState,
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
  Lock,
  Mic,
  Monitor,
  PhoneOff,
  RefreshCw,
  Users,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { StatePill } from '@/shared/components/ui/state-pill'
import { t } from '@/shared/lib/i18n'
import { isNative } from '@/shared/lib/native'
import { cn } from '@/shared/lib/utils'
import type { CallKind } from './types'

interface LiveKitRoomViewProps {
  livekitUrl: string
  token: string
  e2eeKey: string
  kind: CallKind
  title: string
  headerActions?: ReactNode
  publicFallbackUrl?: string | null
  onLeave: () => void
  onEndForAll?: () => void
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

function ParticipantTile({ tile }: { tile: TileInfo }) {
  const displayName = tile.participant.name || tile.participant.identity
  const hasVideo = Boolean(tile.videoPublication?.track && !tile.videoPublication.isMuted)
  const audioMuted = tile.audioPublication?.isMuted ?? !tile.participant.isMicrophoneEnabled

  return (
    <div
      className={cn(
        'relative flex min-h-48 items-center justify-center overflow-hidden rounded-lg border bg-card',
        tile.isSpeaking && 'ring-2 ring-glow',
      )}
    >
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

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
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

  const roomRef = useRef<Room | null>(null)
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

    const onDisconnected = () => {
      if (!cancelled) {
        setConnState(ConnectionState.Disconnected)
        bump()
      }
    }
    room.on(RoomEvent.Disconnected, onDisconnected)

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
      for (const ev of events) room.off(ev, onRoomChange)
      void room.disconnect()
      worker.terminate()
      roomRef.current = null
    }
  }, [supported, e2eeKey, livekitUrl, token, kind, bump])

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
    void roomRef.current?.disconnect()
    onLeave()
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
          <Button variant="outline" onClick={onLeave}>
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
        <Button variant="outline" onClick={onLeave}>
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

  const gridCols =
    tiles.length <= 1
      ? 'grid-cols-1'
      : tiles.length === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : tiles.length <= 4
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-96 flex-col gap-3">
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

      <div className={cn('grid min-h-0 flex-1 gap-3 auto-rows-fr', gridCols)}>
        {connState === ConnectionState.Connecting && tiles.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            {t('calls:room.connecting')}
          </div>
        ) : (
          tiles.map((tile) => <ParticipantTile key={tile.key} tile={tile} />)
        )}
      </div>

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
            onClick={() => void toggleScreen()}
            aria-label={screenEnabled ? t('calls:room.stopShare') : t('calls:room.startShare')}
          >
            <Monitor className="h-4 w-4" />
            <span>{screenEnabled ? t('calls:room.stopShare') : t('calls:room.startShare')}</span>
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
