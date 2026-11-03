import { Camera, FileText, Hash, Images, Paperclip, Reply, RotateCw, SendHorizontal, X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { toast } from 'sonner'
import { FileTypeIcon } from '@/shared/components/FileTypeIcon'
import { FileViewer } from '@/shared/components/FileViewer'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { parseDashLink } from '@/shared/lib/entity-links'
import { cn, formatBytes } from '@/shared/lib/utils'
import type { ChatAttachment, ChatReplyPreview } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'
import { RefPicker } from './RefPicker'
import type { RefInput } from './useThreadMessages'

// Compunerea (fișa „Mesaje"): textarea care crește până la 6 rânduri, Enter trimite,
// Shift+Enter rând nou. Atașamente: agrafă la vedere, drag & drop și lipire din clipboard pe
// desktop. Fiecare fișier e un chip deasupra; un upload picat rămâne cu „Reîncearcă", nu dispare.
// Agrafa deschide un panou ca la WhatsApp: galerie (poze + videouri, pe telefon selectorul de
// poze al sistemului), cameră (doar pe telefon) și document.
//
// Objects travel as chips above the field: picked with `#` (the Ctrl K search) or pasted as a
// link to this app. A pasted link becomes a chip only when the sender can see the object;
// otherwise it stays text.

const MAX_BYTES = 50 * 1024 * 1024
const MAX_REFS = 5
// The server throttles too; this keeps the request count down while someone types a paragraph.
const TYPING_EVERY_MS = 3_000

export interface ComposerHandle {
  focus: () => void
  /** Puts text in the field (replacing what is there) and focuses it. */
  prefill: (text: string) => void
}

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

export const Composer = forwardRef<
  ComposerHandle,
  {
    conversationId: string
    onSend: (input: { body: string; attachments: ChatAttachment[]; refs: RefInput[] }) => void
    replyTo?: ChatReplyPreview | null
    onCancelReply?: () => void
    onArrowUpEmpty?: () => void
    disabled?: boolean
  }
>(function Composer({ conversationId, onSend, replyTo, onCancelReply, onArrowUpEmpty, disabled }, ref) {
  const [body, setBody] = useState('')
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const [refs, setRefs] = useState<RefInput[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewing, setPreviewing] = useState<PendingUpload | null>(null)
  const lastTyping = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef<HTMLDivElement>(null)
  const hasCamera = window.matchMedia?.('(pointer: coarse)').matches ?? false

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    prefill: (text: string) => {
      setBody(text)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        el?.focus()
        el?.setSelectionRange(text.length, text.length)
      })
    },
  }))

  const addRef = (refInput: RefInput) => {
    setRefs((current) => {
      if (current.some((r) => r.type === refInput.type && r.id === refInput.id)) return current
      if (current.length >= MAX_REFS) {
        toast.error(t('messages:composer.tooManyRefs', { count: MAX_REFS }))
        return current
      }
      return [...current, refInput]
    })
  }

  const signalTyping = () => {
    const now = Date.now()
    if (now - lastTyping.current < TYPING_EVERY_MS) return
    lastTyping.current = now
    void api.post(`/api/chat/conversations/${conversationId}/typing`, {}).catch(() => undefined)
  }

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
    setRefs([])
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
      toast.error(t('messages:composer.fileTooLarge', { name: file.name }))
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
    if (!body.trim() && attachments.length === 0 && refs.length === 0) return
    onSend({ body: body.trim(), attachments, refs })
    setBody('')
    setUploads([])
    setRefs([])
    lastTyping.current = 0
    textareaRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendNow()
    } else if (e.key === 'ArrowUp' && !body && onArrowUpEmpty) {
      e.preventDefault()
      onArrowUpEmpty()
    } else if (e.key === 'Escape' && replyTo && onCancelReply) {
      e.preventDefault()
      onCancelReply()
    } else if (e.key === '#' && (body === '' || /\s$/.test(body.slice(0, e.currentTarget.selectionStart)))) {
      // `#` at the start of a word opens the object search instead of typing the character.
      e.preventDefault()
      setPickerOpen(true)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault()
      startMany(e.clipboardData.files)
      return
    }
    const text = e.clipboardData.getData('text/plain').trim()
    const link = /^\S+$/.test(text) ? parseDashLink(text) : null
    if (!link) return
    e.preventDefault()
    const el = e.currentTarget
    const at = el.selectionStart
    // The link goes in as text first; it turns into a chip once the server confirms the sender sees it.
    setBody((current) => current.slice(0, at) + text + current.slice(el.selectionEnd))
    api
      .get<{ title: string }>(`/api/chat/refs/preview?type=${link.type}&id=${link.id}`)
      .then((card) => {
        addRef({ type: link.type, id: link.id, title: card.title })
        setBody((current) => current.replace(text, '').replace(/\s{2,}/g, ' ').trimStart())
      })
      .catch(() => undefined)
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
      {replyTo ? (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-muted px-2 py-1.5">
          <Reply className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{t('messages:reply.to', { name: replyTo.authorName })}</p>
            <p className="truncate text-xs text-muted-foreground">{replyTo.body || t('messages:reply.attachment')}</p>
          </div>
          <button
            type="button"
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            onClick={onCancelReply}
            aria-label={t('messages:reply.cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {refs.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('messages:composer.attachedObjects')}>
          {refs.map((refInput) => (
            <li key={`${refInput.type}:${refInput.id}`} className="flex max-w-full items-center gap-1.5 rounded-full bg-muted py-1 pl-2.5 pr-1 text-xs">
              <Hash className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">{t(`messages:refs.types.${refInput.type}`)}</span>
              <span className="min-w-0 truncate font-medium">{refInput.title}</span>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setRefs((current) => current.filter((r) => r !== refInput))}
                aria-label={t('messages:composer.removeObject', { title: refInput.title })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {uploads.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {uploads.map((entry) => (
            <li key={entry.localId} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <UploadThumb file={entry.file} onOpen={() => setPreviewing(entry)} />
              <span className="max-w-[180px] truncate">{entry.file.name}</span>
              <span className="text-muted-foreground tnum">{formatBytes(entry.file.size)}</span>
              {entry.status === 'uploading' ? <span className="text-muted-foreground">{t('messages:composer.uploading')}</span> : null}
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
                  {t('common:actions.tryAgainShort')}
                </button>
              ) : null}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => drop(entry.localId)}
                aria-label={t('messages:composer.discardFile', { name: entry.file.name })}
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
            aria-label={t('messages:composer.attach')}
            className="absolute inset-x-0 bottom-full grid grid-cols-3 gap-2 border-t bg-card p-4 md:inset-x-auto md:left-3 md:mb-2 md:w-80 md:rounded-md md:border md:shadow-md"
          >
            <AttachOption icon={Images} label={t('messages:composer.gallery')} onClick={() => pick(galleryInputRef)} />
            {hasCamera ? <AttachOption icon={Camera} label={t('messages:composer.camera')} onClick={() => pick(cameraInputRef)} /> : null}
            <AttachOption icon={FileText} label={t('common:labels.document')} onClick={() => pick(fileInputRef)} />
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('messages:composer.attach')}
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
          placeholder={dragging ? t('messages:composer.dropHere') : t('messages:composer.placeholder')}
          onChange={(e) => {
            setBody(e.target.value)
            if (e.target.value) signalTyping()
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={disabled}
          aria-label={t('common:labels.message')}
          className="min-h-9 rounded-[1.25rem] px-4 py-2"
        />
        <Button
          type="button"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full"
          onClick={sendNow}
          disabled={disabled || (!body.trim() && !uploads.some((u) => u.attachment) && refs.length === 0)}
          aria-label={t('common:actions.send')}
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <RefPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false)
          textareaRef.current?.focus()
        }}
        onPick={(refInput) => {
          addRef(refInput)
          setPickerOpen(false)
          textareaRef.current?.focus()
        }}
      />

      {previewing ? <UploadPreview upload={previewing} onClose={() => setPreviewing(null)} /> : null}
    </div>
  )
})

/** The picked file at full size before sending (#20), shown from the local blob. */
function UploadPreview({ upload, onClose }: { upload: PendingUpload; onClose: () => void }) {
  const [url] = useState(() => URL.createObjectURL(upload.file))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <FileViewer
      files={[{ id: upload.localId, name: upload.file.name, url, mimeType: upload.file.type }]}
      index={0}
      onIndexChange={() => {}}
      onClose={onClose}
    />
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

function UploadThumb({ file, onOpen }: { file: File; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/') && !isHeic(file)

  useEffect(() => {
    if (!isImage) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, isImage])

  if (isImage && url) {
    return (
      <button type="button" onClick={onOpen} className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('messages:composer.previewFile', { name: file.name })}>
        <img src={url} alt="" className="h-16 w-16 rounded-sm object-cover" />
      </button>
    )
  }
  return <FileTypeIcon filename={file.name} contentType={file.type} size="sm" />
}
