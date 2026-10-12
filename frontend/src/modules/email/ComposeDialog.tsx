import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { RichTextEditor } from '@/shared/components/RichTextEditor'
import { Alert } from '@/shared/components/ui/alert'
import { api, ApiError } from '@/shared/lib/api'
import { readFileAsBase64, type PendingAttachment } from '@/shared/lib/attachments'
import { formatRelativeTime } from '@/shared/lib/format'
import type { EmailDraft, EmailFromKey, EmailIdentity, EmailSettings, EmailTemplate } from '@/shared/lib/types'
import { ArchiveAttachPicker } from './ArchiveAttachPicker'
import { IdentityField, useIdentityKey } from './IdentityField'
import { Select } from '@/shared/components/ui/select'

const MAX_ATTACHMENTS = 5

/** Adevărul dintr-un header poate fi „Vanadium Systems <sales@vanadium.systems>". */
const bareAddress = (value: string): string => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase()

// Oglindirea lui `identityKeyForAddress` din backend (email/mailboxes.ts): cheia identității care
// primește pe adresa dată. `null` = adresa nu mai e nicio identitate (cutie scoasă din Setări).
function identityKeyForAddress(
  address: string,
  identities: EmailIdentity[] | null | undefined,
): EmailFromKey | null {
  const target = bareAddress(address)
  return identities?.find((identity) => bareAddress(identity.fromAddress) === target)?.key ?? null
}

export type ComposeMode =
  | { kind: 'compose'; to?: string }
  | { kind: 'reply'; threadId: string; to: string; subject: string; fromAddress: string; lastSeenMessageId?: string | null }
  | { kind: 'forward'; messageId: string; subject: string; fromAddress: string }
  | { kind: 'draft'; draft: EmailDraft }

interface ComposeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: ComposeMode
}

export function ComposeDialog({ open, onOpenChange, mode }: ComposeDialogProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [includeOriginalAttachments, setIncludeOriginalAttachments] = useState(true)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [archivePickerOpen, setArchivePickerOpen] = useState(false)
  const [toFocused, setToFocused] = useState(false)
  // Răspunsul dublu: între deschiderea composării și trimitere a plecat alt răspuns pe fir.
  // Nu e o eroare — omul vede cine a răspuns și decide (fișa „Email cu cutii comune").
  const [repliedMeanwhile, setRepliedMeanwhile] = useState<{ by: string | null; at: string } | null>(null)
  const toContainerRef = useRef<HTMLDivElement>(null)

  const templates = useQuery({
    queryKey: ['email', 'templates'],
    queryFn: () => api.get<EmailTemplate[]>('/api/email/templates'),
    enabled: open,
  })

  // Adrese recente (trimise + primite) — autocomplete nativ pe "Către", ca să nu mai trebuiască
  // copy-paste la adresele scrise des (Stefan, 2026-07-24).
  const recentAddresses = useQuery({
    queryKey: ['email', 'recent-addresses'],
    queryFn: () => api.get<string[]>('/api/email/recent-addresses'),
    enabled: open,
  })

  // Semnătura se adaugă automat pe server la trimitere (nu intră în `body`) — previzualizare
  // aici doar ca să se vadă ce se atașează, ca să nu pară că "nu se aplică" (întrebare reală,
  // Stefan a raportat-o ca bug 2026-07-17: la Reply lipsea din popup ȘI din trimiterea reală —
  // acum e reparată în ambele). Pt. reply/forward nu există selector "De la" (identitatea vine
  // din adresa pe care a venit mesajul original, nu dintr-o alegere) — deducem aceeași cheie
  // pe care o folosește backend-ul, nu presupunem 'stefan' implicit.
  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
    enabled: open,
  })
  // Cutia de trimitere: prima din cele ale omului, nu o valoare implicită care poate să nu fie a lui.
  const [from, setFrom] = useIdentityKey('stefan', settings.data?.identities)

  const filteredAddresses = (recentAddresses.data ?? []).filter(
    (addr) => !to.trim() || addr.toLowerCase().includes(to.trim().toLowerCase()),
  )

  const previewFromKey: EmailFromKey =
    mode.kind === 'reply' || mode.kind === 'forward'
      ? identityKeyForAddress(mode.fromAddress, settings.data?.identities) ?? 'contact'
      : from
  // O cutie fără semnătură proprie primește semnătura de firmă (signature.ts, backend) —
  // previzualizarea trebuie să reflecte asta, altfel arată una care nu se atașează.
  const signaturePreview = settings.data
    ? settings.data.signatures[previewFromKey] ?? settings.data.signatures['contact'] ?? ''
    : null

  useEffect(() => {
    if (!open) return
    setRepliedMeanwhile(null)
    setAttachments([])
    setIncludeOriginalAttachments(true)
    setArchivePickerOpen(false)
    setToFocused(false)
    if (mode.kind === 'reply') {
      setTo(mode.to)
      setSubject(/^re:/i.test(mode.subject) ? mode.subject : `Re: ${mode.subject}`)
      setBody('')
      setDraftId(null)
    } else if (mode.kind === 'forward') {
      setTo('')
      setSubject(/^fwd:/i.test(mode.subject) ? mode.subject : `Fwd: ${mode.subject}`)
      setBody('')
      setDraftId(null)
    } else if (mode.kind === 'draft') {
      setFrom(mode.draft.fromKey)
      setTo(mode.draft.to)
      setSubject(mode.draft.subject)
      setBody(mode.draft.body)
      setTemplateId(mode.draft.templateId ?? '')
      setDraftId(mode.draft.id)
    } else {
      setTo(mode.to ?? '')
      setSubject('')
      setBody('')
      setTemplateId('')
      setDraftId(null)
    }
  }, [open, mode])

  const addFiles = async (files: FileList) => {
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(`Maxim ${MAX_ATTACHMENTS} atașamente.`)
      return
    }
    const toAdd = Array.from(files).slice(0, remaining)
    try {
      const encoded = await Promise.all(toAdd.map(readFileAsBase64))
      setAttachments((prev) => [...prev, ...encoded])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Citire fișier eșuată')
    }
  }

  const invalidateAfterSend = () => {
    void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
    void queryClient.invalidateQueries({ queryKey: ['email', 'sends'] })
    void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
  }

  const send = useMutation({
    mutationFn: async () => {
      if (mode.kind === 'reply') {
        // `lastSeenMessageId` e ultimul mesaj pe care omul l-a văzut: dacă între timp a plecat
        // alt răspuns pe fir, serverul răspunde 409 și omul vede bara de dedesubt.
        return api.post(`/api/email/threads/${mode.threadId}/reply`, {
          body,
          attachments: attachments.length ? attachments : undefined,
          lastSeenMessageId: mode.lastSeenMessageId ?? null,
        })
      }
      if (mode.kind === 'forward') {
        return api.post(`/api/email/messages/${mode.messageId}/forward`, {
          to,
          extraBody: body || undefined,
          includeOriginalAttachments,
          attachments: attachments.length ? attachments : undefined,
        })
      }
      const result = await api.post('/api/email/send', {
        to,
        subject,
        body,
        from,
        ...(templateId ? { templateId } : {}),
        ...(attachments.length ? { attachments } : {}),
      })
      if (draftId) await api.delete(`/api/email/drafts/${draftId}`)
      return result
    },
    onSuccess: () => {
      invalidateAfterSend()
      toast.success('Trimis')
      onOpenChange(false)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'THREAD_REPLIED_MEANWHILE') {
        const body = err.body as { error?: { by?: string | null; at?: string } } | undefined
        setRepliedMeanwhile({ by: body?.error?.by ?? null, at: body?.error?.at ?? new Date().toISOString() })
        return
      }
      toast.error(err.message)
    },
  })

  const saveDraft = useMutation({
    mutationFn: () => {
      const payload = { fromKey: from, to, subject, body, ...(templateId ? { templateId } : {}) }
      return draftId ? api.patch<EmailDraft>(`/api/email/drafts/${draftId}`, payload) : api.post<EmailDraft>('/api/email/drafts', payload)
    },
    onSuccess: (draft) => {
      setDraftId(draft.id)
      void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
      toast.success('Draft salvat')
    },
    onError: (err) => toast.error(err.message),
  })

  const title = mode.kind === 'reply' ? 'Răspunde' : mode.kind === 'forward' ? 'Redirecționează' : draftId ? 'Editează draft' : 'Compune'

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            send.mutate()
          }}
        >
          {mode.kind === 'compose' || mode.kind === 'draft' ? (
            <>
              <IdentityField id="cd-from" value={from} onChange={setFrom} identities={settings.data?.identities} />
              {templates.data?.length ? (
                <div className="space-y-2">
                  <Label htmlFor="cd-template">Template (opțional)</Label>
                  <Select
                    id="cd-template"
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value)
                      const t = templates.data?.find((x) => x.id === e.target.value)
                      if (t) {
                        setSubject(t.subject)
                        setBody(t.body)
                      }
                    }}
                  >
                    <option value="">— niciunul —</option>
                    {templates.data.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </>
          ) : null}

          {mode.kind === 'reply' ? (
            <p className="text-sm text-muted-foreground">
              Către: <span className="font-medium text-foreground">{to}</span>
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="cd-to">Către</Label>
              <div ref={toContainerRef} className="relative">
                <Input
                  id="cd-to"
                  type="email"
                  autoComplete="off"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  onFocus={() => setToFocused(true)}
                  onBlur={() => setToFocused(false)}
                  required
                />
                {toFocused && filteredAddresses.length > 0 ? (
                  // onMouseDown cu preventDefault pe container ține focus-ul pe input cât se dă
                  // click pe o opțiune — altfel blur-ul ar închide dropdown-ul ÎNAINTE de click.
                  <ul
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md"
                  >
                    {filteredAddresses.map((addr) => (
                      <li key={addr}>
                        <button
                          type="button"
                          className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setTo(addr)
                            setToFocused(false)
                          }}
                        >
                          {addr}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          )}

          {mode.kind === 'reply' ? null : (
            <div className="space-y-2">
              <Label htmlFor="cd-subject">Subiect</Label>
              <Input id="cd-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required={mode.kind !== 'forward'} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cd-body">Mesaj</Label>
            <RichTextEditor id="cd-body" value={body} onChange={setBody} placeholder="Scrie mesajul…" />
          </div>

          {signaturePreview ? (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <p className="mb-1 text-xs font-medium text-muted-foreground/70">Se adaugă automat la trimitere</p>
              <p className="whitespace-pre-wrap">{signaturePreview}</p>
              {settings.data?.logoUrl ? <img src={settings.data.logoUrl} alt="logo" className="mt-2 max-h-10" /> : null}
            </div>
          ) : null}

          {mode.kind === 'forward' ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeOriginalAttachments} onChange={(e) => setIncludeOriginalAttachments(e.target.checked)} />
              Include atașamentele originale
            </label>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Atașamente ({attachments.length}/{MAX_ATTACHMENTS})
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" /> Adaugă
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => setArchivePickerOpen(true)}
                >
                  Din arhivă
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
            {attachments.length > 0 ? (
              <ul className="space-y-1">
                {attachments.map((a, i) => (
                  <li key={`${a.filename}-${i}`} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <span className="truncate">{a.filename}</span>
                    <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}>
                      <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {repliedMeanwhile ? (
            <Alert
              tone="warning"
              title={`${repliedMeanwhile.by ?? 'Altcineva'} a răspuns ${formatRelativeTime(repliedMeanwhile.at)}`}
              action={
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => setRepliedMeanwhile(null)}>
                    Trimite oricum
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                    Vezi răspunsul
                  </Button>
                </>
              }
            >
              Mesajul tău e tot aici, netrimis.
            </Alert>
          ) : null}

          <div className="flex gap-2">
            {mode.kind === 'compose' || mode.kind === 'draft' ? (
              <Button type="button" variant="outline" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate()}>
                {saveDraft.isPending ? 'Se salvează…' : 'Salvează draft'}
              </Button>
            ) : null}
            <Button type="submit" className="flex-1" disabled={send.isPending}>
              {send.isPending ? 'Se trimite…' : 'Trimite'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <ArchiveAttachPicker
      open={archivePickerOpen}
      onOpenChange={setArchivePickerOpen}
      onSelect={(attachment) => {
        if (attachments.length >= MAX_ATTACHMENTS) {
          toast.error(`Maxim ${MAX_ATTACHMENTS} atașamente.`)
          return
        }
        setAttachments((prev) => [...prev, attachment])
      }}
    />
    </>
  )
}
