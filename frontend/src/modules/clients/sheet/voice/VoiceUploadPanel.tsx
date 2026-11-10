import { Check, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/lib/i18n'
import { cn, formatBytes } from '@/shared/lib/utils'
import { useSheetRefresh } from '../use-sheet'
import { MAX_VOICE_BYTES, uploadVoiceNote, useVoiceStorageOff } from './voice-api'

const METADATA_TIMEOUT_MS = 5000

interface QueueItem {
  id: number
  file: File
  status: 'queued' | 'uploading' | 'done' | 'error'
  loaded: number
  error: string | null
  /** Rejected before upload (too large): trying again would change nothing. */
  final: boolean
}

/** Length from the file's own metadata; 0 when the browser cannot read it (the server accepts 0). */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio()
    const url = URL.createObjectURL(file)
    const settle = (seconds: number) => {
      clearTimeout(giveUp)
      URL.revokeObjectURL(url)
      resolve(seconds)
    }
    const giveUp = setTimeout(() => settle(0), METADATA_TIMEOUT_MS)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => settle(Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0)
    audio.onerror = () => settle(0)
    audio.src = url
  })
}

/** Several existing recordings at once, uploaded one after the other; a failed one does not stop the rest. */
export function VoiceUploadPanel({ prospectId, onClose }: { prospectId: string; onClose: () => void }) {
  const refresh = useSheetRefresh()
  const storageOff = useVoiceStorageOff()
  const [items, setItems] = useState<QueueItem[]>([])
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const abort = useRef(new AbortController())

  useEffect(() => {
    // StrictMode runs the effect twice on mount; a fresh controller keeps the second run usable.
    abort.current = new AbortController()
    const controller = abort.current
    return () => controller.abort()
  }, [])

  const patch = (id: number, changes: Partial<QueueItem>) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)))

  // One at a time: the effect starts the next queued file as soon as nothing is uploading.
  useEffect(() => {
    if (items.some((item) => item.status === 'uploading')) return
    const next = items.find((item) => item.status === 'queued')
    if (!next) return
    patch(next.id, { status: 'uploading', loaded: 0, error: null })
    void (async () => {
      try {
        const durationSeconds = await readDuration(next.file)
        await uploadVoiceNote(prospectId, { file: next.file, fileName: next.file.name, durationSeconds }, (loaded, total) => patch(next.id, { loaded: Math.min(loaded, total) }), abort.current.signal)
        patch(next.id, { status: 'done', loaded: next.file.size })
        refresh()
      } catch (err) {
        if (abort.current.signal.aborted) return
        patch(next.id, { status: 'error', error: err instanceof Error ? err.message : t('common:states.changeNotSaved') })
      }
    })()
    // `patch` and `refresh` only touch state and the query client.
  }, [items, prospectId])

  const add = (files: FileList | File[]) => {
    const added = [...files].map<QueueItem>((file) => {
      const tooLarge = file.size > MAX_VOICE_BYTES
      return {
        id: ++nextId.current,
        file,
        status: tooLarge ? 'error' : 'queued',
        loaded: 0,
        error: tooLarge ? t('clients:voice.tooLarge', { max: formatBytes(MAX_VOICE_BYTES) }) : null,
        final: tooLarge,
      }
    })
    setItems((current) => [...current, ...added])
  }

  const busy = items.some((item) => item.status === 'queued' || item.status === 'uploading')

  return (
    <section aria-label={t('clients:voice.uploadTitle')} className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-medium">{t('clients:voice.uploadTitle')}</h3>
        <Button type="button" variant="ghost" size="icon-sm" title={t('common:actions.close')} aria-label={t('common:actions.close')} disabled={busy} onClick={onClose}>
          <X />
        </Button>
      </div>

      {storageOff ? (
        <Alert tone="warning">{t('clients:voice.storageOff')}</Alert>
      ) : (
        <div
          data-testid="voice-dropzone"
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (e.dataTransfer.files.length > 0) add(e.dataTransfer.files)
          }}
          className={cn('flex flex-wrap items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground', dragging && 'bg-accent text-accent-foreground')}
        >
          <span>{t('clients:voice.dropHere')}</span>
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            {t('clients:voice.choose')}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept="audio/*"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('clients:voice.choose')}
            data-testid="voice-file-input"
            onChange={(e) => {
              if (e.target.files) add(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {items.length > 0 ? (
        <ul aria-label={t('clients:voice.queueLabel')} className="divide-y">
          {items.map((item) => {
            const fraction = item.file.size > 0 ? item.loaded / item.file.size : 0
            return (
              <li key={item.id} className="space-y-1 py-2 text-sm" data-upload-status={item.status}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                    {item.file.name}
                  </span>
                  {item.status === 'done' ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-success-text">
                      <Check className="h-4 w-4" aria-hidden="true" /> {t('clients:voice.done')}
                    </span>
                  ) : null}
                  {item.status === 'error' && !item.final ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => patch(item.id, { status: 'queued', loaded: 0, error: null })}>
                      <RotateCcw className="h-3.5 w-3.5" /> {t('common:actions.tryAgainShort')}
                    </Button>
                  ) : null}
                </div>
                {item.status === 'queued' || item.status === 'uploading' ? (
                  <>
                    <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${fraction})` }} />
                    </div>
                    <p className="tabular-nums text-xs text-muted-foreground">
                      {item.status === 'queued'
                        ? t('clients:voice.waiting')
                        : t('clients:voice.progress', { loaded: formatBytes(item.loaded), size: formatBytes(item.file.size), percent: Math.round(fraction * 100) })}
                    </p>
                  </>
                ) : null}
                {item.status === 'error' && item.error ? <p className="text-xs text-destructive-text">{item.error}</p> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
