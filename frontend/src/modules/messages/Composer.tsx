import { Camera, FileText, Film, Images, Paperclip, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { cn, formatBytes } from '@/shared/lib/utils'
import type { ChatAttachment } from '@/shared/lib/types'

// Compunerea (fișa „Mesaje"): textarea care crește până la 6 rânduri, Enter trimite,
// Shift+Enter rând nou. Atașamente: agrafă la vedere, drag & drop și lipire din clipboard pe
// desktop. Fiecare fișier e un chip deasupra; un upload picat rămâne cu „Reîncearcă", nu dispare.
// Agrafa deschide un panou ca la WhatsApp: galerie (poze + videouri, pe telefon selectorul de
// poze al sistemului), cameră (doar pe telefon) și document.

const MAX_BYTES = 50 * 1024 * 1024

// Browserul nu afișează HEIC (pozele de iPhone și unele Samsung), deci în conversație ar rămâne
// doar un nume de fișier. Le facem JPEG înainte de upload; convertorul (~3 MB) se încarcă doar
// la prima poză HEIC.
function isHeic(file: File): boolean {
  return /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

async function toJpeg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to')
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
  return new File([blob], file.name.replace(/\.hei[cf]$/i, '') + '.jpg', { type: 'image/jpeg' })
}

interface PendingUpload {
  localId: string
  file: File
  status: 'uploading' | 'done' | 'failed'
  attachment: ChatAttachment | null
}

export function Composer({
  conversationId,
  onSend,
  disabled,
}: {
  conversationId: string
  onSend: (input: { body: string; attachments: ChatAttachment[] }) => void
  disabled?: boolean
}) {
  const [body, setBody] = useState('')
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const [dragging, setDragging] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef<HTMLDivElement>(null)
  const hasCamera = window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    if (!attachOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!attachRef.current?.contains(e.target as Node)) setAttachOpen(false)
    }
    // preventDefault: altfel același Esc ar scoate omul și din conversație (MessagesPage).
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setAttachOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [attachOpen])

  useEffect(() => {
    setBody('')
    setUploads([])
  }, [conversationId])

  const upload = async (localId: string, original: File) => {
    try {
      let file = original
      if (isHeic(original)) {
        file = await toJpeg(original)
        setUploads((current) => current.map((u) => (u.localId === localId ? { ...u, file } : u)))
      }
      const form = new FormData()
      form.append('file', file, file.name)
      const attachment = await api.upload<ChatAttachment>('/api/chat/attachments', form)
      setUploads((current) => current.map((u) => (u.localId === localId ? { ...u, status: 'done', attachment } : u)))
    } catch {
      setUploads((current) => current.map((u) => (u.localId === localId ? { ...u, status: 'failed' } : u)))
    }
  }

  const start = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(`„${file.name}" e peste limita de 50 MB`)
      return
    }
    const localId = crypto.randomUUID()
    setUploads((current) => [...current, { localId, file, status: 'uploading', attachment: null }])
    void upload(localId, file)
  }

  const startMany = (files: FileList | null) => {
    if (!files) return
    for (const file of [...files]) start(file)
  }

  const drop = (localId: string) => setUploads((current) => current.filter((u) => u.localId !== localId))

  const sendNow = () => {
    const attachments = uploads.flatMap((u) => (u.attachment ? [u.attachment] : []))
    if (!body.trim() && attachments.length === 0) return
    onSend({ body: body.trim(), attachments })
    setBody('')
    setUploads([])
    textareaRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendNow()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault()
      startMany(e.clipboardData.files)
    }
  }

  const pick = (input: RefObject<HTMLInputElement>) => {
    setAttachOpen(false)
    input.current?.click()
  }

  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    startMany(e.target.files)
    e.target.value = ''
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    startMany(e.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn('relative border-t p-3', dragging && 'bg-accent/40')}
    >
      {uploads.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {uploads.map((entry) => (
            <li key={entry.localId} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <UploadThumb file={entry.file} />
              <span className="max-w-[180px] truncate">{entry.file.name}</span>
              <span className="text-muted-foreground tnum">{formatBytes(entry.file.size)}</span>
              {entry.status === 'uploading' ? <span className="text-muted-foreground">se încarcă…</span> : null}
              {entry.status === 'failed' ? (
                // Acțiune de text într-un chip, nu buton cu carapacă (`ui/` are doar variante
                // de 28/32px, care ar sparge chip-ul).
                <button
                  type="button"
                  className="flex items-center gap-1 underline underline-offset-2"
                  onClick={() => {
                    setUploads((current) => current.map((u) => (u.localId === entry.localId ? { ...u, status: 'uploading' } : u)))
                    void upload(entry.localId, entry.file)
                  }}
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reîncearcă
                </button>
              ) : null}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => drop(entry.localId)}
                aria-label={`Renunță la ${entry.file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-2" ref={attachRef}>
        {attachOpen ? (
          <div
            role="menu"
            aria-label="Atașează"
            className="absolute inset-x-0 bottom-full grid grid-cols-3 gap-2 border-t bg-card p-4 md:inset-x-auto md:left-3 md:mb-2 md:w-80 md:rounded-md md:border md:shadow-md"
          >
            <AttachOption icon={Images} label="Galerie" onClick={() => pick(galleryInputRef)} />
            {hasCamera ? <AttachOption icon={Camera} label="Cameră" onClick={() => pick(cameraInputRef)} /> : null}
            <AttachOption icon={FileText} label="Document" onClick={() => pick(fileInputRef)} />
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Atașează"
          aria-haspopup="menu"
          aria-expanded={attachOpen}
          onClick={() => setAttachOpen((open) => !open)}
          disabled={disabled}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        {/* Selectoarele native rămân în DOM și sunt declanșate din panou — altfel pe mobil nu
            s-ar deschide camera/galeria. Același tipar ca în Arhivă și Email. În APK, galeria
            (accept doar imagini + video) deschide selectorul de poze al sistemului, vezi
            MainActivity.java. */}
        <input ref={galleryInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={onPicked} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPicked} />
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPicked} />
        <Textarea
          ref={textareaRef}
          auto
          rows={1}
          value={body}
          placeholder={dragging ? 'Lasă aici fișierul' : 'Scrie un mesaj'}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={disabled}
          aria-label="Mesaj"
        />
        <Button type="button" onClick={sendNow} disabled={disabled || (!body.trim() && !uploads.some((u) => u.attachment))}>
          Trimite
        </Button>
      </div>
    </div>
  )
}
function AttachOption({ icon: Icon, label, onClick }: { icon: typeof Images; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-md py-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      {label}
    </button>
  )
}

function UploadThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/') && !isHeic(file)

  useEffect(() => {
    if (!isImage) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, isImage])

  if (isImage && url) return <img src={url} alt="" className="h-8 w-8 rounded-sm object-cover" />
  const Icon = file.type.startsWith('video/') ? Film : Paperclip
  return <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
}
