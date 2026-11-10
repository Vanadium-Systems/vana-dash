import { Mic, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { formatDuration } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useSheetRefresh } from '../use-sheet'
import type { VoiceNote } from '../types'
import { MAX_VOICE_SECONDS, uploadVoiceNote, useVoiceStorageOff, VoiceUploadError, WARN_VOICE_SECONDS } from './voice-api'

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
const TICK_MS = 250
const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }

type Phase = 'idle' | 'requesting' | 'recording' | 'review' | 'saving'

interface Take {
  blob: Blob
  url: string
  durationSeconds: number
  limitHit: boolean
}

const canRecord = () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

function micErrorKey(err: unknown) {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'clients:voice.denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'clients:voice.noMic'
  return 'clients:voice.micFailed'
}

interface VoiceRecorderProps {
  prospectId: string
  /** The call task this note follows, when it is recorded from the call session. */
  taskId?: string
  onSaved: (note: VoiceNote) => void
  onClose?: () => void
  /** True from the first tap on record until the note is saved or discarded. */
  onBusyChange?: (busy: boolean) => void
}

/** Records a voice note with the microphone, lets the person listen back, then saves it on the prospect. */
export function VoiceRecorder({ prospectId, taskId, onSaved, onClose, onBusyChange }: VoiceRecorderProps) {
  const refresh = useSheetRefresh()
  const storageOff = useVoiceStorageOff()
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const [caption, setCaption] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef(0)
  const audioContext = useRef<AudioContext | null>(null)
  const frame = useRef(0)
  const meter = useRef<HTMLDivElement>(null)
  const upload = useRef<AbortController | null>(null)
  const takeUrl = useRef<string | null>(null)

  const releaseMic = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    cancelAnimationFrame(frame.current)
    void audioContext.current?.close().catch(() => {})
    audioContext.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  useEffect(() => {
    onBusyChange?.(phase !== 'idle')
  }, [phase, onBusyChange])

  useEffect(
    () => () => {
      onBusyChange?.(false)
      upload.current?.abort()
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null
        recorder.current.stop()
      }
      releaseMic()
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current)
    },
    // Runs once, on unmount: the refs hold the live state.
    [],
  )

  const finish = useCallback(
    (limitHit: boolean) => {
      const active = recorder.current
      if (!active || active.state === 'inactive') return
      // WebM from MediaRecorder reports an infinite duration, so the length is the recording clock.
      const durationSeconds = Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - startedAt.current) / 1000))
      active.onstop = () => {
        const blob = new Blob(chunks.current, { type: active.mimeType || chunks.current[0]?.type || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        takeUrl.current = url
        setTake({ blob, url, durationSeconds, limitHit })
        setPhase('review')
      }
      active.stop()
      releaseMic()
    },
    [releaseMic],
  )

  const watchLevel = (source: MediaStream) => {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return
    const context = new Context()
    audioContext.current = context
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    context.createMediaStreamSource(source).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const draw = () => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128))
      // scaleX, not width: the bar moves on the compositor.
      if (meter.current) meter.current.style.transform = `scaleX(${Math.min(1, peak / 64)})`
      frame.current = requestAnimationFrame(draw)
    }
    draw()
  }

  const start = async () => {
    setError(null)
    if (!canRecord()) {
      setError(t('clients:voice.unsupported'))
      return
    }
    setPhase('requesting')
    try {
      const source = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = source
      const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported?.(candidate))
      const active = new MediaRecorder(source, mimeType ? { mimeType } : undefined)
      recorder.current = active
      chunks.current = []
      active.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      startedAt.current = Date.now()
      setElapsed(0)
      active.start()
      watchLevel(source)
      timer.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt.current) / 1000)
        setElapsed(seconds)
        if (seconds >= MAX_VOICE_SECONDS) finish(true)
      }, TICK_MS)
      setPhase('recording')
    } catch (err) {
      releaseMic()
      setError(t(micErrorKey(err)))
      setPhase('idle')
    }
  }

  const discard = () => {
    if (takeUrl.current) URL.revokeObjectURL(takeUrl.current)
    takeUrl.current = null
    setTake(null)
    setCaption('')
    setError(null)
    setPhase('idle')
    onClose?.()
  }

  const save = async () => {
    if (!take) return
    setError(null)
    setPercent(0)
    setPhase('saving')
    upload.current = new AbortController()
    const extension = EXTENSION[take.blob.type.split(';')[0] ?? ''] ?? 'webm'
    try {
      const note = await uploadVoiceNote(
        prospectId,
        { file: take.blob, fileName: `nota-vocala.${extension}`, durationSeconds: take.durationSeconds, caption: caption.trim() || undefined, taskId },
        (loaded, total) => setPercent(Math.round((loaded / total) * 100)),
        upload.current.signal,
      )
      refresh()
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current)
      takeUrl.current = null
      setTake(null)
      setPhase('idle')
      onSaved(note)
    } catch (err) {
      if (err instanceof VoiceUploadError && err.code === 'ABORTED') return
      // The take stays, so a failed save can be tried again without recording twice.
      setError(err instanceof Error ? err.message : t('common:states.changeNotSaved'))
      setPhase('review')
    }
  }

  const max = formatDuration(MAX_VOICE_SECONDS)
  const unavailable = storageOff && phase !== 'review'

  return (
    <div className="space-y-3" data-testid="voice-recorder">
      {unavailable ? <Alert tone="warning">{error ?? t('clients:voice.storageOff')}</Alert> : null}
      {error && !unavailable ? <Alert tone="critical">{error}</Alert> : null}

      {phase === 'idle' && !unavailable ? (
        <Button type="button" onClick={() => void start()}>
          <Mic aria-hidden="true" /> {t('clients:voice.start')}
        </Button>
      ) : null}
      {phase === 'requesting' ? <p className="text-sm text-muted-foreground">{t('clients:voice.requesting')}</p> : null}

      {phase === 'recording' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => finish(false)}>
              <Square aria-hidden="true" /> {t('clients:voice.stop')}
            </Button>
            <span className="text-sm font-medium">{t('clients:voice.recording')}</span>
            <span className="tabular-nums text-sm" data-testid="voice-timer" aria-live="off">
              {formatDuration(elapsed)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div ref={meter} className="h-full origin-left rounded-full bg-primary" style={{ transform: 'scaleX(0)' }} />
          </div>
          {elapsed >= WARN_VOICE_SECONDS ? (
            <Alert tone="warning">{t('clients:voice.limitSoon', { max, remaining: formatDuration(Math.max(0, MAX_VOICE_SECONDS - elapsed)) })}</Alert>
          ) : null}
        </div>
      ) : null}

      {(phase === 'review' || phase === 'saving') && take ? (
        <div className="space-y-3">
          {take.limitHit ? <Alert tone="warning">{t('clients:voice.limitHit', { max })}</Alert> : null}
          <audio controls src={take.url} aria-label={t('clients:voice.listen')} className="w-full max-w-full" />
          <p className="tabular-nums text-xs text-muted-foreground">{formatDuration(take.durationSeconds)}</p>
          <Field label={t('clients:voice.caption')} optional>
            <Input value={caption} maxLength={200} disabled={phase === 'saving'} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          {phase === 'saving' ? (
            <div className="space-y-1">
              <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${percent / 100})` }} />
              </div>
              <p className="tabular-nums text-xs text-muted-foreground">{t('clients:voice.uploading', { percent })}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={phase === 'saving'} onClick={discard}>
              {t('clients:voice.discard')}
            </Button>
            {storageOff ? null : (
              <Button type="button" disabled={phase === 'saving'} onClick={() => void save()}>
                {t('common:actions.save')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">{t('clients:voice.recorderHint')}</p>
    </div>
  )
}
